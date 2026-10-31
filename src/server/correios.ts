import axios from 'axios';
import { validTrackingCode } from '../lib/tracking.js';
import { parseCorreiosTracking, type CorreiosTrackingEvent } from './correiosTrackingResponse.js';
import { createHash } from 'node:crypto';
import { isRecord, validShippingParcel, type ShippingOption, type ShippingParcel } from '../lib/shipping.js';

import { CorreiosError } from './correiosError.js';
export { CorreiosError } from './correiosError.js';

type Environment = Record<string, string | undefined>;
export interface CorreiosConfig {
  environment: 'production' | 'homologation';
  baseUrl: string;
  originCep: string;
  services: Array<{ code: string; name: 'PAC' | 'SEDEX' }>;
  token?: string;
  user?: string;
  accessCode?: string;
  postingCard?: string;
  contract?: string;
  regional?: number;
}

function configurationError(): CorreiosError {
  return new CorreiosError(503, 'CORREIOS_CONFIGURATION', 'O frete dos Correios ainda precisa ser configurado pela loja.');
}

export function correiosConfig(env: Environment = process.env): CorreiosConfig {
  const environment = env.CORREIOS_ENV?.trim() || 'production';
  const originCep = env.CORREIOS_ORIGIN_CEP?.trim().replace(/\D/g, '') || '';
  const rawServices = env.CORREIOS_SERVICES?.trim().split(',') || [];
  if (!['production', 'homologation'].includes(environment) || !/^\d{8}$/.test(originCep)
    || rawServices.length < 1 || rawServices.length > 3) throw configurationError();
  const services = rawServices.map(value => {
    const match = value.trim().match(/^(\d{5}):(PAC|SEDEX)$/);
    if (!match) throw configurationError();
    return { code: match[1], name: match[2] as 'PAC' | 'SEDEX' };
  });
  if (new Set(services.map(service => service.code)).size !== services.length) throw configurationError();
  const user = env.CORREIOS_USER?.trim();
  const accessCode = env.CORREIOS_ACCESS_CODE?.trim();
  const postingCard = env.CORREIOS_POSTING_CARD?.trim();
  const token = env.CORREIOS_TOKEN?.trim().replace(/^Bearer\s+/i, '');
  const hasCredentials = Boolean(user || accessCode || postingCard);
  if (hasCredentials && (!user || !accessCode || !postingCard || user.includes(':')
    || /[\r\n]/.test(user + accessCode) || user.length > 200 || accessCode.length > 1000
    || !/^\d{6,20}$/.test(postingCard))) throw configurationError();
  if (!hasCredentials && (!token || token.length > 16_384 || !/^[A-Za-z0-9._~+\/-]+=*$/.test(token))) throw configurationError();
  const contract = env.CORREIOS_CONTRACT?.trim() || undefined;
  const regionalText = env.CORREIOS_REGIONAL?.trim();
  const regional = regionalText ? Number(regionalText) : undefined;
  if ((contract && !/^\d{6,20}$/.test(contract))
    || (regional !== undefined && (!/^\d{1,2}$/.test(regionalText!) || regional < 1 || regional > 99))) throw configurationError();
  return {
    environment: environment as CorreiosConfig['environment'],
    baseUrl: environment === 'production' ? 'https://api.correios.com.br' : 'https://apihom.correios.com.br',
    originCep, services,
    ...(hasCredentials ? { user, accessCode, postingCard } : { token }),
    ...(contract ? { contract } : {}), ...(regional !== undefined ? { regional } : {}),
  };
}

export type CorreiosTransport = (
  url: string, body: unknown, authorization: string, signal?: AbortSignal,
) => Promise<{ status: number; data: unknown }>;

const transport: CorreiosTransport = async (url, body, authorization, signal) => {
  try {
    return await axios.post(url, body, {
      headers: { Authorization: authorization, Accept: 'application/json', 'Content-Type': 'application/json' },
      timeout: 6000, signal, maxRedirects: 0, maxContentLength: 512 * 1024, maxBodyLength: 128 * 1024,
      responseType: 'json', validateStatus: () => true,
    });
  } catch {
    // Nunca encaminhar o AxiosError: contém headers, credenciais e corpo da requisição.
    throw new CorreiosError(502, 'CORREIOS_UNAVAILABLE', 'Não foi possível consultar os Correios agora. Tente novamente.');
  }
};

export function correiosMoneyToCents(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 20) return null;
  const text = value.trim();
  let normalized: string;
  if (/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/.test(text)) normalized = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d+(?:\.\d{2})?$/.test(text)) normalized = text;
  else return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100_000_000 ? cents : null;
}

function jwtExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return Number.isSafeInteger(payload.exp) ? payload.exp * 1000 : null;
  } catch { return null; }
}

