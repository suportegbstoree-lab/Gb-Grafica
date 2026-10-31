import type { FulfillmentStatus } from '../lib/orderStatus';
import { apiErrorMessage, type ApiErrorPayload } from '../lib/apiError';
import { auth } from '../firebase';
import { apiFetch } from './apiClient';

async function orderOperation(orderId: string, action: string, body: unknown): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sua sessão expirou. Faça login novamente.');
  const response = await apiFetch(`/api/admin/orders/${encodeURIComponent(orderId)}/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as ApiErrorPayload;
    throw new Error(apiErrorMessage(data, 'Não foi possível atualizar o pedido.'));
  }
  return response;
}
export async function updateOrderFulfillment(orderId: string, fulfillmentStatus: FulfillmentStatus, trackingCode?: string): Promise<void> {
  await orderOperation(orderId, 'fulfillment', { fulfillmentStatus, ...(trackingCode ? { trackingCode } : {}) });
}
export async function requestProductionLabel(orderId: string, requestId: string): Promise<Blob> {
  const response = await orderOperation(orderId, 'production-label', { requestId });
  if (!response.headers.get('content-type')?.startsWith('application/pdf')) throw new Error('A etiqueta não retornou um PDF válido.');
  return response.blob();
}
export async function refreshOrderTracking(orderId: string): Promise<void> { await orderOperation(orderId, 'tracking/refresh', {}); }
export interface OrderOperationsApi {
  updateFulfillment: typeof updateOrderFulfillment;
  productionLabel: typeof requestProductionLabel;
  refreshTracking: typeof refreshOrderTracking;
}
export const ORDER_OPERATIONS_API: OrderOperationsApi = { updateFulfillment: updateOrderFulfillment, productionLabel: requestProductionLabel, refreshTracking: refreshOrderTracking };
