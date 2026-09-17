import { apiErrorMessage, type ApiErrorPayload } from '../lib/apiError';
import type { PaymentStatus } from '../lib/orderStatus';

export interface HostedCheckoutResult {
  initPoint: string;
  orderId?: string;
  checkoutId?: string;
}

interface CheckoutApiResponse extends ApiErrorPayload {
  init_point?: unknown;
  order_id?: unknown;
  checkout_id?: unknown;
}

interface PaymentStatusApiResponse extends ApiErrorPayload {
  order_id?: unknown;
  status?: unknown;
  pagbank_status?: unknown;
  reconciled?: unknown;
}

export interface HostedPaymentStatusResult {
  orderId: string;
  status: PaymentStatus;
  pagbankStatus: string | null;
  reconciled: boolean;
}

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function isTrustedPagBankPaymentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && [
      'pagamento.sandbox.pagbank.com.br',
      'pagamento.pagseguro.uol.com.br',
      'pagamento.pagbank.com.br',
    ].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function createHostedCheckout(
  payload: unknown,
  idToken: string,
  fetchImplementation: FetchImplementation = fetch,
): Promise<HostedCheckoutResult> {
  const response = await fetchImplementation('/api/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({})) as CheckoutApiResponse;
  if (!response.ok) {
    throw new Error(apiErrorMessage(data, 'Não foi possível iniciar o pagamento.'));
  }

  if (typeof data.init_point !== 'string' || !isTrustedPagBankPaymentUrl(data.init_point)) {
    throw new Error('O PagBank não retornou o link de pagamento.');
  }

  return {
    initPoint: data.init_point,
    ...(typeof data.order_id === 'string' ? { orderId: data.order_id } : {}),
    ...(typeof data.checkout_id === 'string' ? { checkoutId: data.checkout_id } : {}),
  };
}

export async function refreshHostedPaymentStatus(
  orderId: string,
  idToken: string,
  fetchImplementation: FetchImplementation = fetch,
): Promise<HostedPaymentStatusResult> {
  if (!/^GB-[A-Z0-9]{8,64}$/.test(orderId)) throw new Error('Pedido de pagamento inválido.');
  const response = await fetchImplementation(`/api/payment-status/${encodeURIComponent(orderId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await response.json().catch(() => ({})) as PaymentStatusApiResponse;
  if (!response.ok) {
    throw new Error(apiErrorMessage(data, 'Não foi possível confirmar o pagamento agora.'));
  }

  const allowedStatuses = new Set<PaymentStatus>([
    'pago',
    'pendente',
    'em_analise',
    'recusado',
    'cancelado',
    'expirado',
    'erro',
  ]);
  if (typeof data.status !== 'string' || !allowedStatuses.has(data.status as PaymentStatus)) {
    throw new Error('O servidor retornou um estado de pagamento inválido.');
  }

  return {
    orderId: typeof data.order_id === 'string' ? data.order_id : orderId,
    status: data.status as PaymentStatus,
    pagbankStatus: typeof data.pagbank_status === 'string' ? data.pagbank_status : null,
    reconciled: data.reconciled === true,
  };
}
