import { ref, uploadBytesResumable, deleteObject } from "firebase/storage";
import { auth, storage } from "../firebase";
import { apiFetch } from "./apiClient";
export interface OperationsClient {
  get: (path: string) => Promise<any>;
  post: (path: string, body: unknown) => Promise<any>;
  csv: (path: string) => Promise<Blob>;
  uploadRelease: (file: File) => Promise<string>;
  removeReleaseUpload: (path: string) => Promise<void>;
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
  async uploadRelease(file) {
    const user = auth.currentUser,
      extension = /\.(zip|exe|msi)$/i.exec(file.name)?.[1].toLowerCase();
    if (!user || !extension || !file.size || file.size > 50 * 1024 * 1024)
      throw new Error("Envie ZIP, EXE ou MSI de até 50 MB.");
    const path = `operations/releases/${crypto.randomUUID()}/${crypto.randomUUID().replaceAll("-", "")}.${extension}`;
    await uploadBytesResumable(ref(storage, path), file, {
      contentType:
        extension === "zip" ? "application/zip" : "application/octet-stream",
      customMetadata: {
        uploadedBy: user.uid,
        originalName: file.name.slice(0, 120),
      },
    });
    return path;
  },
  async removeReleaseUpload(path) {
    if (
      !/^operations\/releases\/[a-f0-9-]{36}\/[a-f0-9]{32}\.(zip|exe|msi)$/.test(
        path,
      )
    )
      throw new Error("Arquivo inválido.");
    await deleteObject(ref(storage, path));
  },
};
