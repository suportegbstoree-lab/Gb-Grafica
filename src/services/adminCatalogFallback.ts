import { auth, storage } from '../firebase';
import { apiFetch } from './apiClient';
import { apiErrorMessage, type ApiErrorPayload } from '../lib/apiError';
import { runCatalogRelayUpload, type CatalogAssetKind } from './catalogRelayClient';

export const needsCatalogFallback = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'storage/unauthorized';

async function request(path: string, body: unknown, uid: string, retry = false): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < (retry ? 3 : 1); attempt++) {
    if (auth.currentUser?.uid !== uid) throw new Error('Sua sessão expirou. Faça login novamente.');
    const token = await auth.currentUser.getIdToken();
    const response = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as ApiErrorPayload & Record<string, unknown>;
    if (response.ok) return data;
    if (retry && [409, 503].includes(response.status) && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); continue; }
    throw new Error(apiErrorMessage(data, 'O envio administrativo foi recusado.'));
  }
  throw new Error('O envio administrativo não foi concluído.');
}

export function uploadCatalogFallback(blob: Blob, name: string, kind: CatalogAssetKind, ownerId: string, uid: string) {
  return runCatalogRelayUpload(blob, name, kind, ownerId, String(storage.app.options.storageBucket || ''),
    data => request('/api/admin/catalog-uploads', data, uid),
    (id, data) => request(`/api/admin/catalog-uploads/${id}/chunk`, data, uid, true));
}

export async function deleteCatalogFallback(path: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sua sessão expirou. Faça login novamente.');
  await request('/api/admin/catalog-assets/delete', { path }, uid);
}
