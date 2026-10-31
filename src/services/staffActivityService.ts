import { auth } from '../firebase';
import { apiFetch } from './apiClient';
import { apiErrorMessage } from '../lib/apiError';
export interface AdminActivityApi {
  orders(orderId?: string): Promise<void>;
  exportArtwork(orderId: string, itemId: string, format: 'jpg' | 'pdf'): Promise<void>;
}
async function record(path: string, body: unknown) {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre novamente para continuar.');
  const response = await apiFetch(`/api/admin/activity/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(data, 'Não foi possível registrar a atividade.'));
}
export const ADMIN_ACTIVITY_API: AdminActivityApi = { orders: orderId => record('orders', { orderId }), exportArtwork: (orderId, itemId, format) => record('artwork', { orderId, itemId, format }) };
