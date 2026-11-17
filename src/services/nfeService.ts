import { auth } from '../firebase';
import { apiErrorMessage } from '../lib/apiError';
import type { NfeAddress, NfeDefaultsConfig, NfeDraft, NfeOrderSummary, NfeReview } from '../lib/nfe';
import type { NfeSimulationRequest, NfeSimulationView } from '../lib/nfeSimulation';
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

export function requestNfeDefaults(change?: NfeDefaultsConfig, signal?: AbortSignal) {
  return fiscalRequest<NfeDefaultsConfig>('/api/admin/nfe-defaults', change, signal);
}

export function requestNfeAddress(cep: string) {
  return fiscalRequest<Omit<NfeAddress, 'numero' | 'complemento'>>('/api/admin/nfe-postal-address', { cep });
}

export function requestNfeSummaries(ids: string[], signal?: AbortSignal) {
  return fiscalRequest<Record<string, NfeOrderSummary>>('/api/admin/orders/nfe-summary', { ids }, signal);
}

export function requestNfeSimulation(change?: NfeSimulationRequest, signal?: AbortSignal) {
  return fiscalRequest<NfeSimulationView>('/api/admin/nfe-simulation', change, signal);
}

export const nfeAdminApi = {
  draft: requestNfeDraft,
  defaults: requestNfeDefaults,
  address: requestNfeAddress,
  summaries: requestNfeSummaries,
  simulation: requestNfeSimulation,
};

export type NfeAdminApi = typeof nfeAdminApi;
