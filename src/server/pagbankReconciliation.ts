import type { PagBankWebhookEvent } from './pagbankWebhook.js';
import { parsePagBankWebhookEvent } from './pagbankWebhook.js';

type PlainRecord = Record<string, unknown>;

const CHECKOUT_ID_PATTERN = /^CHEC_[A-Z0-9-]{8,100}$/i;
const ORDER_ID_PATTERN = /^ORDE_[A-Z0-9-]{8,100}$/i;
const MAX_ASSOCIATED_ORDERS = 20;

export interface PagBankLookupResponse {
  status: number;
  data: unknown;
}

export type PagBankLookupRequest = (
  url: string,
  token: string,
) => Promise<PagBankLookupResponse>;

export interface PagBankReconciliationResult {
  checkoutStatus: string;
  providerOrderIds: string[];
  event: PagBankWebhookEvent | null;
}

export async function reconcilePagBankCheckout(
  input: {
    baseUrl: string;
    token: string;
    checkoutId: string;
    referenceId: string;
  },
  request: PagBankLookupRequest = requestPagBankResource,
): Promise<PagBankReconciliationResult> {
  if (!CHECKOUT_ID_PATTERN.test(input.checkoutId)) {
    throw new Error('Checkout PagBank inválido para reconciliação.');
  }
  if (!/^GB-[A-Z0-9]{8,64}$/.test(input.referenceId)) {
    throw new Error('Pedido interno inválido para reconciliação.');
  }

  const checkoutUrl = `${input.baseUrl}/checkouts/${encodeURIComponent(input.checkoutId)}?limit=100`;
  const checkoutResponse = await request(checkoutUrl, input.token);
  const checkout = parseCheckoutResponse(
    checkoutResponse.data,
    input.checkoutId,
    input.referenceId,
  );

  const orderResponses = await Promise.all(checkout.providerOrderIds.map(async providerOrderId => {
    const orderUrl = `${input.baseUrl}/orders/${encodeURIComponent(providerOrderId)}`;
    const response = await request(orderUrl, input.token);
    return parseOrderEvents(response.data, providerOrderId, input.referenceId);
  }));
  const events = orderResponses.flat();

  return {
    checkoutStatus: checkout.checkoutStatus,
    providerOrderIds: checkout.providerOrderIds,
    event: selectReconciliationEvent(events) || checkout.checkoutEvent,
  };
}

export function parseCheckoutResponse(
  payload: unknown,
  expectedCheckoutId: string,
  expectedReferenceId: string,
): {
  checkoutStatus: string;
  providerOrderIds: string[];
  checkoutEvent: PagBankWebhookEvent | null;
} {
  if (!isPlainRecord(payload)) throw new Error('Resposta de consulta do checkout inválida.');

  const checkoutId = cleanText(payload.id, 110);
  const referenceId = cleanText(payload.reference_id, 70);
  if (checkoutId !== expectedCheckoutId) {
    throw new Error('A consulta retornou um checkout diferente do pedido.');
  }
  if (referenceId !== expectedReferenceId) {
    throw new Error('A consulta retornou uma referência diferente do pedido.');
  }

  const checkoutStatus = cleanText(payload.status, 50).toUpperCase();
  const rawOrders = Array.isArray(payload.orders) ? payload.orders : [];
  if (rawOrders.length > MAX_ASSOCIATED_ORDERS) {
    throw new Error('O checkout possui pedidos associados acima do limite seguro.');
  }

  const providerOrderIds = [...new Set(rawOrders.flatMap(order => {
    if (!isPlainRecord(order)) return [];
    const providerOrderId = cleanText(order.id, 110);
    return ORDER_ID_PATTERN.test(providerOrderId) ? [providerOrderId] : [];
  }))];

  const checkoutEvent = parsePagBankWebhookEvent({
    id: checkoutId,
    reference_id: referenceId,
    status: checkoutStatus,
  });

  return { checkoutStatus, providerOrderIds, checkoutEvent };
}

export function parseOrderEvents(
  payload: unknown,
  expectedProviderOrderId: string,
  referenceId: string,
): PagBankWebhookEvent[] {
  if (!isPlainRecord(payload)) throw new Error('Resposta de consulta do pedido PagBank inválida.');
  const providerOrderId = cleanText(payload.id, 110);
  if (providerOrderId !== expectedProviderOrderId || !ORDER_ID_PATTERN.test(providerOrderId)) {
    throw new Error('A consulta retornou um pedido PagBank diferente do checkout.');
  }

  const charges = Array.isArray(payload.charges) ? payload.charges.slice(0, 25) : [];
  return charges.flatMap(charge => {
    if (!isPlainRecord(charge)) return [];
    const event = parsePagBankWebhookEvent({
      id: providerOrderId,
      reference_id: referenceId,
      charges: [charge],
    });
    return event ? [event] : [];
  });
}

export function selectReconciliationEvent(
  events: PagBankWebhookEvent[],
): PagBankWebhookEvent | null {
  const priority: Record<string, number> = {
    pago: 6,
    em_analise: 5,
    pendente: 4,
    recusado: 3,
    cancelado: 2,
    expirado: 1,
  };
  return [...events].sort((first, second) => (
    (priority[second.paymentStatus || ''] || 0) -
    (priority[first.paymentStatus || ''] || 0)
  ))[0] || null;
}

async function requestPagBankResource(url: string, token: string): Promise<PagBankLookupResponse> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const responseText = await response.text();
  if (Buffer.byteLength(responseText, 'utf8') > 1024 * 1024) {
    throw new Error('Resposta da consulta PagBank excedeu o limite seguro.');
  }

  let data: unknown = {};
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error('Consulta PagBank retornou uma resposta inválida.');
    }
  }
  if (!response.ok) {
    throw new Error(`Consulta PagBank falhou com HTTP ${response.status}.`);
  }
  return { status: response.status, data };
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}