function responseExpiry(data: Record<string, unknown>, token: string): number | null {
  const jwt = jwtExpiry(token);
  let date: number | null = null;
  if (typeof data.expiraEm === 'string') {
    const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(data.expiraEm);
    const offset = typeof data.zoneOffset === 'string' && /^[+-]\d{2}:\d{2}$/.test(data.zoneOffset) ? data.zoneOffset : '-03:00';
    const parsed = Date.parse(data.expiraEm + (hasZone ? '' : offset));
    if (Number.isFinite(parsed)) date = parsed;
  }
  return jwt !== null && date !== null ? Math.min(jwt, date) : jwt ?? date;
}

function providerError(status: number, authenticating = false): CorreiosError {
  if ([400, 401, 403, 404].includes(status)) {
    return new CorreiosError(503, authenticating || status !== 401 ? 'CORREIOS_ACCESS_DENIED' : 'CORREIOS_TOKEN_EXPIRED',
      status === 401 && !authenticating
        ? 'O acesso aos Correios expirou. A loja precisa renovar a configuração de frete.'
        : 'Confira as credenciais e a liberação das APIs de preço e prazo dos Correios.');
  }
  return new CorreiosError(502, 'CORREIOS_UNAVAILABLE', 'O serviço de frete está indisponível. Tente novamente em instantes.');
}

export type TrackingTransport = (url: string, authorization: string, signal: AbortSignal) => Promise<{ status: number; data: unknown }>;
const trackingTransport: TrackingTransport = async (url, authorization, signal) => {
  try { return await axios.get(url, { headers: { Authorization: authorization, Accept: 'application/json' }, timeout: 6000,
    signal, maxRedirects: 0, maxContentLength: 512 * 1024, responseType: 'json', validateStatus: () => true }); }
  catch { throw new CorreiosError(502, 'CORREIOS_TRACKING_UNAVAILABLE', 'Não foi possível consultar o rastreio agora.'); }
};

export class CorreiosClient {
  private cachedToken: { token: string; expiresAt: number } | null = null;
  private tokenPending: Promise<string> | null = null;

  constructor(private readonly config: CorreiosConfig, private readonly request: CorreiosTransport = transport,
    private readonly now: () => number = Date.now, private readonly trackingRequest: TrackingTransport = trackingTransport) {}

  private async getToken(): Promise<string> {
    if (this.config.token) {
      const expiresAt = jwtExpiry(this.config.token);
      if (expiresAt !== null && expiresAt <= this.now() + 5000) throw providerError(401);
      return this.config.token;
    }
    if (this.cachedToken && this.cachedToken.expiresAt > this.now() + 60_000) return this.cachedToken.token;
    if (this.tokenPending) return this.tokenPending;
    this.tokenPending = (async () => {
      const { baseUrl, user, accessCode, postingCard, contract, regional } = this.config;
      const response = await this.request(`${baseUrl}/token/v1/autentica/cartaopostagem`, {
        numero: postingCard, ...(contract ? { contrato: contract } : {}), ...(regional ? { dr: regional } : {}),
      }, `Basic ${Buffer.from(`${user}:${accessCode}`).toString('base64')}`);
      if (response.status !== 200 && response.status !== 201) throw providerError(response.status, true);
      const data = response.data;
      if (!isRecord(data) || typeof data.token !== 'string' || data.token.length > 16_384
        || !/^[A-Za-z0-9._~+\/-]+=*$/.test(data.token)) throw providerError(502);
      const expiresAt = responseExpiry(data, data.token);
      if (expiresAt === null || expiresAt <= this.now() + 60_000) throw providerError(502);
      this.cachedToken = { token: data.token, expiresAt };
      return data.token;
    })();
    try { return await this.tokenPending; } finally { this.tokenPending = null; }
  }

  private async authorized(path: string, body: unknown, token: string, signal: AbortSignal) {
    return this.request(`${this.config.baseUrl}${path}`, body, `Bearer ${token}`, signal);
  }

