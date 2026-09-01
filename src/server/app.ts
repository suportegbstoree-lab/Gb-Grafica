import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import { getAdminServices, isFirebaseAdminConfigured } from './firebaseAdmin.js';
import {
  createCartItemId,
  isValidBrazilianPhone,
  isValidCpf,
  parseMoneyToCents,
} from '../lib/commerce.js';
import {
  isAllowedArtwork,
  isOrderArtworkPath,
  isPendingArtworkPath,
  matchesArtworkSignature,
  sanitizeArtworkName,
} from '../lib/artwork.js';
import {
  allowedFulfillmentTransitions,
  isFulfillmentStatus,
  legacyFulfillmentStatus,
  legacyStatusForFulfillment,
  type DeliveryMethod,
  type FulfillmentStatus,
  type PaymentStatus,
} from '../lib/orderStatus.js';
import {
  parsePagBankWebhookEvent,
  shouldApplyPaymentStatus,
  validatePagBankWebhookEvent,
} from './pagbankWebhook.js';
import {
  checkoutRequestDocumentId,
  normalizeCheckoutRequestId,
  trustedPagBankPayLink,
} from './checkoutSecurity.js';
import { verifyPagBankAuthenticity } from './pagbankAuthenticity.js';
import type { DocumentReference } from 'firebase-admin/firestore';

type RawBodyRequest = express.Request & { rawBody?: string };
type PlainRecord = Record<string, unknown>;

interface ShippingQuote {
  cep: string;
  amountCents: number;
  address: string;
  state: string;
  street: string;
  neighborhood: string;
  city: string;
}

interface NormalizedCartItem {
  cartItem: {
    id: string;
    productId: string;
    nome: string;
    imagem: string;
    preco: string;
    selecoes: Record<string, string>;
    quantidade: number;
    arquivoPath?: string;
    arquivoNome?: string;
    artePendente?: boolean;
    textoPersonalizado?: string;
  };
  checkoutItem: {
    reference_id: string;
    name: string;
    description: string;
    quantity: number;
    unit_amount: number;
    image_url?: string;
  };
  amountCents: number;
}

interface PagBankCheckoutResponse {
  id?: string;
  status?: string;
  links?: Array<{ rel?: string; href?: string }>;
}

class HttpError extends Error {
  constructor(public readonly status: number, public readonly publicMessage: string) {
    super(publicMessage);
    this.name = 'HttpError';
  }
}

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function enforceRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (rateLimitBuckets.size > 5_000) {
    for (const [bucketKey, bucket] of rateLimitBuckets) {
      if (bucket.resetAt <= now) rateLimitBuckets.delete(bucketKey);
    }
  }
  const current = rateLimitBuckets.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (current.count >= limit) {
    throw new HttpError(429, 'Muitas tentativas em pouco tempo. Aguarde e tente novamente.');
  }

  current.count += 1;
}

async function enforceDistributedRateLimit(
  db: ReturnType<typeof getAdminServices>['db'],
  key: string,
  limit: number,
  windowMs: number,
) {
  const now = Date.now();
  const documentId = createHash('sha256').update(key).digest('hex');
  const rateLimitRef = db.collection('_rateLimits').doc(documentId);

  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(rateLimitRef);
    const data = snapshot.data() as PlainRecord | undefined;
    const resetAt = typeof data?.resetAt === 'number' ? data.resetAt : 0;
    const count = typeof data?.count === 'number' ? data.count : 0;

    if (!snapshot.exists || resetAt <= now) {
      transaction.set(rateLimitRef, {
        count: 1,
        resetAt: now + windowMs,
        expiresAt: new Date(now + windowMs + 24 * 60 * 60 * 1000),
      });
      return;
    }

    if (count >= limit) {
      throw new HttpError(429, 'Muitas tentativas em pouco tempo. Aguarde e tente novamente.');
    }

    transaction.update(rateLimitRef, { count: count + 1 });
  });
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

function configuredOrigins(): Set<string> {
  const candidates = [
    process.env.APP_URL,
    ...(process.env.APP_ALLOWED_ORIGINS || '').split(','),
  ];
  const origins = new Set<string>();

  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    try {
      const parsed = new URL(candidate.trim());
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') origins.add(parsed.origin);
    } catch {
      // APP_URL is validated with a user-facing error when checkout needs it.
    }
  }

  return origins;
}

app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = configuredOrigins();
    const isLocalDevelopmentOrigin = process.env.NODE_ENV !== 'production' && Boolean(
      origin && /^https?:\/\/(localhost|127\.0\.0\.1|terminal\.local)(:\d+)?$/.test(origin),
    );

    // Requests without an Origin include server-to-server webhooks and local tools.
    if (!origin || allowedOrigins.has(origin) || isLocalDevelopmentOrigin) {
      callback(null, true);
      return;
    }

    callback(new Error('Origem não autorizada.'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Authenticity-Token'],
}));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com; frame-src https://accounts.google.com https://*.firebaseapp.com; upgrade-insecure-requests",
    );
  }
  next();
});

