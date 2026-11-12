import axios from 'axios';
import { isRecord, validShippingParcel, type MelhorEnvioShippingOption, type ShippingParcel } from '../lib/shipping.js';
import { ShippingError } from './shippingError.js';

export const melhorEnvioHosts = {
  sandbox: 'https://sandbox.melhorenvio.com.br',
  production: 'https://melhorenvio.com.br',
} as const;
const serviceId = /^[1-9]\d{0,8}$/;
type Environment = keyof typeof melhorEnvioHosts;

export function melhorEnvioConfig(env: NodeJS.ProcessEnv = process.env) {
  const environment = env.MELHOR_ENVIO_ENV?.trim();
  const token = env.MELHOR_ENVIO_TOKEN?.trim().replace(/^Bearer\s+/i, '');
  const originCep = env.MELHOR_ENVIO_ORIGIN_CEP?.trim().replace('-', '');
  const contactEmail = env.MELHOR_ENVIO_CONTACT_EMAIL?.trim();
  const services = env.MELHOR_ENVIO_SERVICES?.trim().split(',').map(id => id.trim()).filter(Boolean) || [];
  if (
    (environment !== 'sandbox' && environment !== 'production') ||
    !token || token.length > 16_384 || !/^[A-Za-z0-9._~+/=-]+$/.test(token) ||
    !originCep || !/^\d{8}$/.test(originCep) ||
    !contactEmail || contactEmail.length > 254 || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(contactEmail) ||
    services.some(id => !serviceId.test(id))
  ) throw new ShippingError(503, 'MELHOR_ENVIO_CONFIGURATION', 'O frete pelo Melhor Envio ainda precisa ser configurado pela loja.');

  return { environment: environment as Environment, originCep, token, contactEmail, services: [...new Set(services)] };
}

export type MelhorEnvioConfig = ReturnType<typeof melhorEnvioConfig>;

export function melhorEnvioMoneyToCents(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = /^(\d{1,8})(?:\.(\d{1,2})0*)?$/.exec(String(value).trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return cents > 0 && cents <= 100_000_000 ? cents : null;
}

function displayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= 100 && !/[\x00-\x1f\x7f]/.test(name) ? name : null;
}

export async function quoteMelhorEnvio(
  config: MelhorEnvioConfig,
  destinationCep: string,
  parcels: readonly ShippingParcel[],
): Promise<MelhorEnvioShippingOption[]> {
  if (!/^\d{8}$/.test(destinationCep) || !parcels.length || parcels.length > 20 || !parcels.every(validShippingParcel)) {
    throw new ShippingError(422, 'SHIPPING_INVALID_PACKAGE', 'Revise o CEP e os volumes do pedido.');
  }
  const unavailable = () => new ShippingError(502, 'MELHOR_ENVIO_UNAVAILABLE', 'Não foi possível consultar o Melhor Envio agora. Tente novamente.');
  const noService = () => new ShippingError(422, 'SHIPPING_UNAVAILABLE', 'O Melhor Envio não encontrou um serviço para os volumes deste pedido.');
  const body = {
    from: { postal_code: config.originCep },
    to: { postal_code: destinationCep },
    volumes: parcels.map(parcel => ({
      length: parcel.lengthCm, width: parcel.widthCm, height: parcel.heightCm, weight: parcel.weightGrams / 1000,
    })),
    ...(config.services.length ? { services: config.services.join(',') } : {}),
  };
  let response: { status: number; data: unknown };
  try {
    response = await axios.post(`${melhorEnvioHosts[config.environment]}/api/v2/me/shipment/calculate`, body, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        'User-Agent': `GB Grafica (${config.contactEmail})`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 6000,
      maxRedirects: 0,
      maxContentLength: 512 * 1024,
      responseType: 'json',
      validateStatus: () => true,
    });
  } catch {
    throw unavailable();
  }
  if (response.status === 401 || response.status === 403)
    throw new ShippingError(503, 'MELHOR_ENVIO_ACCESS_DENIED', 'A loja precisa verificar o token e a permissão de cotação do Melhor Envio.');
  if (response.status === 422) throw noService();
  if (response.status !== 200 || !Array.isArray(response.data) || response.data.length > 100) throw unavailable();

  const options = new Map<string, MelhorEnvioShippingOption>();
  for (const row of response.data) {
    if (!isRecord(row) || row.error || !isRecord(row.company)) continue;
    if (typeof row.id !== 'number' && typeof row.id !== 'string') continue;
    const id = String(row.id);
    if (!serviceId.test(id) || (config.services.length && !config.services.includes(id))) continue;
    const carrier = displayName(row.company.name);
    const name = displayName(row.name);
    const amount = melhorEnvioMoneyToCents(row.custom_price ?? row.price);
    const days = row.custom_delivery_time ?? row.delivery_time;
    if (!carrier || !name || amount === null || typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 365) continue;
    const code = `me:${id}`;
    if (options.has(code)) throw unavailable();
    options.set(code, { provider: 'melhor_envio', carrier_name: carrier, service_code: code, service_name: name, amount_cents: amount, delivery_days: days });
  }
  if (!options.size) throw noService();
  return [...options.values()].sort((a, b) => a.amount_cents - b.amount_cents || a.delivery_days - b.delivery_days || a.service_code.localeCompare(b.service_code));
}
