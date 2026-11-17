import { STAFF_DOCUMENT_MAX_BYTES } from "../lib/staffDocument";
import { staffPdfSourceName, type StaffPdfBase } from "../lib/staffPdf";

type Replacement = Pick<StaffPdfBase, "id" | "name" | "sourceName" | "revision" | "category">;
interface UploadResponse {
  id: string;
  path?: string;
  ready?: boolean;
  uploaded?: boolean;
  url?: string;
  headers?: Record<string, string>;
}
type Request = (path: string, body: unknown) => Promise<UploadResponse>;

export async function uploadStaffPdfBase(
  file: File,
  requestId: string,
  replacement: Replacement | undefined,
  category: string | undefined,
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (
    !/\.pdf$/i.test(file.name) ||
    file.size < 8 ||
    file.size > STAFF_DOCUMENT_MAX_BYTES ||
    (await file.slice(0, 5).text()) !== "%PDF-"
  )
    throw new Error("Envie um PDF válido de até 50 MB.");

  const pending = await request("/bases", {
    name: replacement ? staffPdfSourceName(replacement) : file.name,
    requestId,
    size: file.size,
    ...(category || replacement?.category
      ? { category: category || replacement?.category }
      : {}),
    ...(replacement
      ? { replacement: { id: replacement.id, revision: replacement.revision } }
      : {}),
  });
  if (
    typeof pending.id !== "string" ||
    !/^[a-f0-9]{32}$/.test(pending.id) ||
    pending.path !== `staff-pdf-bases/${pending.id}/upload.pdf`
  )
    throw new Error("Destino inválido.");
  if (pending.ready === true) return replacement?.id ?? pending.id;

  if (pending.uploaded !== true) {
    if (
      typeof pending.url !== "string" ||
      pending.headers?.["Content-Type"] !== "application/pdf" ||
      pending.headers?.["x-goog-if-generation-match"] !== "0"
    )
      throw new Error("Não foi possível autorizar o envio da base PDF.");
    let response: Response;
    try {
      response = await fetcher(pending.url, {
        method: "PUT",
        headers: pending.headers,
        body: file,
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(180000),
      });
    } catch {
      throw new Error("Não foi possível enviar a base PDF. Confira a conexão e tente novamente.");
    }
    // A lost response can leave the immutable object already stored.
    if (!response.ok && response.status !== 412)
      throw new Error("Não foi possível armazenar a base PDF. Tente novamente.");
  }

  const { id } = await request(`/bases/${pending.id}/finalize`, {});
  return id;
}
