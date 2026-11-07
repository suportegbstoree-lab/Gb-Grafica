import { auth } from "../firebase";
import { apiFetch } from "./apiClient";
import { STAFF_DOCUMENT_MAX_BYTES } from "../lib/staffDocument";
export async function staffPdfRequest(
  path: string,
  body?: unknown,
  documents = false,
) {
  const user = auth.currentUser;
  if (!user) throw new Error("Entre novamente para continuar.");
  const response = await apiFetch(
    `/api/admin/${documents ? "documents" : "pdf-library"}${path}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${await user.getIdToken()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || "Não foi possível acessar os PDFs internos.");
  return data;
}
export async function readStaffPdf(url: string) {
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(60000),
  });
  if (
    !response.ok ||
    !response.body ||
    response.headers.get("content-type")?.split(";")[0] !== "application/pdf"
  )
    throw new Error("Não foi possível ler a base PDF.");
  const parts: Uint8Array<ArrayBuffer>[] = [],
    reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > STAFF_DOCUMENT_MAX_BYTES)
        throw new Error("PDF maior que 50 MB.");
      parts.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new Blob(parts, { type: "application/pdf" });
}
