import { auth } from "../firebase";
import { apiFetch } from "./apiClient";
import { setWorkTask } from "./workContext";
import type { WorkKind } from "../lib/work";
export interface WorkApi {
  get(path: string): Promise<any>;
  post(path: string, body: unknown): Promise<any>;
  csv(path: string): Promise<Blob>;
}
async function request(path: string, body?: unknown) {
  const user = auth.currentUser;
  if (!user) throw new Error("Entre novamente para continuar.");
  const response = await apiFetch(`/api/admin/work${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Não foi possível consultar o expediente.");
  }
  return response;
}
export const workApi: WorkApi = {
  get: async (path) => (await request(path)).json(),
  post: async (path, body) => (await request(path, body)).json(),
  csv: async (path) => (await request(path)).blob(),
};
export function beginWorkTask(
  kind: WorkKind,
  reference: string,
  api: WorkApi = workApi,
) {
  let cancelled = false;
  const pending = api
    .post("/tasks", { kind, reference })
    .then((value) => value.id as string);
  const clear = setWorkTask(pending);
  return () => {
    if (cancelled) return;
    cancelled = true;
    clear();
    void pending
      .then((id) => api.post(`/tasks/${id}/cancel`, {}))
      .catch(() => undefined);
  };
}
