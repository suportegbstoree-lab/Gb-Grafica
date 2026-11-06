import { DOCUMENT_RETENTION_DAYS } from "./work.js";
export const STAFF_DOCUMENT_TTL_MS = DOCUMENT_RETENTION_DAYS * 86400000;
export const STAFF_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
export function validDocumentId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}
export function staffDocumentPath(uid: string, id: string, upload = false) {
  if (
    !uid ||
    uid.length > 128 ||
    /[/\\\u0000-\u001f\u007f]/.test(uid) ||
    [".", ".."].includes(uid) ||
    !validDocumentId(id)
  )
    throw new Error("Documento inválido.");
  return `staff-documents/${uid}/${id}/${upload ? "upload" : "document"}.pdf`;
}
export function staffDocumentView(id: string, data: any) {
  return {
    id,
    ownerId: data.ownerId,
    ownerName: data.ownerName,
    templateName: data.templateName,
    ...(typeof data.outputName === "string" ? { outputName: data.outputName } : {}),
    productId: data.productId,
    templateId: data.templateId,
    createdAt: data.createdAt,
    completedAt: data.completedAt || null,
    expiresAt: data.expiresAt,
    status: data.status,
    size: data.size || 0,
    reference: data.reference,
    sha256: data.sha256 || null,
  };
}