  async quote(destinationCep: string, parcels: ShippingParcel[]): Promise<ShippingOption[]> {
    if (!/^\d{8}$/.test(destinationCep) || parcels.length < 1 || parcels.length > 20 || !parcels.every(validShippingParcel)) {
      throw new CorreiosError(422, 'SHIPPING_INVALID_PACKAGE', 'Revise o CEP e os volumes do pedido.');
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        this.performQuote(destinationCep, parcels, controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new CorreiosError(504, 'CORREIOS_TIMEOUT', 'Os Correios demoraram para responder. Tente calcular o frete novamente.'));
          }, 22_000);
        }),
      ]);
    } finally { clearTimeout(timer!); controller.abort(); }
  }

  async track(code: string): Promise<CorreiosTrackingEvent> {
    if (!validTrackingCode(code)) throw new CorreiosError(422, 'CORREIOS_TRACKING_INVALID', 'Código de rastreio inválido.');
    const signal = AbortSignal.timeout(20_000);
    let token = await this.getToken();
    const consult = () => this.trackingRequest(`${this.config.baseUrl}/srorastro/v1/objetos/${code}?resultado=T`, `Bearer ${token}`, signal);
    let response = await consult();
    if (response.status === 401 && !this.config.token) {
      if (this.cachedToken?.token === token) this.cachedToken = null;
      token = await this.getToken(); response = await consult();
    }
    if (response.status !== 200) throw new CorreiosError(response.status === 404 ? 404 : 503, 'CORREIOS_TRACKING_ACCESS', 'Confira o código e a liberação da API Rastro no contrato dos Correios.');
    return parseCorreiosTracking(response.data, code, this.now());
  }

  private async performQuote(destinationCep: string, parcels: ShippingParcel[], signal: AbortSignal): Promise<ShippingOption[]> {
    const { services, originCep } = this.config;
    const parameters = services.flatMap(service => parcels.map((parcel, i) => ({
      coProduto: service.code, nuRequisicao: `${service.code}-${i}`,
      cepOrigem: originCep, cepDestino: destinationCep, psObjeto: String(parcel.weightGrams),
      tpObjeto: '2', comprimento: String(parcel.lengthCm), largura: String(parcel.widthCm), altura: String(parcel.heightCm),
    })));
    const priceBody = { idLote: 'store-price', parametrosProduto: parameters };
    const deadlineBody = { idLote: 'store-deadline', parametrosPrazo: services.map(service => ({
      coProduto: service.code, nuRequisicao: service.code, cepOrigem: originCep, cepDestino: destinationCep,
    })) };
    let token = await this.getToken();
    const consult = () => Promise.all([
      this.authorized('/preco/v1/nacional', priceBody, token, signal),
      this.authorized('/prazo/v1/nacional', deadlineBody, token, signal),
    ]);
    let responses = await consult();
    if (responses.some(response => response.status === 401) && !this.config.token) {
      // Uma renovação por operação; uma rejeição antiga não invalida o token de outra chamada.
      if (this.cachedToken?.token === token) this.cachedToken = null;
      token = await this.getToken();
      responses = await consult();
    }
    for (const response of responses) {
      if (![200, 206].includes(response.status)) throw providerError(response.status);
      if (!Array.isArray(response.data) || response.data.length > 100) throw providerError(502);
    }
    const prices = responses[0].data as unknown[];
    const deadlines = responses[1].data as unknown[];
    const options: ShippingOption[] = [];
    for (const service of services) {
      let total = 0;
      let complete = true;
      for (let i = 0; i < parcels.length; i += 1) {
        const matches = prices.filter(row => isRecord(row) && row.coProduto === service.code
          && row.nuRequisicao === `${service.code}-${i}`);
        const row = matches[0];
        const cents = isRecord(row) ? correiosMoneyToCents(row.pcFinal) : null;
        if (matches.length !== 1 || !isRecord(row) || row.txErro || cents === null) { complete = false; break; }
        total += cents;
      }
      const matches = deadlines.filter(row => isRecord(row) && row.coProduto === service.code && row.nuRequisicao === service.code);
      const deadline = matches[0];
      if (!complete || total > 100_000_000 || matches.length !== 1 || !isRecord(deadline) || deadline.txErro
        || !Number.isInteger(deadline.prazoEntrega) || Number(deadline.prazoEntrega) < 0 || Number(deadline.prazoEntrega) > 365
        || !['S', 'N'].includes(String(deadline.entregaDomiciliar)) || !['S', 'N'].includes(String(deadline.entregaSabado))) continue;
      options.push({ service_code: service.code, service_name: service.name, amount_cents: total,
        delivery_days: Number(deadline.prazoEntrega), home_delivery: deadline.entregaDomiciliar === 'S', saturday_delivery: deadline.entregaSabado === 'S' });
    }
    if (!options.length) throw new CorreiosError(422, 'SHIPPING_UNAVAILABLE', 'Nenhum serviço dos Correios está disponível para todos os volumes deste pedido.');
    return options.sort((a, b) => a.amount_cents - b.amount_cents || a.delivery_days - b.delivery_days);
  }
}

let clientCache: { key: string; client: CorreiosClient } | undefined;
export function getCorreiosClient(): CorreiosClient {
  const config = correiosConfig();
  const key = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  if (clientCache?.key !== key) clientCache = { key, client: new CorreiosClient(config) };
  return clientCache.client;
}
