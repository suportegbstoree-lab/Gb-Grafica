import type { FulfillmentStatus } from '../lib/orderStatus';
import { apiErrorMessage, type ApiErrorPayload } from '../lib/apiError';
import { auth } from '../firebase';

export async function updateOrderFulfillment(
  orderId: string,
  fulfillmentStatus: FulfillmentStatus,
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sua sessão expirou. Faça login novamente.');
  const token = await user.getIdToken();
  const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/fulfillment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ fulfillmentStatus }),
  });
  const data = await response.json().catch(() => ({})) as ApiErrorPayload;
  if (!response.ok) {
    throw new Error(apiErrorMessage(data, 'Não foi possível atualizar o pedido.'));
  }
}
