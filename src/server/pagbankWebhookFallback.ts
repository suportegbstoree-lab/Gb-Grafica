import {
  parsePagBankWebhookEvent,
  type PagBankWebhookEvent,
} from './pagbankWebhook.js';

type PlainRecord = Record<string, unknown>;

const REFERENCE_ID_PATTERN = /^GB-[A-Z0-9]{8,64}$/;
const PROVIDER_ID_PATTERN = /^(?:CHEC|ORDE|CHAR)_[A-Z0-9-]{8,100}$/i;

export interface ParsedPagBankNotification {
  payload: PlainRecord;
  event: PagBankWebhookEvent;
}

export function parsePagBankNotificationForProviderLookup(
  rawBody: string,
): ParsedPagBankNotification | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!isPlainRecord(payload)) return null;

  const event = parsePagBankWebhookEvent(payload);
  if (!event) return null;
  if (!REFERENCE_ID_PATTERN.test(event.referenceId)) return null;
  if (!PROVIDER_ID_PATTERN.test(event.providerId)) return null;

  return { payload, event };
}

export function pagBankNotificationMatchesProviderEvent(
  received: PagBankWebhookEvent,
  provider: PagBankWebhookEvent,
): boolean {
  if (received.referenceId !== provider.referenceId) return false;
  if (received.providerId !== provider.providerId) return false;
  if (received.providerStatus !== provider.providerStatus) return false;
  if (received.kind !== provider.kind) return false;
  if (received.chargeId && received.chargeId !== provider.chargeId) return false;
  if (received.amountCents !== null && received.amountCents !== provider.amountCents) return false;
  if (received.currency && received.currency !== provider.currency) return false;
  if (received.paymentMethod && received.paymentMethod !== provider.paymentMethod) return false;
  return true;
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
