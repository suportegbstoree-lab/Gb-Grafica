import type { ProductPdfTemplate } from "../lib/pdfTemplate";
import { staffPdfBatchApi } from "./staffPdfBatchService";
import type { StaffPdfBatchApi } from "../lib/staffPdfBatch";
import { ref, uploadBytesResumable } from "firebase/storage";
import { auth, storage } from "../firebase";
import {
  STAFF_DOCUMENT_MAX_BYTES,
  staffDocumentPath,
} from "../lib/staffDocument";
import {
  staffPdfSourceName,
  type StaffPdfBase,
  type StaffPdfLayout,
  type StaffPdfLayoutView,
  type StaffPdfJob,
} from "../lib/staffPdf";
import type { StaffDocumentView } from "./staffDocumentService";
import {
  firstInitial,
  matchingAlphabetName,
  readAlphabetFiles,
  validDecorativePngHeader,
  type DecorativeInitial,
} from "../lib/decorativeInitial";
export interface StaffPdfLibrary {
  bases: StaffPdfBase[];
  layouts: StaffPdfLayoutView[];
  truncated: boolean;
  pendingUploads?: Array<{ id: string; name: string }>;
}
export interface StaffPdfApi {
  batches?: StaffPdfBatchApi;
  list(): Promise<StaffPdfLibrary>;
  baseFile(id: string): Promise<Blob>;
  prepareProductCopy(
    productId: string,
    base: Pick<StaffPdfBase, "id" | "revision">,
  ): Promise<{
    template: ProductPdfTemplate;
    assets: Array<{ path: string; url: string }>;
    sourceUrl?: string;
  }>;
  uploadBase(
    file: File,
    requestId: string,
    replacement?: Pick<StaffPdfBase, "id" | "name" | "sourceName" | "revision" | "category">,
    category?: string,
  ): Promise<string>;
  renameBase(base: Pick<StaffPdfBase, "id" | "name" | "revision">, name: string): Promise<void>;
  deleteBase(id: string): Promise<void>;
  saveLayout(
    name: string,
    layout: StaffPdfLayout,
    revision?: string,
  ): Promise<void>;
  deleteLayout(id: string, revision: string): Promise<void>;
  importLayouts(
    templates: unknown,
  ): Promise<{ created: number; skipped: number }>;
  initial(id: string, text: string): Promise<DecorativeInitial | undefined>;
  uploadAlphabet(
    base: Pick<StaffPdfBase, "id" | "name" | "sourceName"> &
      Partial<Pick<StaffPdfBase, "revision">>,
    files: File[],
    progress?: (completed: number, total: number) => void,
    mold?: Pick<StaffPdfLayoutView, "id" | "name">,
  ): Promise<void>;
  generate(
    job: StaffPdfJob,
    pdf: Blob,
    requestId: string,
  ): Promise<StaffDocumentView>;
}
export { staffPdfRequest, readStaffPdf } from "./staffPdfRequest";
import { staffPdfRequest, readStaffPdf } from "./staffPdfRequest";

