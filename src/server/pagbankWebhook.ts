import type { PaymentStatus } from '../lib/orderStatus.js';

type PlainRecord = Record<string, unknown>;

export interface PagBankWebhookEvent {
  referenceId: string;
  providerId: string;
  chargeId: string;
  providerStatus: string;
  paymentStatus: PaymentStatus | null;
  amountCents: number | null;
  currency: string | null;
  kind: 'checkout' | 'payment';
}

export interface StoredPaymentOrder {
  totalCents?: unknown;
  total?: unknown;
  paymentStatus?: unknown;
  pagbankCheckoutId?: unknown;
  pagbankOrderId?: unknown;
  pagbankChargeId?: unknown;
}

export function parsePagBankWebhookEvent(payload: unknown): PagBankWebhookEvent | null {
  if (!isPlainRecord(payload)) return null;

  const charge = Array.isArray(payload.charges) && isPlainRecord(payload.charges[0])
    ? payload.charges[0]
    : null;
  const providerId = cleanText(payload.id, 100);
  const referenceId = cleanText(payload.reference_id, 64);
  if (!providerId || !referenceId) return null;

  const kind = charge ? 'payment' : 'checkout';
  const providerStatus = cleanText(charge?.status || payload.status, 50).toUpperCase();
  if (!providerStatus) return null;

  const amount = charge && isPlainRecord(charge.amount) ? charge.amount : null;
  const rawAmount = amount?.value;

  return {
    referenceId,
    providerId,
    chargeId: cleanText(charge?.id, 100),
    providerStatus,
    paymentStatus: mapPagBankPaymentStatus(providerStatus),
    amountCents: Number.isSafeInteger(rawAmount) && Number(rawAmount) >= 0 ? Number(rawAmount) : null,
    currency: cleanText(amount?.currency, 3).toUpperCase() || null,
    kind,
  };
}

export function mapPagBankPaymentStatus(status: unknown): PaymentStatus | null {
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
    case 'WAITING':
      return 'pendente';
    default:
      return null;
  }
}

export function validatePagBankWebhookEvent(
  event: PagBankWebhookEvent,
  order: StoredPaymentOrder,
): string | null {
  const expectedTotal = storedTotalCents(order);
  if (event.kind === 'payment' && event.paymentStatus === 'pago') {
    if (event.amountCents === null) return 'Pagamento confirmado sem valor informado.';
    if (expectedTotal === null || event.amountCents !== expectedTotal) return 'Valor pago diverge do pedido.';
    if (event.currency !== 'BRL') return 'Moeda do pagamento diverge do pedido.';
  } else if (event.kind === 'payment' && event.amountCents !== null && expectedTotal !== null) {
    if (event.amountCents !== expectedTotal) return 'Valor da cobrança diverge do pedido.';
    if (event.currency && event.currency !== 'BRL') return 'Moeda da cobrança diverge do pedido.';
  }

  if (
    event.providerId.startsWith('CHEC_') &&
    typeof order.pagbankCheckoutId === 'string' &&
    order.pagbankCheckoutId &&
    order.pagbankCheckoutId !== event.providerId
  ) {
    return 'Checkout informado não pertence ao pedido.';
  }

  if (
    event.providerId.startsWith('ORDE_') &&
    typeof order.pagbankOrderId === 'string' &&
    order.pagbankOrderId &&
    order.pagbankOrderId !== event.providerId
  ) {
    return 'Pedido PagBank informado não corresponde ao registro.';
  }

  return null;
}

export function shouldApplyPaymentStatus(current: unknown, incoming: PaymentStatus | null): boolean {
  if (!incoming) return false;
  if (current === 'pago') return incoming === 'pago';
  if (incoming === 'pago') return true;

  const terminal = new Set(['recusado', 'cancelado', 'expirado']);
  if (terminal.has(String(current)) && !terminal.has(incoming)) return false;
  return true;
}

function storedTotalCents(order: StoredPaymentOrder): number | null {
  if (Number.isSafeInteger(order.totalCents) && Number(order.totalCents) >= 0) return Number(order.totalCents);
  if (typeof order.total !== 'string' && typeof order.total !== 'number') return null;
  const numeric = Number(String(order.total).replace(',', '.'));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 100);
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}