app.use(express.json({
  limit: '256kb',
  verify: (request, _response, buffer) => {
    (request as RawBodyRequest).rawBody = buffer.toString('utf8');
  },
}));

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[SERVER] ${req.method} ${req.path}`);
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

function getPagBankConfig() {
  const environment = process.env.PAGBANK_ENV?.trim().toLowerCase() === 'production'
    ? 'production'
    : 'sandbox';

  return {
    token: process.env.PAGBANK_TOKEN?.trim() || '',
    environment,
    baseUrl: environment === 'sandbox'
      ? 'https://sandbox.api.pagseguro.com'
      : 'https://api.pagseguro.com',
  } as const;
}

function getPublicAppUrl(req: express.Request): string {
  const configuredUrl = process.env.APP_URL?.trim();

  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Protocolo inválido');
      if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
        throw new Error('HTTPS obrigatório');
      }
      return parsed.origin + parsed.pathname.replace(/\/+$/, '');
    } catch {
      throw new HttpError(500, 'APP_URL está inválida no servidor.');
    }
  }

  if (process.env.NODE_ENV === 'production') {
    throw new HttpError(500, 'APP_URL não está configurada no servidor.');
  }

  const host = req.get('host');
  if (!host) throw new HttpError(500, 'Não foi possível identificar a URL da aplicação.');

  const forwardedProtocol = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProtocol === 'https' ? 'https' : 'http';
  return `${protocol}://${host}`;
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textValue(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength)
    : '';
}

function httpUrl(value: unknown, maxLength = 2048): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;

  const candidate = value.trim().slice(0, maxLength);
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    return candidate;
  } catch {
    return undefined;
  }
}

function validCpf(value: unknown): string {
  const cpf = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  if (!isValidCpf(cpf)) throw new HttpError(422, 'Informe um CPF válido.');
  return cpf;
}

function validPhone(value: unknown): { digits: string; area: string; number: string } {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  if (!isValidBrazilianPhone(digits)) throw new HttpError(422, 'Informe um telefone brasileiro válido.');
  return { digits, area: digits.slice(0, 2), number: digits.slice(2) };
}

function validDeliveryNumber(value: unknown): string {
  const number = textValue(value, 20);
  if (!number || !/^[\p{L}\p{N} .\-/]+$/u.test(number)) {
    throw new HttpError(422, 'Informe o número do endereço.');
  }
  return number;
}

function validAddressField(value: unknown, label: string, maxLength: number): string {
  const field = textValue(value, maxLength);
  if (field.length < 2) throw new HttpError(422, `Informe ${label} do endereço.`);
  return field;
}

