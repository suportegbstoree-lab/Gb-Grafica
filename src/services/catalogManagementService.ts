import { auth } from '../firebase';
import { apiFetch } from './apiClient';
import { apiErrorMessage } from '../lib/apiError';
async function mutate(collection: string, id: string, mode: string, value?: unknown, removed?: string[]) {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre novamente para continuar.');
  const response = await apiFetch(`/api/admin/catalog/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, value, removed }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(data, 'Não foi possível salvar o cadastro.'));
}
export const catalogPersistence = {
  setDocument: (collection: string, id: string, value: unknown) => mutate(collection, id, 'set', value),
  patchDocument: (collection: string, id: string, value: unknown, removed: string[] = []) => mutate(collection, id, 'patch', value, removed),
  deleteDocument: (collection: string, id: string) => mutate(collection, id, 'delete'),
};
