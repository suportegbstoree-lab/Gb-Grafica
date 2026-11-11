import { apiErrorMessage, type ApiErrorPayload } from '../lib/apiError';
import { isRecord, type ShippingQuoteResponse } from '../lib/shipping';
import { apiFetch } from './apiClient';

export async function requestShippingQuote(
  cep: string,
  items: Array<{ productId: string; quantidade: number; selecoes: Record<string, string>; bundleItems?: Array<{ productId: string; quantidade: number; selecoes: Record<string,string> }> }>,
  signal?: AbortSignal,
  fetchImplementation: typeof fetch = apiFetch,
): Promise<ShippingQuoteResponse> {
  const response = await fetchImplementation('/api/shipping-quote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ cep, items: items.map(({ productId, quantidade, selecoes, bundleItems }) => ({ productId, quantidade, selecoes, ...(bundleItems?{bundleItems:bundleItems.map(({productId,quantidade,selecoes})=>({productId,quantidade,selecoes}))}:{}) })) }),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(apiErrorMessage((data || {}) as ApiErrorPayload, 'Não foi possível calcular o frete.'));
  if (!isRecord(data) || data.cep !== cep
    || !['address', 'state', 'street', 'neighborhood', 'city'].every(field => typeof data[field] === 'string')
    || !Number.isSafeInteger(data.parcel_count) || Number(data.parcel_count) < 1 || Number(data.parcel_count) > 20
    || typeof data.quoted_at !== 'string' || !Number.isFinite(Date.parse(data.quoted_at))
    || typeof data.expires_at !== 'string' || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()
    || !Array.isArray(data.options) || !data.options.length || data.options.length > 100
    || data.options.some(option => !isRecord(option) || typeof option.service_code !== 'string'
      || !Number.isSafeInteger(option.amount_cents) || Number(option.amount_cents) <= 0
      || !Number.isInteger(option.delivery_days) || Number(option.delivery_days) < 0 || Number(option.delivery_days) > 365
      || (option.provider === 'melhor_envio'
        ? !/^me:[1-9]\d{0,8}$/.test(option.service_code) || !validName(option.carrier_name) || !validName(option.service_name)
        : (option.provider !== undefined && option.provider !== 'correios') || !/^\d{5}$/.test(option.service_code)
          || !['PAC', 'SEDEX'].includes(String(option.service_name))
          || typeof option.home_delivery !== 'boolean' || typeof option.saturday_delivery !== 'boolean'))
    || new Set(data.options.map(option => option.service_code)).size !== data.options.length) {
    throw new Error('A cotação de frete retornou dados inválidos. Tente novamente.');
  }
  return data as unknown as ShippingQuoteResponse;
}

function validName(value: unknown): boolean {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= 100 && !/[\x00-\x1f\x7f]/.test(value);
}