async function requireFirebaseUser(req: express.Request) {
  const authorization = req.header('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, 'Sua sessão expirou. Faça login novamente.');

  let auth;
  try {
    auth = getAdminServices().auth;
  } catch (error) {
    console.error('[SERVER] Firebase Admin indisponível:', error);
    throw new HttpError(503, 'A autenticação do servidor ainda não está configurada.');
  }

  try {
    return await auth.verifyIdToken(match[1]);
  } catch {
    throw new HttpError(401, 'Sua sessão expirou. Faça login novamente.');
  }
}

async function requireAdminUser(req: express.Request) {
  const firebaseUser = await requireFirebaseUser(req);
  if (firebaseUser.admin === true) return firebaseUser;

  const { db } = getAdminServices();
  const userSnapshot = await db.collection('users').doc(firebaseUser.uid).get();
  if (!userSnapshot.exists || userSnapshot.data()?.role !== 'admin') {
    throw new HttpError(403, 'Acesso restrito ao administrador.');
  }

  return firebaseUser;
}

async function getShippingQuote(deliveryMethod: unknown, cepValue: unknown): Promise<ShippingQuote> {
  if (deliveryMethod === 'retirada') {
    return {
      cep: '',
      amountCents: 0,
      address: '',
      state: '',
      street: '',
      neighborhood: '',
      city: '',
    };
  }

  if (deliveryMethod !== 'entrega') {
    throw new HttpError(422, 'Escolha uma forma de entrega válida.');
  }

  const cep = typeof cepValue === 'string' ? cepValue.replace(/\D/g, '') : '';
  if (cep.length !== 8) throw new HttpError(422, 'Informe um CEP válido.');

  try {
    const response = await axios.get<{
      erro?: boolean;
      logradouro?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
    }>(`https://viacep.com.br/ws/${cep}/json/`, { timeout: 5000 });

    const addressData = response.data;
    const state = addressData.uf?.trim().toUpperCase() || '';
    const city = textValue(addressData.localidade, 90);

    if (addressData.erro || !/^[A-Z]{2}$/.test(state) || !city) {
      throw new HttpError(422, 'CEP não encontrado.');
    }

    const isLowerShippingCostState = ['SP', 'RJ', 'MG', 'ES', 'PR', 'SC', 'RS'].includes(state);
    const amountCents = isLowerShippingCostState ? 1850 : 3590;
    const street = textValue(addressData.logradouro, 160);
    const neighborhood = textValue(addressData.bairro, 60);
    const address = [street, neighborhood].filter(Boolean).join(', ')
      ? `${[street, neighborhood].filter(Boolean).join(', ')} - ${city}/${state}`
      : `${city}/${state}`;

    return { cep, amountCents, address, state, street, neighborhood, city };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('[SERVER] Erro ao validar CEP:', error);
    throw new HttpError(502, 'Não foi possível validar o CEP agora. Tente novamente.');
  }
}

async function normalizeCart(
  itemsValue: unknown,
  services: ReturnType<typeof getAdminServices>,
  userId: string,
): Promise<{
  items: NormalizedCartItem[];
  subtotalCents: number;
}> {
  const { db, bucket } = services;
  if (!Array.isArray(itemsValue) || itemsValue.length === 0 || itemsValue.length > 50) {
    throw new HttpError(422, 'O carrinho está vazio ou possui itens demais.');
  }

  const itemInputs = itemsValue.filter(isPlainRecord);
  if (itemInputs.length !== itemsValue.length) {
    throw new HttpError(422, 'Há um item inválido no carrinho.');
  }

  const snapshots = await Promise.all(itemInputs.map(async (item) => {
    const productId = textValue(item.productId, 100);
    if (!productId || !/^[A-Za-z0-9_-]+$/.test(productId)) {
      throw new HttpError(422, 'Produto inválido no carrinho.');
    }
    return { item, productId, snapshot: await db.collection('anuncios').doc(productId).get() };
  }));

  const normalizedItems: NormalizedCartItem[] = [];
  let subtotalCents = 0;

  for (let index = 0; index < snapshots.length; index += 1) {
    const { item, productId, snapshot } = snapshots[index];
    if (!snapshot.exists) throw new HttpError(422, 'Um dos produtos não está mais disponível.');

    const product = snapshot.data() as PlainRecord;
    const productName = textValue(product.nome, 100);
    if (!productName) throw new HttpError(422, 'Um dos produtos está configurado incorretamente.');

    const attributes = Array.isArray(product.atributos) ? product.atributos : [];
    const attributeNames: string[] = [];
    const normalizedAttributes = attributes.map((attribute) => {
      if (!isPlainRecord(attribute)) throw new HttpError(422, 'Um dos produtos está configurado incorretamente.');
      const name = textValue(attribute.nome, 100);
      const options = Array.isArray(attribute.opcoes)
        ? attribute.opcoes
          .filter((option): option is string => typeof option === 'string')
          .map(option => option.trim())
        : [];
      if (
        !name || options.length === 0 || options.some(option => !option) ||
        new Set(options).size !== options.length || attributeNames.includes(name)
      ) {
        throw new HttpError(422, 'Um dos produtos está configurado incorretamente.');
      }
      attributeNames.push(name);
      return { name, options };
    });

    const rawSelections = isPlainRecord(item.selecoes) ? item.selecoes : {};
    if (Object.keys(rawSelections).some(key => !attributeNames.includes(key))) {
      throw new HttpError(422, `As opções de ${productName} estão inválidas.`);
    }

    const selections: Record<string, string> = {};
    for (const attribute of normalizedAttributes) {
      const rawSelection = rawSelections[attribute.name];
      const selection = typeof rawSelection === 'string'
        ? rawSelection.trim()
        : '';
      if (!selection || !attribute.options.includes(selection)) {
        throw new HttpError(422, `Selecione todas as opções de ${productName}.`);
      }
      selections[attribute.name] = selection;
    }

    const quantity = Number(item.quantidade);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      throw new HttpError(422, 'A quantidade de um item é inválida.');
    }

    const combinationKey = normalizedAttributes.map(attribute => selections[attribute.name]).join('|');
    const combinations = isPlainRecord(product.combinacoes) ? product.combinacoes : {};
    if (normalizedAttributes.length > 0 && !(combinationKey in combinations)) {
      throw new HttpError(422, `A combinação escolhida de ${productName} está sem preço.`);
    }
    const rawPrice = normalizedAttributes.length > 0 ? combinations[combinationKey] : product.preco_base;
    const unitAmount = parseMoneyToCents(rawPrice);

    if (unitAmount === null || unitAmount <= 0 || unitAmount > 999999900) {
      throw new HttpError(422, `O preço de ${productName} está inválido.`);
    }

    const lineAmount = unitAmount * quantity;
    subtotalCents += lineAmount;
    if (subtotalCents > 8999999100) {
      throw new HttpError(422, 'O valor do pedido excede o limite permitido.');
    }

    const productImage = httpUrl(product.imagem);
    const productDescription = textValue(product.desc, 255) || productName;
    const productType = product.tipoInput === 'arte' || product.tipoInput === 'texto'
      ? product.tipoInput
      : 'nenhum';
    const artworkPath = productType === 'arte' ? textValue(item.arquivoPath, 300) : '';
    const artworkPending = productType === 'arte' && item.artePendente === true;
    let artworkName = '';

    if (productType === 'arte') {
      if (artworkPath && artworkPending) {
        throw new HttpError(422, `Escolha entre enviar agora ou enviar depois a arte de ${productName}.`);
      }
      if (!artworkPath && !artworkPending) {
        throw new HttpError(422, `Envie a arte de ${productName} ou marque que enviará depois.`);
      }
      if (artworkPath) {
        if (!isPendingArtworkPath(artworkPath, userId)) {
          throw new HttpError(422, `O arquivo enviado para ${productName} é inválido.`);
        }
        try {
          const artworkFile = bucket.file(artworkPath);
          const [metadata] = await artworkFile.getMetadata();
          const size = Number(metadata.size);
          const ownerId = metadata.metadata?.ownerId;
          if (!isAllowedArtwork(metadata.contentType, size) || ownerId !== userId) {
            throw new HttpError(422, `O arquivo enviado para ${productName} não é permitido.`);
          }
          const [prefix] = await artworkFile.download({ start: 0, end: 15, validation: false });
          if (!matchesArtworkSignature(String(metadata.contentType), prefix)) {
            throw new HttpError(422, `O conteúdo do arquivo enviado para ${productName} não corresponde ao formato informado.`);
          }
          artworkName = sanitizeArtworkName(
            textValue(item.arquivoNome, 120) || textValue(metadata.metadata?.originalName, 120) || 'arte',
          );
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(422, `Não foi possível validar a arte de ${productName}. Envie o arquivo novamente.`);
        }
      }
    }
    const customText = productType === 'texto' ? textValue(item.textoPersonalizado, 500) : undefined;
    if (productType === 'texto' && !customText) {
      throw new HttpError(422, `Informe a personalização de ${productName}.`);
    }
    const cartId = createCartItemId(productId, selections, customText, artworkPath || String(artworkPending));
    const price = (unitAmount / 100).toFixed(2);

    normalizedItems.push({
      cartItem: {
        id: cartId,
        productId,
        nome: productName,
        imagem: productImage || '',
        preco: price,
        selecoes: selections,
        quantidade: quantity,
        ...(artworkPath ? { arquivoPath: artworkPath, arquivoNome: artworkName } : {}),
        ...(artworkPending ? { artePendente: true } : {}),
        ...(customText ? { textoPersonalizado: customText } : {}),
      },
      checkoutItem: {
        reference_id: productId.slice(0, 64),
        name: productName,
        description: productDescription,
        quantity,
        unit_amount: unitAmount,
      },
      amountCents: lineAmount,
    });
  }

  return { items: normalizedItems, subtotalCents };
}

