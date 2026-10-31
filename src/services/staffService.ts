import { auth } from '../firebase';
import { apiFetch } from './apiClient';
import { apiErrorMessage, type ApiErrorPayload } from '../lib/apiError';
import type { StaffOverview, StaffRoleId, StaffRoleView, StaffPermission, AssignedRole } from '../lib/staffAccess';

export interface StaffAssignmentResult { changed: boolean; uid: string; email: string; role: AssignedRole; notification: { id?: string; status: string }; }
export interface StaffAdministrationApi {
  load(): Promise<StaffOverview>;
  saveRole(id: StaffRoleId, permissions: StaffPermission[], expectedRevision: string | null): Promise<StaffRoleView>;
  assign(email: string, role: AssignedRole): Promise<StaffAssignmentResult>;
  retryNotification(id: string): Promise<{ status: string }>;
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sua sessão expirou. Faça login novamente.');
  const response = await apiFetch(`/api/admin/staff${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(data as ApiErrorPayload, 'Não foi possível atualizar os acessos.'));
  return data as T;
}
export const staffAdministrationApi: StaffAdministrationApi = {
  load: () => request(''), saveRole: (id, permissions, expectedRevision) => request(`/roles/${id}`, { permissions, expectedRevision }),
  assign: (email, role) => request('/assign', { email, role }), retryNotification: id => request(`/notifications/${encodeURIComponent(id)}/retry`, {}),
};
