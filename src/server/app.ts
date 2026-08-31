import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { getAdminServices, isFirebaseAdminConfigured } from './firebaseAdmin.js';
import type { DocumentReference } from 'firebase-admin/firestore';

type RawBodyRequest = express.Request & { rawBody?: string };
type PlainRecord = Record<string, unknown>;

interface ShippingQuote {
  cep: string;
  amountCents: number;
  address: string;
  state: string;
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
    arquivoUrl?: string;
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

const app = express();

function configuredOrigin(): string | null {
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) return null;

  try {
    return new URL(appUrl).origin;
  } catch {
    return null;
  }
}

app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigin = configuredOrigin();

    // Requests without an Origin include server-to-server webhooks and local tools.
    if (!origin || !allowedOrigin || origin === allowedOrigin) {
      callback(null, true);
      return;
    }

    callback(new Error('Origem não autorizada.'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Authenticity-Token'],
}));

app.use(express.json({
  limit: '256kb',
  verify: (request, _response, buffer) => {
    (request as RawBodyRequest).rawBody = buffer.toString('utf8');
  },
}));

app.use((req, _res, next) => {
  console.log(`[SERVER] ${req.method} ${req.url}`);
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
      return configuredUrl.replace(/\/+$/, '');
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

function moneyToCents(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new HttpError(422, 'Preço de produto inválido.');
    return Math.round(value * 100);
  }

  if (typeof value !== 'string') throw new HttpError(422, 'Preço de produto inválido.');

  let normalized = value.trim().replace(/R\$\s?/gi, '').replace(/\s/g, '');
  normalized = normalized.replace(/[^\d,.-]/g, '');

  if (normalized.includes(',')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if ((normalized.match(/\./g) || []).length > 1) {
    const parts = normalized.split('.');
    const decimalPart = parts.pop() || '';
    normalized = `${parts.join('')}.${decimalPart}`;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) throw new HttpError(422, 'Preço de produto inválido.');

  return Math.round(parsed * 100);
}

function validCpf(value: unknown): string {
  const cpf = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  if (cpf.length !== 11 || /^([0-9])\1{10}$/.test(cpf)) {
    throw new HttpError(422, 'Informe um CPF válido.');
  }

  const calculateDigit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  if (calculateDigit(9) !== Number(cpf[9]) || calculateDigit(10) !== Number(cpf[10])) {
    throw new HttpError(422, 'Informe um CPF válido.');
  }

  return cpf;
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

async function getShippingQuote(deliveryMethod: unknown, cepValue: unknown): Promise<ShippingQuote> {
  if (deliveryMethod === 'retirada') {
    return { cep: '', amountCents: 0, address: '', state: '' };
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

    return { cep, amountCents, address, state };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('[SERVER] Erro ao validar CEP:', error);
    throw new HttpError(502, 'Não foi possível validar o CEP agora. Tente novamente.');
  }
}

async function normalizeCart(itemsValue: unknown, db: ReturnType<typeof getAdminServices>['db']): Promise<{
  items: NormalizedCartItem[];
  subtotalCents: number;
}> {
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
        ? attribute.opcoes.filter((option): option is string => typeof option === 'string').map(option => option.trim())
        : [];
      if (!name || options.length === 0 || attributeNames.includes(name)) {
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
      const selection = rawSelections[attribute.name];
      if (typeof selection !== 'string' || !attribute.options.includes(selection)) {
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
    const rawPrice = normalizedAttributes.length > 0
      ? combinations[combinationKey] ?? product.preco_base
      : product.preco_base;
    const unitAmount = moneyToCents(rawPrice);

    if (unitAmount <= 0 || unitAmount > 999999900) {
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
    const fileUrl = productType === 'arte' ? httpUrl(item.arquivoUrl) : undefined;
    const customText = productType === 'texto' ? textValue(item.textoPersonalizado, 500) : undefined;
    const selectionSuffix = Object.values(selections).join('-').replace(/[^\p{L}\p{N}-]+/gu, '-').slice(0, 80);
    const cartId = `${productId}-${selectionSuffix || index}`.slice(0, 150);
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
        ...(fileUrl ? { arquivoUrl: fileUrl } : {}),
        ...(customText ? { textoPersonalizado: customText } : {}),
      },
      checkoutItem: {
        reference_id: productId.slice(0, 64),
        name: productName,
        description: productDescription,
        quantity,
        unit_amount: unitAmount,
        // ...(productImage ? { image_url: productImage } : {}),
      },
      amountCents: lineAmount,
    });
  }

  return { items: normalizedItems, subtotalCents };
}

function isTerminalPaymentStatus(status: unknown): boolean {
  return status === 'pago' || status === 'recusado' || status === 'cancelado' || status === 'expirado';
}

function shouldApplyPaymentStatus(current: unknown, incoming: string): boolean {
  if (current === 'pago' && incoming !== 'pago') return false;
  if (isTerminalPaymentStatus(current) && !isTerminalPaymentStatus(incoming)) return false;
  return true;
}

function mapPagBankPaymentStatus(status: unknown): string {
  switch (status) {
    case 'PAID':
      return 'pago';
    case 'IN_ANALYSIS':
      return 'em_analise';
    case 'DECLINED':
      return 'recusado';
    case 'CANCELED':
      return 'cancelado';
    case 'EXPIRED':
      return 'expirado';
    default:
      return 'pendente';
  }
}

function constantTimeMatch(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(received, 'utf8');
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

function providerErrorDetails(error: unknown): unknown {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : String(error);
  return {
    status: error.response?.status,
    data: error.response?.data,
  };
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

const checkoutHandler = async (req: express.Request, res: express.Response) => {
  let orderRef: DocumentReference | null = null;

  try {
    const pagbank = getPagBankConfig();
    if (!pagbank.token) throw new HttpError(503, 'O PagBank ainda não está configurado no servidor.');

    const firebaseUser = await requireFirebaseUser(req);
    const { db } = getAdminServices();
    const body = isPlainRecord(req.body) ? req.body : {};
    const email = typeof firebaseUser.email === 'string' ? firebaseUser.email.trim().toLowerCase() : '';
    if (!email) throw new HttpError(422, 'Sua conta não possui um e-mail válido.');

    const customerName = textValue(body.customerName || firebaseUser.name, 100);
    if (customerName.length < 3) throw new HttpError(422, 'Informe seu nome completo.');
    const cpf = validCpf(body.cpf);
    const shipping = await getShippingQuote(body.deliveryMethod, body.cep);
    const normalizedCart = await normalizeCart(body.items, db);
    const totalCents = normalizedCart.subtotalCents + shipping.amountCents;

    if (totalCents <= 0 || totalCents > 8999999100) {
      throw new HttpError(422, 'O valor do pedido é inválido.');
    }

    const orderId = `GB-${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`;
    const publicAppUrl = getPublicAppUrl(req);
    const webhookUrl = `${publicAppUrl}/api/webhook/pagbank`;
    const returnUrl = `${publicAppUrl}/?pagbank=return&orderId=${encodeURIComponent(orderId)}`;

    if (webhookUrl.length > 100) {
      throw new HttpError(500, 'A URL pública do webhook excede o limite do PagBank.');
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
      status: 'Pendente',
      paymentStatus: 'pendente',
      pagbankStatus: 'CREATING',
      metodoEntrega: body.deliveryMethod,
      metodoPagamento: 'pagbank',
      ...(shipping.cep ? { cep: shipping.cep, enderecoCep: shipping.address } : {}),
      clienteNome: customerName,
      clienteEmail: email,
    });

    try {
      const checkoutBody: PlainRecord = {
        reference_id: orderId,
        expiration_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        customer: {
          name: customerName,
          email,
          tax_id: cpf,
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
        return_url: returnUrl,
        notification_urls: [webhookUrl],
        payment_notification_urls: [webhookUrl],
      };

      if (body.deliveryMethod === 'entrega') {
        checkoutBody.shipping = {
          type: 'FIXED',
          service_type: 'PAC',
          amount: shipping.amountCents,
          address_modifiable: true,
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
          },
          timeout: 15000,
        },
      );

      const checkoutId = textValue(response.data?.id, 100);
      const payLink = response.data?.links?.find(link => link.rel === 'PAY')?.href;
      if (!checkoutId || !httpUrl(payLink)) {
        throw new HttpError(502, 'O PagBank não retornou um link de pagamento válido.');
      }

      await orderRef.set({
        pagbankCheckoutId: checkoutId,
        pagbankStatus: response.data.status || 'ACTIVE',
      }, { merge: true });

      res.status(201).json({
        payment_method: 'hosted',
        order_id: orderId,
        checkout_id: checkoutId,
        init_point: payLink,
      });
    } catch (error) {
      await orderRef.set({
        paymentStatus: 'erro',
        pagbankStatus: 'CREATION_FAILED',
      }, { merge: true }).catch(updateError => {
        console.error('[SERVER] Não foi possível marcar pedido com erro:', updateError);
      });
      throw error;
    }
  } catch (error) {
    sendError(res, error);
  }
};

app.post('/api/checkout', checkoutHandler);
app.post('/checkout', checkoutHandler);

app.get('/api/payment-status/:orderId', async (req, res) => {
  try {
    const firebaseUser = await requireFirebaseUser(req);
    const orderId = textValue(req.params.orderId, 64);
    if (!orderId || !/^[A-Za-z0-9_-]+$/.test(orderId)) throw new HttpError(400, 'Pedido inválido.');

    const { db } = getAdminServices();
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

app.post('/api/webhook/pagbank', async (req: express.Request, res: express.Response) => {
  const pagbank = getPagBankConfig();
  if (!pagbank.token) {
    res.status(503).json({ error: 'Webhook PagBank não configurado.' });
    return;
  }

  const rawBody = (req as RawBodyRequest).rawBody;
  const authenticityToken = req.get('x-authenticity-token')?.trim();
  if (typeof rawBody !== 'string' || !authenticityToken) {
    res.status(401).json({ error: 'Notificação não autenticada.' });
    return;
  }

  const expectedToken = createHash('sha256')
    .update(`${pagbank.token}-${rawBody}`, 'utf8')
    .digest('hex');

  if (!constantTimeMatch(expectedToken, authenticityToken)) {
    res.status(401).json({ error: 'Notificação não autenticada.' });
    return;
  }

  try {
    const payload = JSON.parse(rawBody) as PlainRecord;
    const charges = Array.isArray(payload.charges) && isPlainRecord(payload.charges[0])
      ? payload.charges[0]
      : null;
    const referenceId = textValue(payload.reference_id || charges?.reference_id, 64);
    if (!referenceId || !/^[A-Za-z0-9_-]+$/.test(referenceId)) {
      res.status(400).json({ error: 'Notificação sem pedido válido.' });
      return;
    }

    const paymentProviderStatus = charges?.status || payload.status || 'WAITING';
    const paymentStatus = mapPagBankPaymentStatus(paymentProviderStatus);
    let db;
    try {
      db = getAdminServices().db;
    } catch (error) {
      console.error('[SERVER] Firebase Admin indisponível para webhook:', error);
      res.status(503).json({ error: 'Webhook temporariamente indisponível.' });
      return;
    }
    const orderRef = db.collection('orders').doc(referenceId);
    const orderSnapshot = await orderRef.get();
    if (!orderSnapshot.exists) {
      res.status(404).json({ error: 'Pedido não encontrado.' });
      return;
    }

    const currentOrder = orderSnapshot.data() as PlainRecord;
    if (shouldApplyPaymentStatus(currentOrder.paymentStatus, paymentStatus)) {
      const providerId = textValue(payload.id, 100);
      const chargeId = textValue(charges?.id, 100);
      const update: PlainRecord = {
        paymentStatus,
        pagbankStatus: textValue(paymentProviderStatus, 50) || 'WAITING',
        pagbankLastEventAt: new Date().toISOString(),
        ...(providerId.startsWith('CHEC_') ? { pagbankCheckoutId: providerId } : {}),
        ...(providerId.startsWith('ORDE_') ? { pagbankOrderId: providerId } : {}),
        ...(providerId.startsWith('CHAR_') ? { pagbankChargeId: providerId } : {}),
        ...(chargeId ? { pagbankChargeId: chargeId } : {}),
      };

      if (paymentStatus === 'pago') update.status = 'Pago';
      await orderRef.set(update, { merge: true });
    }

    res.status(200).json({ received: true });
  } catch (error) {
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: 'Notificação inválida.' });
      return;
    }
    console.error('[SERVER] Erro ao processar webhook PagBank:', error);
    res.status(500).json({ error: 'Erro ao processar notificação.' });
  }
});

export default app;
