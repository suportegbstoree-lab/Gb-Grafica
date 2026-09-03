export interface HostedCheckoutResult {
  initPoint: string;
  orderId?: string;
  checkoutId?: string;
}

interface CheckoutApiResponse {
  error?: unknown;
  init_point?: unknown;
  order_id?: unknown;
  checkout_id?: unknown;
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
    throw new Error(typeof data.error === 'string' ? data.error : 'Não foi possível iniciar o pagamento.');
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
