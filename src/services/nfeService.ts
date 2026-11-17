import { auth } from '../firebase';
import { apiErrorMessage } from '../lib/apiError';
import type { NfeDraft, NfeReview } from '../lib/nfe';
import { apiFetch } from './apiClient';

export async function requestNfeDraft(
  orderId: string,
  change?: { draft: NfeDraft; revision: string | null },
  signal?: AbortSignal,
): Promise<NfeReview> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sua sessão expirou. Entre novamente.');
  const response = await apiFetch(`/api/admin/orders/${encodeURIComponent(orderId)}/nfe-draft`, {
    method: change ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(change ? { 'Content-Type': 'application/json' } : {}) },
    body: change ? JSON.stringify(change) : undefined,
    signal,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(result, 'Não foi possível consultar ou salvar o rascunho de NF-e.'));
  return result;
}
