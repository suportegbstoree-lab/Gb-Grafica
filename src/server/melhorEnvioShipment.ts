import axios from 'axios';
import { isValidCpf, parseMoneyToCents } from '../lib/commerce.js';
import { canIssueMelhorEnvioLabel, isRecord, validShippingParcel, type ShippingParcel } from '../lib/shipping.js';
import { validMelhorEnvioTrackingCode } from '../lib/tracking.js';
import { melhorEnvioHosts, melhorEnvioMoneyToCents, type MelhorEnvioConfig } from './melhorEnvio.js';
import { ShippingError } from './shippingError.js';

export const shipmentFailure = (status: number, message: string) =>
  new ShippingError(status, 'MELHOR_ENVIO_SHIPMENT', message);

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const stateCode = /^[A-Z]{2}$/;
const text = (value: unknown, max: number) =>
  typeof value === 'string' && !/[\x00-\x1f\x7f]/.test(value) && value.trim().length <= max ? value.trim() : '';
const digits = (value: unknown) => typeof value === 'string' && /^[0-9 .()+/-]+$/.test(value) ? value.replace(/\D/g, '') : '';

function brazilianDocument(value: unknown) {
  const cpf = digits(value);
  if (isValidCpf(cpf)) return { document: cpf };
  const cnpj = typeof value === 'string' ? value.trim().toUpperCase().replace(/[.\/-]/g, '') : '';
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^(.)\1+$/.test(cnpj)) return null;
  for (const length of [12, 13]) {
    const sum = [...cnpj.slice(0, length)].reduce((total, letter, index) =>
      total + (letter.charCodeAt(0) - 48) * (2 + ((length - index - 1) % 8)), 0);
    if (Number(cnpj[length]) !== (sum % 11 < 2 ? 0 : 11 - sum % 11)) return null;
  }
  return { company_document: cnpj };
}

function address(value: Record<string, unknown>) {
  const result = {
    name: text(value.name, 150), email: text(value.email, 254), phone: digits(value.phone),
    address: text(value.address, 160), number: text(value.number, 20),
    district: text(value.district, 100), city: text(value.city, 90),
    postal_code: digits(value.postal_code), state_abbr: text(value.state_abbr, 2).toUpperCase(),
    ...(text(value.complement, 100) ? { complement: text(value.complement, 100) } : {}),
    country_id: 'BR',
  };
  if (!result.name || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result.email) ||
    !/^\d{10,13}$/.test(result.phone) || !result.address || !result.number || !result.district ||
    !result.city || !/^\d{8}$/.test(result.postal_code) || !stateCode.test(result.state_abbr)) return null;
  return result;
}

export function validateShipmentSender(config: MelhorEnvioConfig, invoice: boolean) {
  let data: unknown;
  try { data = JSON.parse(process.env.MELHOR_ENVIO_SENDER || ''); } catch { data = null; }
  const source = isRecord(data) ? data : {};
  const contact = address({ ...source, postal_code: config.originCep });
  const document = brazilianDocument(source.document);
  const registration = text(source.state_register, 24);
  const activity = digits(source.economic_activity_code);
  if (!contact || !document || (invoice && (!('company_document' in document) || !registration)))
    throw shipmentFailure(503, 'Confira o remetente do Melhor Envio e o CNPJ e a inscrição estadual para envio com NF-e.');
  return { ...contact, ...document, state_register: invoice ? registration : 'ISENTO',
    ...(activity ? { economic_activity_code: activity } : {}) };
}

