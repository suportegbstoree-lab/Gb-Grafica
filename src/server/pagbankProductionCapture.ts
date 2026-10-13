const MAX_WINDOW_MS = 2 * 60 * 60 * 1_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const REDACTED = '[REDACTED]';

// Sem conta e janela explícitas, produção não coleta evidências.
export function productionCaptureUserId(
  environment: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): string | null {
  if (environment.PAGBANK_ENV?.trim().toLowerCase() !== 'production') return null;
  const userId = environment.PAGBANK_PRODUCTION_CAPTURE_USER_ID?.trim();
  const start = environment.PAGBANK_PRODUCTION_CAPTURE_START_AT?.trim() || '';
  const end = environment.PAGBANK_PRODUCTION_CAPTURE_END_AT?.trim() || '';
  if (!userId || userId.length > 128 || /[\s\x00-\x1f\x7f]/.test(userId)) return null;
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(now) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs <= startMs || endMs - startMs > MAX_WINDOW_MS) return null;
  return now >= startMs && now < endMs ? userId : null;
}

const CONTAINERS = new Set([
  'items', 'shipping', 'payment_methods', 'payment_methods_configs', 'config_options',
  'charges', 'amount', 'summary', 'payment_method', 'payment_response', 'error_messages',
]);
const NUMBERS = new Set([
  'quantity', 'unit_amount', 'additional_amount', 'discount_amount', 'amount', 'value',
  'total', 'paid', 'refunded', 'installments', 'redirect_waiting_time',
]);
const BOOLEANS = new Set(['customer_modifiable', 'address_modifiable', 'received', 'duplicate', 'applied', 'capture', 'store']);
const ENUMS: Record<string, RegExp> = {
  status: /^(ACTIVE|INACTIVE|EXPIRED|WAITING|IN_ANALYSIS|DECLINED|AUTHORIZED|PAID|CANCELED|REFUNDED)$/,
  type: /^(CREDIT_CARD|DEBIT_CARD|BOLETO|PIX|FIXED|FREE|CALCULATE)$/,
  service_type: /^(PAC|SEDEX)$/,
  currency: /^BRL$/,
  option: /^(INSTALLMENTS_LIMIT|INTEREST_FREE_INSTALLMENTS)$/,
  verified_by: /^provider_lookup$/,
};
const CALLBACKS = new Set(['redirect_url', 'return_url', 'notification_urls', 'payment_notification_urls']);

function safeCallback(value: string): string {
  try {
    const base = new URL(process.env.APP_URL || '');
    const url = new URL(value);
    const basePath = base.pathname.replace(/\/+$/, '');
    if (url.protocol !== 'https:' || url.origin !== base.origin || url.username || url.password || url.hash) return REDACTED;
    if (![basePath || '/', `${basePath}/api/webhook/pagbank`].includes(url.pathname)) return REDACTED;
    for (const [key, item] of url.searchParams) {
      if (key === 'pagbank' && item === 'return') continue;
      if (key === 'orderId' && /^GB-[A-Z0-9]{8,64}$/.test(item)) continue;
      return REDACTED;
    }
    return value;
  } catch {
    return REDACTED;
  }
}

// Lista permitida: campos novos/desconhecidos ficam mascarados, inclusive textos
// livres, cliente, cartão, Pix copia-e-cola e links de pagamento.
export function sanitizeProductionEvidence(
  value: unknown,
  key = '',
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value === null) return null;
  if (depth >= 10) return '[MAX_DEPTH]';
  if (typeof value === 'number') return NUMBERS.has(key) && Number.isSafeInteger(value) && value >= 0 ? value : REDACTED;
  if (typeof value === 'boolean') return BOOLEANS.has(key) ? value : REDACTED;
  if (typeof value === 'string') {
    if (value === REDACTED || value === '[MAX_DEPTH]' || value === '[CIRCULAR]') return value;
    if (['id', 'reference_id', 'checkout_id'].includes(key) && /^(?:GB-[A-Z0-9]{8,64}|(?:CHEC|ORDE|CHAR)_[A-Za-z0-9-]{8,128})$/.test(value)) return value;
    if (Object.hasOwn(ENUMS, key) && ENUMS[key].test(value)) return value;
    if (['created_at', 'paid_at', 'canceled_at', 'expiration_date'].includes(key) && ISO_DATE.test(value) && Number.isFinite(Date.parse(value))) return value;
    if (key === 'value' && /^\d{1,2}$/.test(value)) return value;
    if (key === 'code' && /^[A-Z0-9_-]{1,40}$/.test(value)) return value;
    if (key === 'parameter_name' && /^[a-z_][a-z0-9_.\[\]-]{0,99}$/i.test(value)) return value;
    if (CALLBACKS.has(key)) return safeCallback(value);
    return REDACTED;
  }
  if (typeof value !== 'object') return REDACTED;
  if (key && !CONTAINERS.has(key) && !CALLBACKS.has(key)) return REDACTED;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 100).map(item => sanitizeProductionEvidence(item, key, depth + 1, seen));
  }
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([field, item]) => [
    field,
    sanitizeProductionEvidence(item, field, depth + 1, seen),
  ]));
}