function providerErrorDetails(error: unknown): unknown {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : String(error);
  return {
    status: error.response?.status,
    data: error.response?.data,
  };
}

function normalizedCheckoutRequestId(value: unknown): string {
  const requestId = normalizeCheckoutRequestId(value);
  if (!requestId) {
    throw new HttpError(422, 'Identificador da tentativa de checkout inválido. Atualize a página e tente novamente.');
  }
  return requestId;
}

function checkoutRequestReference(
  db: ReturnType<typeof getAdminServices>['db'],
  userId: string,
  requestId: string,
) {
  const id = checkoutRequestDocumentId(userId, requestId);
  return db.collection('_checkoutRequests').doc(id);
}

function existingCheckoutResult(
  data: PlainRecord | undefined,
  environment: 'sandbox' | 'production',
): { order_id: string; checkout_id: string; init_point: string } | null {
  if (data?.status !== 'completed') return null;
  const orderId = textValue(data.orderId, 64);
  const checkoutId = textValue(data.checkoutId, 100);
  const payLink = trustedPagBankPayLink(data.payLink, environment);
  if (!orderId || !checkoutId || !payLink) return null;
  return { order_id: orderId, checkout_id: checkoutId, init_point: payLink };
}

async function copyArtworksToOrder(
  items: NormalizedCartItem[],
  services: ReturnType<typeof getAdminServices>,
  userId: string,
  orderId: string,
): Promise<string[]> {
  const pendingPaths: string[] = [];

  for (const item of items) {
    const sourcePath = item.cartItem.arquivoPath;
    if (!sourcePath) continue;
    if (!isPendingArtworkPath(sourcePath, userId)) {
      throw new HttpError(422, `A arte de ${item.cartItem.nome} não está mais disponível.`);
    }

    const fileName = sourcePath.split('/').at(-1) || '';
    const destinationPath = `artworks/${userId}/orders/${orderId}/${item.cartItem.id}/${fileName}`;
    if (!isOrderArtworkPath(destinationPath, userId, orderId)) {
      throw new HttpError(500, 'Não foi possível preparar o destino da arte.');
    }

    await services.bucket.file(sourcePath).copy(services.bucket.file(destinationPath));
    item.cartItem.arquivoPath = destinationPath;
    pendingPaths.push(sourcePath);
  }

  return pendingPaths;
}

function currentFulfillmentStatus(order: PlainRecord): FulfillmentStatus {
  return isFulfillmentStatus(order.fulfillmentStatus)
    ? order.fulfillmentStatus
    : legacyFulfillmentStatus(order.status, order.paymentStatus as PaymentStatus | undefined);
}

async function userIsAdmin(
  firebaseUser: Awaited<ReturnType<typeof requireFirebaseUser>>,
  db: ReturnType<typeof getAdminServices>['db'],
): Promise<boolean> {
  if (firebaseUser.admin === true) return true;
  const userSnapshot = await db.collection('users').doc(firebaseUser.uid).get();
  return userSnapshot.exists && userSnapshot.data()?.role === 'admin';
}

function sendError(res: express.Response, error: unknown) {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.publicMessage });
    return;
  }

  if (axios.isAxiosError(error)) {
    console.error('[SERVER] Erro retornado pelo PagBank:', JSON.stringify(providerErrorDetails(error)));
    res.status(502).json({ error: 'Não foi possível criar o checkout PagBank. Tente novamente.' });
    return;
  }

  console.error('[SERVER] Erro interno:', error);
  res.status(500).json({ error: 'Erro interno ao processar o checkout.' });
}

const healthHandler = (_req: express.Request, res: express.Response) => {
  if (process.env.NODE_ENV === 'production') {
    res.json({ status: 'ok', time: new Date().toISOString() });
    return;
  }
  const pagbank = getPagBankConfig();
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    pagbank_configured: Boolean(pagbank.token),
    pagbank_env: pagbank.environment,
    firebase_admin_configured: isFirebaseAdminConfigured(),
  });
};

app.get('/api/health', healthHandler);
app.get('/health', healthHandler);

