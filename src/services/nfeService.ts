import { auth } from '../firebase';
import { apiErrorMessage } from '../lib/apiError';
import type { NfeAddress, NfeDefaults, NfeDefaultsConfig, NfeDraft, NfeReview } from '../lib/nfe';
import { apiFetch } from './apiClient';

async function fiscalRequest<T>(path: string, change?: object, signal?: AbortSignal): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sua sessão expirou. Entre novamente.');
  const response = await apiFetch(path, {
    method: change ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(change ? { 'Content-Type': 'application/json' } : {}) },
    body: change ? JSON.stringify(change) : undefined,
    signal,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(result, 'Não foi possível acessar os dados fiscais.'));
  return result;
}

export function requestNfeDraft(orderId: string, change?: { draft: NfeDraft; revision: string | null; confirm?: boolean }, signal?: AbortSignal) {
  return fiscalRequest<NfeReview>(`/api/admin/orders/${encodeURIComponent(orderId)}/nfe-draft`, change, signal);
}

export function requestNfeDefaults(change?: { defaults: NfeDefaults; revision: string | null }, signal?: AbortSignal) {
  return fiscalRequest<NfeDefaultsConfig>('/api/admin/nfe-defaults', change, signal);
}

export function requestNfeAddress(cep: string) {
  return fiscalRequest<Omit<NfeAddress, 'numero' | 'complemento'>>('/api/admin/nfe-postal-address', { cep });
}