export function shipmentCartBody(
  orderId: string, order: Record<string, unknown>, fields: Record<string, unknown>,
  config: MelhorEnvioConfig, sandboxSample = false,
) {
  const shipping = isRecord(order.shipping) ? order.shipping : {};
  const service = /^me:([1-9]\d{0,8})$/.exec(String(shipping.service_code))?.[1];
  if (!service || shipping.provider !== 'melhor_envio' || shipping.origin_cep !== config.originCep)
    throw shipmentFailure(422, 'O frete registrado e o CEP do remetente precisam corresponder a este envio.');
  const parcels = Array.isArray(shipping.parcels) ? shipping.parcels : [];
  if (!parcels.length || parcels.length > 20 || !parcels.every(p => isRecord(p) && validShippingParcel(p as unknown as ShippingParcel)))
    throw shipmentFailure(422, 'Confira os volumes gravados no pedido.');
  const carrier = String(shipping.carrier_name ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (!canIssueMelhorEnvioLabel({ carrier_name: carrier, service_code: `me:${service}` }, parcels.length))
    throw shipmentFailure(422, 'Este serviço não permite emitir a etiqueta no painel para estes volumes. Alguns serviços exigem uma distribuição de produtos por volume.');
  const invoiceKey = digits(fields.invoiceKey);
  if (!sandboxSample && !/^\d{44}$/.test(invoiceKey))
    throw shipmentFailure(422, 'Informe a chave de 44 dígitos da NF-e.');
  if (sandboxSample && config.environment !== 'sandbox')
    throw shipmentFailure(422, 'O pedido de exemplo só pode ser enviado ao sandbox.');
  const document = brazilianDocument(fields.recipientDocument);
  const delivery = isRecord(order.enderecoEntrega) ? order.enderecoEntrega : {};
  const to = address({
    name: order.clienteNome, phone: order.clienteTelefone, email: order.clienteEmail,
    address: delivery.rua, number: delivery.numero, district: delivery.bairro, city: delivery.cidade,
    postal_code: delivery.cep, state_abbr: delivery.estado, complement: delivery.complemento,
  });
  if (!document || !to || to.postal_code !== shipping.destination_cep)
    throw shipmentFailure(422, 'Confira o CPF/CNPJ e os dados de entrega do destinatário no pedido.');
  const from = validateShipmentSender(config, !sandboxSample);
  if (!Array.isArray(order.itens) || !order.itens.length || order.itens.length > 50)
    throw shipmentFailure(422, 'O pedido precisa ter itens para declarar.');
  const products = order.itens.map(item => {
    if (!isRecord(item)) throw shipmentFailure(422, 'Revise os itens do pedido.');
    const name = text(item.nome, 160), cents = parseMoneyToCents(item.preco);
    const quantity = typeof item.quantidade === 'number' ? item.quantidade : 0;
    if (!name || cents === null || cents <= 0 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999)
      throw shipmentFailure(422, 'Revise os nomes, valores e quantidades dos itens do pedido.');
    return { name, quantity, unitary_value: (cents / 100).toFixed(2), cents };
  });
  const subtotal = products.reduce((total, p) => total + p.cents * p.quantity, 0);
  const coupon = isRecord(order.cupom) && typeof order.cupom.discountCents === 'number' ? order.cupom.discountCents : 0;
  const insuranceCents = subtotal - coupon;
  if (!Number.isSafeInteger(insuranceCents) || insuranceCents <= 0)
    throw shipmentFailure(422, 'Confira o valor das mercadorias declarado no pedido.');
  const agency = text(fields.agency, 10);
  if ((fields.agency && !/^[1-9]\d{0,8}$/.test(agency)) || (/latam|buslog/.test(carrier) && !agency))
    throw shipmentFailure(422, 'Informe o ID da agência de postagem para este serviço.');
  return {
    service: Number(service), ...(agency ? { agency: Number(agency) } : {}),
    from, to: { ...to, ...document },
    products: products.map(({ cents: _cents, ...product }) => product),
    volumes: parcels.map(p => ({ height: p.heightCm, width: p.widthCm, length: p.lengthCm, weight: p.weightGrams / 1000 })),
    options: {
      platform: 'GB Gráfica', insurance_value: insuranceCents / 100,
      ...(sandboxSample ? { non_commercial: true } : { invoice: { key: invoiceKey } }),
      tags: [{ tag: orderId, url: null }],
    },
  };
}

export class ShipmentProviderError extends ShippingError {
  constructor(public readonly rejected: boolean, status: number, message: string) {
    super(status, 'MELHOR_ENVIO_SHIPMENT', message);
  }
}

function provider(config: MelhorEnvioConfig) {
  return async (path: string, body?: unknown, pdf = false, method = body === undefined ? 'GET' : 'POST'): Promise<unknown> => {
    let response;
    try {
      response = await axios.request({
        method,
        url: `${melhorEnvioHosts[config.environment]}/api/v2/me/${path}`, data: body,
        headers: {
          Authorization: `Bearer ${config.token}`,
          'User-Agent': `GB Grafica (${config.contactEmail})`,
          Accept: pdf ? 'application/pdf, application/json' : 'application/json',
          'Content-Type': 'application/json',
        },
        responseType: pdf ? 'arraybuffer' : 'json',
        timeout: 8000, maxRedirects: 0, maxContentLength: pdf ? 3 * 1024 * 1024 : 512 * 1024,
        validateStatus: () => true,
      });
    } catch {
      throw new ShipmentProviderError(false, 502, 'O Melhor Envio não confirmou a operação. Consulte a situação antes de continuar.');
    }
    if (response.status >= 200 && response.status < 300) return response.data;
    if (response.status === 401 || response.status === 403)
      throw new ShipmentProviderError(true, 503, 'Confira as permissões do token do Melhor Envio para esta operação.');
    if (pdf && ([400, 404, 406, 415, 422].includes(response.status) ||
      (response.status >= 300 && response.status < 400))) return null;
    if ([400, 402, 422].includes(response.status))
      throw new ShipmentProviderError(true, 422, 'O Melhor Envio recusou a operação. Confira saldo, dados fiscais e condições do serviço.');
    throw new ShipmentProviderError(false, 502, 'O Melhor Envio não confirmou a operação. Consulte a situação antes de continuar.');
  };
}

export function shipmentProvider(config: MelhorEnvioConfig) {
  const request = provider(config);
  function timestamp(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    // Prefer timezone-aware provider values. Some endpoints use SQL UTC timestamps.
    const input = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(' ', 'T') + 'Z' : value;
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(input)) return undefined;
    const date = Date.parse(input);
    return Number.isFinite(date) ? new Date(date).toISOString() : undefined;
  }
  return {
    async create(body: ReturnType<typeof shipmentCartBody>) {
      const data = await request('cart', body);
      if (!isRecord(data) || typeof data.id !== 'string' || !uuid.test(data.id))
        throw new ShipmentProviderError(false, 502, 'O Melhor Envio não informou o ID do envio. Confira o carrinho pelo número do pedido.');
      return { id: data.id, amountCents: melhorEnvioMoneyToCents(data.price) };
    },
    async details(id: string) {
      if (!uuid.test(id)) throw shipmentFailure(422, 'Identificador de etiqueta inválido.');
      const data = await request(`orders/${id}`);
      if (!isRecord(data) || data.id !== id)
        throw shipmentFailure(502, 'O Melhor Envio retornou um envio diferente do registrado.');
      const state = String(data.status ?? '').toLowerCase();
      const postedAt = timestamp(data.posted_at), deliveredAt = timestamp(data.delivered_at);
      const discarded = Boolean(data.canceled_at || data.cancelled_at || data.expired_at) ||
        ['canceled', 'cancelled', 'expired'].includes(state);
      const unavailable = discarded || Boolean(data.suspended_at) || state === 'suspended';
      return {
        amountCents: melhorEnvioMoneyToCents(data.price),
        paid: Boolean(data.paid_at || data.generated_at || ['released', 'generated', 'received', 'posted', 'delivered', 'undelivered', 'paused'].includes(state)),
        issued: Boolean(data.generated_at || ['generated', 'received', 'posted', 'delivered', 'undelivered', 'paused'].includes(state)),
        pending: state === 'pending',
        state, postedAt, deliveredAt,
        unavailable, discarded,
        tracking: validMelhorEnvioTrackingCode(data.tracking) ? data.tracking : '',
        service: Number(data.service_id),
        tags: Array.isArray(data.tags) ? data.tags : [],
      };
    },
    async removeCartItem(id: string) {
      if (!uuid.test(id)) throw shipmentFailure(422, 'Identificador de etiqueta inválido.');
      await request(`cart/${id}`, undefined, false, 'DELETE');
    },
    checkout: (id: string) => request('shipment/checkout', { orders: [id] }),
    generate: (id: string) => request('shipment/generate', { orders: [id] }),
    async print(id: string) {
      if (!uuid.test(id)) throw shipmentFailure(422, 'Identificador de etiqueta inválido.');
      const raw = await request(`imprimir/pdf/${id}`, undefined, true);
      if (raw instanceof Uint8Array && Buffer.from(raw.subarray(0, 5)).toString() === '%PDF-')
        return Buffer.from(raw);

      let data: unknown;
      try {
        data = await request('shipment/print', { mode: 'private', orders: [id] });
      } catch (error) {
        if (error instanceof ShipmentProviderError && error.status === 422)
          throw shipmentFailure(409, 'O Melhor Envio recusou o link privado de impressão. Confira esta etiqueta no painel do Melhor Envio.');
        throw error;
      }
      const rawUrl = isRecord(data) && typeof data.url === 'string' ? data.url : '';
      const url = URL.canParse(rawUrl) ? new URL(rawUrl) : null;
      const origin = melhorEnvioHosts[config.environment];
      const allowed = url && (url.origin === origin ||
        (config.environment === 'production' && url.origin === 'https://www.melhorenvio.com.br'));
      if (!allowed || url.username || url.password)
        throw shipmentFailure(502, 'O Melhor Envio não retornou um link de impressão válido para este ambiente.');
      return { printUrl: url.href };
    },
  };
}