app.post('/api/shipping-quote', async (req, res) => {
  try {
    enforceRateLimit(`shipping:${req.ip || 'unknown'}`, 20, 60_000);
    const { db } = getAdminServices();
    await enforceDistributedRateLimit(db, `shipping:${req.ip || 'unknown'}`, 40, 60_000);
    const body = isPlainRecord(req.body) ? req.body : {};
    const quote = await getShippingQuote('entrega', body.cep);
    res.json({
      cep: quote.cep,
      address: quote.address,
      state: quote.state,
      street: quote.street,
      neighborhood: quote.neighborhood,
      city: quote.city,
      amount_cents: quote.amountCents,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/admin/ai', async (req, res) => {
  try {
    const firebaseUser = await requireAdminUser(req);
    enforceRateLimit(`ai:${firebaseUser.uid}`, 10, 60_000);
    const { db } = getAdminServices();
    await enforceDistributedRateLimit(db, `ai:${firebaseUser.uid}`, 10, 60_000);

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new HttpError(503, 'A IA ainda não está configurada no servidor.');

    const body = isPlainRecord(req.body) ? req.body : {};
    const action = textValue(body.action, 40);
    const title = textValue(body.title, 200);
    const description = textValue(body.description, 1500);
    const customPrompt = textValue(body.prompt, 1000);

    let prompt = '';
    switch (action) {
      case 'generate':
        if (!title) throw new HttpError(422, 'Informe o nome do produto antes de gerar a descrição.');
        prompt = `Gere uma descrição clara e persuasiva para o produto "${title}". Foque nos benefícios e casos de uso para uma gráfica e loja de personalizados. Retorne somente a descrição, sem título ou introdução.`;
        break;
      case 'improveTitle':
        if (!title) throw new HttpError(422, 'Informe um título antes de melhorá-lo.');
        prompt = `Melhore o título de produto "${title}" para torná-lo claro, atraente e amigável para busca. Retorne somente o título, sem aspas ou explicações.`;
        break;
      case 'improveDescription':
        if (!description) throw new HttpError(422, 'Informe uma descrição antes de melhorá-la.');
        prompt = `Melhore a descrição de produto a seguir para deixá-la clara, profissional e persuasiva, sem inventar especificações: "${description}". Retorne somente a descrição.`;
        break;
      case 'custom':
        if (!title || !customPrompt) throw new HttpError(422, 'Informe o produto e o comando personalizado.');
        prompt = `Escreva uma descrição para o produto "${title}" seguindo estas orientações: "${customPrompt}". Não invente dados técnicos que não estejam nas orientações. Retorne somente a descrição.`;
        break;
      default:
        throw new HttpError(422, 'Ação de IA inválida.');
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL?.trim() || 'gemini-3-flash-preview',
      contents: prompt,
    });
    const suggestion = response.text?.trim();
    if (!suggestion) throw new HttpError(502, 'A IA não retornou uma sugestão válida.');

    res.json({ suggestion });
  } catch (error) {
    if (!(error instanceof HttpError)) console.error('[SERVER] Erro ao consultar IA:', error);
    sendError(res, error instanceof HttpError ? error : new HttpError(502, 'Não foi possível consultar a IA agora.'));
  }
});

const checkoutHandler = async (req: express.Request, res: express.Response) => {
  let orderRef: DocumentReference | null = null;
  let requestRef: DocumentReference | null = null;
  let ownsRequest = false;

  try {
    const pagbank = getPagBankConfig();
    if (!pagbank.token) throw new HttpError(503, 'O PagBank ainda não está configurado no servidor.');

    const firebaseUser = await requireFirebaseUser(req);
    const services = getAdminServices();
    const { db } = services;
    const body = isPlainRecord(req.body) ? req.body : {};
    const requestId = normalizedCheckoutRequestId(body.requestId);
    requestRef = checkoutRequestReference(db, firebaseUser.uid, requestId);

    const previousRequest = await requestRef.get();
    if (previousRequest.exists) {
      const previousData = previousRequest.data() as PlainRecord;
      const result = existingCheckoutResult(previousData, pagbank.environment);
      if (result) {
        res.status(200).json({ payment_method: 'hosted', ...result, reused: true });
        return;
      }
      throw new HttpError(
        409,
        previousData.status === 'creating'
          ? 'Este checkout já está sendo processado. Consulte seus pedidos em alguns instantes.'
          : 'Esta tentativa de checkout não pode ser repetida. Inicie uma nova tentativa.',
      );
    }

    enforceRateLimit(`checkout:${firebaseUser.uid}`, 1, 3_000);
    await enforceDistributedRateLimit(db, `checkout:${firebaseUser.uid}`, 5, 5 * 60_000);

    const email = typeof firebaseUser.email === 'string' ? firebaseUser.email.trim().toLowerCase() : '';
    if (!email || email.length > 60) throw new HttpError(422, 'Sua conta não possui um e-mail compatível com o PagBank.');

    const customerName = textValue(body.customerName || firebaseUser.name, 100);
    if (customerName.length < 3 || customerName.split(' ').filter(Boolean).length < 2) {
      throw new HttpError(422, 'Informe nome e sobrenome.');
    }
    const cpf = validCpf(body.cpf);
    const phone = validPhone(body.phone);
    const deliveryMethod = body.deliveryMethod as DeliveryMethod;
    const shipping = await getShippingQuote(deliveryMethod, body.cep);
    const deliveryAddress = deliveryMethod === 'entrega'
      ? {
          cep: shipping.cep,
          rua: validAddressField(body.addressStreet || shipping.street, 'a rua', 160),
          numero: validDeliveryNumber(body.addressNumber),
          complemento: textValue(body.addressComplement, 40),
          bairro: validAddressField(body.addressNeighborhood || shipping.neighborhood, 'o bairro', 60),
          cidade: shipping.city,
          estado: shipping.state,
        }
      : null;
    const normalizedCart = await normalizeCart(body.items, services, firebaseUser.uid);
    const totalCents = normalizedCart.subtotalCents + shipping.amountCents;

    if (totalCents <= 0 || totalCents > 8999999100) {
      throw new HttpError(422, 'O valor do pedido é inválido.');
    }

    const orderId = `GB-${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`;
    const reservation = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(requestRef!);
      if (snapshot.exists) return { created: false, data: snapshot.data() as PlainRecord };
      transaction.create(requestRef!, {
        userId: firebaseUser.uid,
        orderId,
        status: 'creating',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      });
      return { created: true, data: undefined };
    });

    if (!reservation.created) {
      const result = existingCheckoutResult(reservation.data, pagbank.environment);
      if (result) {
        res.status(200).json({ payment_method: 'hosted', ...result, reused: true });
        return;
      }
      throw new HttpError(409, 'Este checkout já está sendo processado. Consulte seus pedidos em alguns instantes.');
    }
    ownsRequest = true;

    const pendingArtworkPaths = await copyArtworksToOrder(
      normalizedCart.items,
      services,
      firebaseUser.uid,
      orderId,
    );
    const publicAppUrl = getPublicAppUrl(req);
    const webhookUrl = `${publicAppUrl}/api/webhook/pagbank`;
    const returnUrl = `${publicAppUrl}/?pagbank=return&orderId=${encodeURIComponent(orderId)}`;
    const checkoutExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    if (webhookUrl.length > 100) {
      throw new HttpError(500, 'A URL pública do webhook excede o limite do PagBank.');
    }
    if (returnUrl.length > 255) {
      throw new HttpError(500, 'A URL pública de retorno excede o limite do PagBank.');
    }

    orderRef = db.collection('orders').doc(orderId);
    await orderRef.create({
      id: orderId,
      userId: firebaseUser.uid,
      data: new Date().toISOString(),
      itens: normalizedCart.items.map(item => item.cartItem),
      subtotal: (normalizedCart.subtotalCents / 100).toFixed(2),
      frete: (shipping.amountCents / 100).toFixed(2),
      total: (totalCents / 100).toFixed(2),
      totalCents,
      status: 'Pendente',
      paymentStatus: 'pendente',
      fulfillmentStatus: 'aguardando_pagamento',
      pagbankStatus: 'CREATING',
      metodoEntrega: deliveryMethod,
      metodoPagamento: 'pagbank',
      checkoutRequestId: requestId,
      checkoutExpiresAt,
      ...(deliveryAddress ? {
        cep: shipping.cep,
        enderecoCep: shipping.address,
        enderecoEntrega: deliveryAddress,
      } : {}),
      clienteNome: customerName,
      clienteEmail: email,
      clienteTelefone: phone.digits,
    });

    try {
      const checkoutBody: PlainRecord = {
        reference_id: orderId,
        expiration_date: checkoutExpiresAt,
        customer: {
          name: customerName,
          email,
          tax_id: cpf,
          ...(phone.digits.length === 11 ? {
            phone: {
              country: '+55',
              area: phone.area,
              number: phone.number,
            },
          } : {}),
        },
        customer_modifiable: true,
        items: normalizedCart.items.map(item => item.checkoutItem),
        payment_methods: [
          { type: 'CREDIT_CARD' },
          { type: 'BOLETO' },
          { type: 'PIX' },
        ],
        soft_descriptor: 'GB GRAFICA',
        redirect_url: returnUrl,
        redirect_waiting_time: 5,
        return_url: returnUrl,
        notification_urls: [webhookUrl],
        payment_notification_urls: [webhookUrl],
      };

      if (deliveryAddress) {
        checkoutBody.shipping = {
          type: 'FIXED',
          service_type: 'PAC',
          amount: shipping.amountCents,
          address_modifiable: false,
          address: {
            country: 'BRA',
            region_code: deliveryAddress.estado,
            city: deliveryAddress.cidade,
            postal_code: deliveryAddress.cep,
            street: deliveryAddress.rua,
            number: deliveryAddress.numero,
            locality: deliveryAddress.bairro,
            ...(deliveryAddress.complemento ? { complement: deliveryAddress.complemento } : {}),
          },
        };
      }

      const response = await axios.post<PagBankCheckoutResponse>(
        `${pagbank.baseUrl}/checkouts`,
        checkoutBody,
        {
          headers: {
            Authorization: `Bearer ${pagbank.token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'x-idempotency-key': requestId,
          },
          timeout: 15000,
        },
      );

      const checkoutId = textValue(response.data?.id, 100);
      const payLink = trustedPagBankPayLink(
        response.data?.links?.find(link => link.rel === 'PAY')?.href,
        pagbank.environment,
      );
      if (!checkoutId || !payLink) {
        throw new HttpError(502, 'O PagBank não retornou um link de pagamento válido.');
      }

      const batch = db.batch();
      batch.set(orderRef, {
        pagbankCheckoutId: checkoutId,
        pagbankStatus: response.data.status || 'ACTIVE',
        pagbankPayUrl: payLink,
      }, { merge: true });
      batch.set(requestRef, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        checkoutId,
        payLink,
      }, { merge: true });
      await batch.commit();

      await Promise.allSettled(pendingArtworkPaths.map(path => services.bucket.file(path).delete()));

      res.status(201).json({
        payment_method: 'hosted',
        order_id: orderId,
        checkout_id: checkoutId,
        init_point: payLink,
      });
    } catch (error) {
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(orderRef!);
        if (!snapshot.exists || snapshot.data()?.paymentStatus === 'pago') return;
        transaction.set(orderRef!, {
          paymentStatus: 'erro',
          pagbankStatus: 'CREATION_FAILED',
        }, { merge: true });
      }).catch(updateError => {
        console.error('[SERVER] Não foi possível marcar pedido com erro:', updateError);
      });
      await requestRef.set({
        status: 'failed',
        failedAt: new Date().toISOString(),
      }, { merge: true }).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    if (ownsRequest && requestRef && !orderRef) {
      await requestRef.set({ status: 'failed', failedAt: new Date().toISOString() }, { merge: true }).catch(() => undefined);
    }
    sendError(res, error);
  }
};

app.post('/api/checkout', checkoutHandler);

app.get('/api/payment-status/:orderId', async (req, res) => {
  try {
    const firebaseUser = await requireFirebaseUser(req);
    const orderId = textValue(req.params.orderId, 64);
    if (!orderId || !/^[A-Za-z0-9_-]+$/.test(orderId)) throw new HttpError(400, 'Pedido inválido.');

    const { db } = getAdminServices();
    enforceRateLimit(`payment-status:${firebaseUser.uid}`, 30, 60_000);
    await enforceDistributedRateLimit(db, `payment-status:${firebaseUser.uid}`, 60, 60_000);
    const snapshot = await db.collection('orders').doc(orderId).get();
    if (!snapshot.exists) throw new HttpError(404, 'Pedido não encontrado.');

    const order = snapshot.data() as PlainRecord;
    if (order.userId !== firebaseUser.uid) throw new HttpError(403, 'Você não pode consultar este pedido.');

    res.json({
      order_id: orderId,
      status: order.paymentStatus || 'pendente',
      pagbank_status: order.pagbankStatus || null,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/admin/orders/:orderId/fulfillment', async (req, res) => {
  try {
    const firebaseUser = await requireAdminUser(req);
    const services = getAdminServices();
    const { db } = services;
    enforceRateLimit(`admin-order:${firebaseUser.uid}`, 20, 60_000);
    await enforceDistributedRateLimit(db, `admin-order:${firebaseUser.uid}`, 60, 60_000);

    const orderId = textValue(req.params.orderId, 64);
    const body = isPlainRecord(req.body) ? req.body : {};
    const requestedStatus = body.fulfillmentStatus;
    if (!orderId || !/^[A-Za-z0-9_-]+$/.test(orderId) || !isFulfillmentStatus(requestedStatus)) {
      throw new HttpError(422, 'Pedido ou etapa operacional inválida.');
    }

    const orderRef = db.collection('orders').doc(orderId);
    let appliedStatus: FulfillmentStatus = requestedStatus;
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists) throw new HttpError(404, 'Pedido não encontrado.');
      const order = snapshot.data() as PlainRecord;
      const current = currentFulfillmentStatus(order);
      const paymentStatus = order.paymentStatus as PaymentStatus | undefined;
      const deliveryMethod = order.metodoEntrega as DeliveryMethod | undefined;
      const allowed = allowedFulfillmentTransitions(current, paymentStatus, deliveryMethod);
      if (!allowed.includes(requestedStatus)) {
        throw new HttpError(
          409,
          paymentStatus !== 'pago'
            ? 'O pedido precisa estar pago antes de avançar para produção ou entrega.'
            : 'Essa mudança não respeita a sequência operacional do pedido.',
        );
      }

      appliedStatus = requestedStatus;
      transaction.set(orderRef, {
        fulfillmentStatus: requestedStatus,
        status: legacyStatusForFulfillment(requestedStatus),
        fulfillmentUpdatedAt: new Date().toISOString(),
      }, { merge: true });
      transaction.create(orderRef.collection('events').doc(randomUUID()), {
        type: 'fulfillment_status_changed',
        from: current,
        to: requestedStatus,
        actorUid: firebaseUser.uid,
        createdAt: new Date().toISOString(),
      });
    });

    res.json({ updated: true, fulfillmentStatus: appliedStatus });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/orders/:orderId/artwork/:itemId', async (req, res) => {
  try {
    const firebaseUser = await requireFirebaseUser(req);
    const services = getAdminServices();
    const { db, bucket } = services;
    enforceRateLimit(`artwork:${firebaseUser.uid}`, 20, 60_000);
    await enforceDistributedRateLimit(db, `artwork:${firebaseUser.uid}`, 60, 60_000);

    const orderId = textValue(req.params.orderId, 64);
    const itemId = textValue(req.params.itemId, 150);
    if (!orderId || !itemId || !/^[A-Za-z0-9_-]+$/.test(orderId) || !/^[A-Za-z0-9_-]+$/.test(itemId)) {
      throw new HttpError(400, 'Pedido ou item inválido.');
    }

    const snapshot = await db.collection('orders').doc(orderId).get();
    if (!snapshot.exists) throw new HttpError(404, 'Pedido não encontrado.');
    const order = snapshot.data() as PlainRecord;
    if (order.userId !== firebaseUser.uid && !(await userIsAdmin(firebaseUser, db))) {
      throw new HttpError(403, 'Você não pode acessar esta arte.');
    }

    const items = Array.isArray(order.itens) ? order.itens.filter(isPlainRecord) : [];
    const item = items.find(candidate => candidate.id === itemId);
    const artworkPath = item?.arquivoPath;
    if (!isOrderArtworkPath(artworkPath, String(order.userId || ''), orderId)) {
      throw new HttpError(404, 'Este item não possui uma arte armazenada.');
    }

    const file = bucket.file(artworkPath);
    const [exists] = await file.exists();
    if (!exists) throw new HttpError(404, 'O arquivo da arte não está mais disponível.');
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 5 * 60_000,
      responseDisposition: 'attachment',
    });
    res.json({ url, expires_in: 300, filename: textValue(item?.arquivoNome, 120) || 'arte' });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/webhook/pagbank', async (req: express.Request, res: express.Response) => {
  try {
    enforceRateLimit(`webhook:${req.ip || 'unknown'}`, 120, 60_000);
  } catch (error) {
    sendError(res, error);
    return;
  }
  const pagbank = getPagBankConfig();
  if (!pagbank.token) {
    res.status(503).json({ error: 'Webhook PagBank não configurado.' });
    return;
  }

  const rawBody = (req as RawBodyRequest).rawBody;
  const authenticityToken = req.get('x-authenticity-token')?.trim();
  if (typeof rawBody !== 'string' || !authenticityToken || !/^[a-f0-9]{64}$/i.test(authenticityToken)) {
    res.status(401).json({ error: 'Notificação não autenticada.' });
    return;
  }

  if (!verifyPagBankAuthenticity(pagbank.token, rawBody, authenticityToken)) {
    res.status(401).json({ error: 'Notificação não autenticada.' });
    return;
  }

  try {
    const payload = JSON.parse(rawBody) as PlainRecord;
    const event = parsePagBankWebhookEvent(payload);
    if (!event || !/^[A-Za-z0-9_-]+$/.test(event.referenceId)) {
      throw new HttpError(400, 'Notificação sem pedido válido.');
    }

    let db: ReturnType<typeof getAdminServices>['db'];
    try {
      db = getAdminServices().db;
    } catch (error) {
      console.error('[SERVER] Firebase Admin indisponível para webhook:', error);
      res.status(503).json({ error: 'Webhook temporariamente indisponível.' });
      return;
    }
    const orderRef = db.collection('orders').doc(event.referenceId);
    const eventHash = createHash('sha256').update(rawBody, 'utf8').digest('hex');
    const eventRef = orderRef.collection('pagbankEvents').doc(eventHash);
    let duplicate = false;
    let applied = false;

    await db.runTransaction(async transaction => {
      const orderSnapshot = await transaction.get(orderRef);
      const eventSnapshot = await transaction.get(eventRef);
      if (!orderSnapshot.exists) throw new HttpError(404, 'Pedido não encontrado.');
      if (eventSnapshot.exists) {
        duplicate = true;
        return;
      }

      const currentOrder = orderSnapshot.data() as PlainRecord;
      const validationError = validatePagBankWebhookEvent(event, currentOrder);
      if (validationError) {
        console.error(`[SERVER] Webhook rejeitado para ${event.referenceId}: ${validationError}`);
        throw new HttpError(422, 'A notificação não corresponde aos dados do pedido.');
      }

      applied = shouldApplyPaymentStatus(currentOrder.paymentStatus, event.paymentStatus);
      transaction.create(eventRef, {
        providerId: event.providerId,
        ...(event.chargeId ? { chargeId: event.chargeId } : {}),
        providerStatus: event.providerStatus,
        ...(event.paymentStatus ? { paymentStatus: event.paymentStatus } : {}),
        ...(event.amountCents !== null ? { amountCents: event.amountCents } : {}),
        ...(event.currency ? { currency: event.currency } : {}),
        kind: event.kind,
        applied,
        receivedAt: new Date().toISOString(),
      });

      if (!applied || !event.paymentStatus) return;
      const update: PlainRecord = {
        paymentStatus: event.paymentStatus,
        pagbankStatus: event.providerStatus,
        pagbankLastEventAt: new Date().toISOString(),
        ...(event.providerId.startsWith('CHEC_') ? { pagbankCheckoutId: event.providerId } : {}),
        ...(event.providerId.startsWith('ORDE_') ? { pagbankOrderId: event.providerId } : {}),
        ...(event.chargeId ? { pagbankChargeId: event.chargeId } : {}),
      };

      if (event.paymentStatus === 'pago') {
        const fulfillment = currentFulfillmentStatus(currentOrder);
        update.status = 'Pago';
        if (fulfillment === 'aguardando_pagamento') {
          update.fulfillmentStatus = 'pagamento_confirmado';
        }
      }
      transaction.set(orderRef, update, { merge: true });
    });

    res.status(200).json({ received: true, duplicate, applied });
  } catch (error) {
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: 'Notificação inválida.' });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.publicMessage });
      return;
    }
    console.error('[SERVER] Erro ao processar webhook PagBank:', error);
    res.status(500).json({ error: 'Erro ao processar notificação.' });
  }
});

export default app;
