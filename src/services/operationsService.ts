import { auth } from "../firebase";
import { apiFetch } from "./apiClient";
export interface OperationsClient {
  get: (path: string) => Promise<any>;
  post: (path: string, body: unknown) => Promise<any>;
  csv: (path: string) => Promise<Blob>;
}
async function request(path: string, body?: unknown) {
  const user = auth.currentUser;
  if (!user) throw new Error("Entre novamente para continuar.");
  const response = await apiFetch(`/api/admin/operations${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "Não foi possível concluir a operação.");
  }
  return response;
}
export const operationsClient: OperationsClient = {
  get: async (path) => (await request(path)).json(),
  post: async (path, body) => (await request(path, body)).json(),
  csv: async (path) => (await request(path)).blob(),
};
