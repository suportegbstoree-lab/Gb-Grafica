import { ref, uploadBytesResumable } from "firebase/storage";
import { auth, storage } from "../firebase";
import { apiFetch } from "./apiClient";
import {
  STAFF_DOCUMENT_MAX_BYTES,
  staffDocumentPath,
} from "../lib/staffDocument";
import type { TextCustomization } from "../lib/textCustomization";
export interface StaffDocumentView {
  id: string;
  ownerId: string;
  ownerName: string;
  templateName: string;
  outputName?: string;
  productId: string;
  templateId: string;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
  status: string;
  size: number;
  reference: string;
  sha256: string | null;
}
export interface StaffDocumentApi {
  list(): Promise<{ documents: StaffDocumentView[]; truncated: boolean }>;
  template(productId: string, templateId: string): Promise<Blob>;
  generate(
    productId: string,
    templateId: string,
    customization: TextCustomization,
    pdf: Blob,
    requestId: string,
  ): Promise<StaffDocumentView>;
  file(id: string, mode: "view" | "download" | "print"): Promise<Blob>;
  share(id: string): Promise<string>;
  revoke(id: string): Promise<void>;
  email(id: string, to: string, requestId: string): Promise<{ status: string }>;
  cancel(id: string): Promise<void>;
}
async function request(path: string, body?: unknown) {
  const user = auth.currentUser;
  if (!user) throw new Error("Entre novamente para continuar.");
  const response = await apiFetch(`/api/admin/documents${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || "Não foi possível acessar o documento.");
  return data;
}
async function readPdf(url: string) {
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(60000),
  });
  if (
    !response.ok ||
    response.headers.get("content-type")?.split(";")[0] !== "application/pdf" ||
    !response.body
  )
    throw new Error("Não foi possível ler o PDF.");
  const reader = response.body.getReader(),
    parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > STAFF_DOCUMENT_MAX_BYTES)
        throw new Error("O PDF excede o limite permitido.");
      parts.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new Blob(parts, { type: "application/pdf" });
}
export const staffDocumentApi: StaffDocumentApi = {
  list: () => request(""),
  template: async (productId, templateId) =>
    readPdf(
      (
        await request(
          `/templates/${encodeURIComponent(productId)}/${encodeURIComponent(templateId)}`,
        )
      ).url,
    ),
  generate: async (productId, templateId, customization, pdf, requestId) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Entre novamente para continuar.");
    if (
      pdf.type !== "application/pdf" ||
      pdf.size <= 0 ||
      pdf.size > STAFF_DOCUMENT_MAX_BYTES
    )
      throw new Error("O PDF gerado excede o limite permitido.");
    const created = await request("", {
      productId,
      templateId,
      customization,
      requestId,
    });
    if (created.document.status === "ready") return created.document;
    if (created.path !== staffDocumentPath(user.uid, created.document.id, true))
      throw new Error("Destino de envio inválido.");
    if (!created.uploadExists)
      await uploadBytesResumable(ref(storage, created.path), pdf, {
        contentType: "application/pdf",
        customMetadata: {
          ownerId: user.uid,
          documentId: created.document.id,
          kind: "staff-document",
        },
      });
    return (await request(`/${created.document.id}/finalize`, {})).document;
  },
  file: async (id, mode) =>
    readPdf((await request(`/${id}/file?mode=${mode}`)).url),
  share: async (id) => (await request(`/${id}/share`, {})).url,
  revoke: async (id) => {
    await request(`/${id}/revoke-sharing`, {});
  },
  email: (id, to, requestId) => request(`/${id}/email`, { to, requestId }),
  cancel: async (id) => {
    await request(`/${id}/cancel`, {});
  },
};