export const staffPdfApi: StaffPdfApi = {
  batches: staffPdfBatchApi,
  list: () => staffPdfRequest(""),
  baseFile: async (id) =>
    readStaffPdf(
      (await staffPdfRequest(`/bases/${encodeURIComponent(id)}/file`)).url,
    ),
  prepareProductCopy: (productId, base) =>
    staffPdfRequest(`/bases/${encodeURIComponent(base.id)}/product-copy`, {
      productId,
      baseRevision: base.revision,
    }),
  uploadBase: async (file, requestId, replacement, category) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Entre novamente.");
    if (
      !/\.pdf$/i.test(file.name) ||
      file.size < 8 ||
      file.size > STAFF_DOCUMENT_MAX_BYTES ||
      (await file.slice(0, 5).text()) !== "%PDF-"
    )
      throw new Error("Envie um PDF válido de até 50 MB.");
    const pending = await staffPdfRequest("/bases", {
      name: replacement ? staffPdfSourceName(replacement) : file.name,
      requestId,
      ...(category || replacement?.category
        ? { category: category || replacement?.category }
        : {}),
      ...(replacement
        ? {
            replacement: { id: replacement.id, revision: replacement.revision },
          }
        : {}),
    });
    if (
      pending.path !== `staff-pdf-bases/${pending.id}/upload.pdf` ||
      !/^[a-f0-9]{32}$/.test(pending.id)
    )
      throw new Error("Destino inválido.");
    if (pending.ready) return replacement?.id ?? pending.id;
    try {
      await uploadBytesResumable(ref(storage, pending.path), file, {
        contentType: "application/pdf",
        customMetadata: { uploadedBy: user.uid },
      });
      const { id } = await staffPdfRequest(`/bases/${pending.id}/finalize`, {});
      return id;
    } catch (e) {
      await staffPdfRequest(`/bases/${pending.id}/delete`, {}).catch(
        () => undefined,
      );
      throw e;
    }
  },
  renameBase: async (base, name) => {
    await staffPdfRequest(`/bases/${encodeURIComponent(base.id)}/rename`, {
      name,
      expectedName: base.name,
      baseRevision: base.revision,
    });
  },
  deleteBase: async (id) => {
    await staffPdfRequest(`/bases/${id}/delete`, {});
  },
  saveLayout: async (name, layout, revision) => {
    await staffPdfRequest("/layouts", { name, layout, revision });
  },
  deleteLayout: async (id, revision) => {
    await staffPdfRequest(`/layouts/${id}/delete`, { revision });
  },
  importLayouts: (templates) =>
    staffPdfRequest("/layouts/import", { templates }),
  initial: async (id, text) => {
    const letter = firstInitial(text);
    if (!letter) return undefined;
    const data = await staffPdfRequest(
      `/bases/${encodeURIComponent(id)}/initial?letter=${encodeURIComponent(letter)}`,
    );
    if (!data.url) return undefined;
    const response = await fetch(data.url, {
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(60000),
    });
    if (
      !response.ok ||
      response.headers.get("content-type")?.split(";")[0] !== "image/png" ||
      !response.body
    )
      throw new Error("Não foi possível carregar a inicial.");
    const parts: Uint8Array<ArrayBuffer>[] = [],
      reader = response.body.getReader();
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > STAFF_DOCUMENT_MAX_BYTES)
          throw new Error("Inicial maior que 50 MB.");
        parts.push(new Uint8Array(value));
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return {
      source: new Blob(parts, { type: "image/png" }),
      sizePercent: data.sizePercent,
    };
  },
  uploadAlphabet: async (base, files, progress, mold) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Entre novamente.");
    const sourceName = staffPdfSourceName(base);
    const parsed = readAlphabetFiles(files, mold?.name ?? sourceName),
      letters: Record<string, { path: string }> = {};
    for (const { file } of parsed.letters) {
      const header = new Uint8Array(await file.slice(0, 33).arrayBuffer());
      if (!validDecorativePngHeader(header))
        throw new Error(
          `“${file.name}” tem cabeçalho PNG inválido ou excede as dimensões permitidas.`,
        );
    }
    const { uploadBatch } = await import("../lib/uploadBatch");
    const rollback = (path: string) =>
      staffPdfRequest(`/bases/${base.id}/alphabet-upload/delete`, { path });
    progress?.(0, parsed.letters.length);
    const uploaded = await uploadBatch(
      parsed.letters,
      async ({ file, letter }) => {
        const path = `staff-pdf-bases/${base.id}/letters/${crypto.randomUUID().replaceAll("-", "")}.png`;
        try {
          await uploadBytesResumable(ref(storage, path), file, {
            contentType: "image/png",
            customMetadata: { uploadedBy: user.uid },
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Falha ao enviar “${file.name}” ao Storage. ${detail}`,
          );
        }
        letters[letter] = { path };
        return path;
      },
      { concurrency: 3, rollback, progress },
    );
    try {
      await staffPdfRequest(`/bases/${base.id}/alphabet`, {
        folderName: parsed.folderName,
        ...(base.revision ? { baseRevision: base.revision } : {}),
        ...(!matchingAlphabetName(sourceName, parsed.folderName) && mold
          ? { layoutId: mold.id }
          : {}),
        letters,
      });
    } catch (e) {
      await Promise.allSettled(uploaded.map(rollback));
      throw e;
    }
  },
  generate: async (staffJob, pdf, requestId) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Entre novamente.");
    if (
      pdf.type !== "application/pdf" ||
      pdf.size < 8 ||
      pdf.size > STAFF_DOCUMENT_MAX_BYTES
    )
      throw new Error("O PDF gerado excede o limite permitido.");
    const created = await staffPdfRequest("", { staffJob, requestId }, true);
    if (created.document.status === "ready") return created.document;
    if (created.path !== staffDocumentPath(user.uid, created.document.id, true))
      throw new Error("Destino inválido.");
    if (!created.uploadExists)
      await uploadBytesResumable(ref(storage, created.path), pdf, {
        contentType: "application/pdf",
        customMetadata: {
          ownerId: user.uid,
          documentId: created.document.id,
          kind: "staff-document",
        },
      });
    return (await staffPdfRequest(`/${created.document.id}/finalize`, {}, true))
      .document;
  },
};
