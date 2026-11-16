import {
  isStaffPdfSimpleJob,
  type StaffPdfBatchApi,
  type StaffPdfRecipe,
  type StaffPdfArchiveProgress,
} from "../lib/staffPdfBatch";
import { readStaffPdf, staffPdfRequest } from "./staffPdfRequest";
import { exportStaffPdf } from "./staffPdfRender";

export const staffPdfBatchApi: StaffPdfBatchApi = {
  list: () => staffPdfRequest("/batches"),
  create: async (requestId, name) =>
    (await staffPdfRequest("/batches", { requestId, name })).batch,
  rename: async (id, name) =>
    (await staffPdfRequest(`/batches/${id}/name`, { name })).batch,
  items: (id, cursor) => staffPdfRequest(`/batches/${id}/items${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  save: (id, job, requestId) =>
    staffPdfRequest(`/batches/${id}/items`, { job, requestId }),
  recipe: (batchId, itemId) =>
    staffPdfRequest(`/batches/${batchId}/items/${itemId}`),
  upload: async (batchId, itemId, pdf) => {
    const crc32 = await zipChecksum(pdf);
    const target = await staffPdfRequest(`/batches/${batchId}/items/${itemId}/upload`, { size: pdf.size, crc32 });
    if (target.uploaded) return;
    const response = await fetch(target.url, {
      method: "PUT",
      headers: target.headers,
      body: pdf,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok && response.status !== 412)
      throw new Error("Não foi possível armazenar o PDF no lote.");
  },
  complete: async (batchId, itemId) => {
    await staffPdfRequest(`/batches/${batchId}/items/${itemId}/complete`, {});
  },
  file: async (batchId, itemId, inline) =>
    (await staffPdfRequest(`/batches/${batchId}/items/${itemId}/file${inline ? "?inline=true" : ""}`)).file,
  archive: (batchId, progress) => staffPdfRequest(`/batches/${batchId}/archive`, progress ?? {}),
};

// ZIP stores the IEEE CRC-32 of each entry, distinct from Storage's CRC32C.
const zipCrcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

async function zipChecksum(pdf: Blob) {
  let crc = 0xffffffff;
  const reader = pdf.stream().getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const byte of value) crc = (crc >>> 8) ^ zipCrcTable[(crc ^ byte) & 0xff];
    }
  } finally {
    reader.releaseLock();
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

export async function restoreStaffPdfBatchFile(api: StaffPdfBatchApi, batchId: string, itemId: string) {
  const recipe = await api.recipe(batchId, itemId);
  if (!recipe.item.hasFile) {
    if (!recipe.uploadExists)
      await api.upload(batchId, itemId, await renderStaffPdfRecipe(recipe));
    await api.complete(batchId, itemId);
  }
}

export async function loadStaffPdfArchive(
  api: StaffPdfBatchApi,
  batchId: string,
  restoreLegacy = false,
  active = () => true,
) {
  let progress: StaffPdfArchiveProgress | undefined;
  while (active()) {
    try {
      const result = await api.archive(batchId, progress);
      if ("url" in result) return result;
      if ("empty" in result) return;
      if ("legacy" in result) {
        if (!restoreLegacy) return;
        for (const itemId of result.legacy) {
          if (!active()) return;
          await restoreStaffPdfBatchFile(api, batchId, itemId);
        }
        progress = undefined;
      } else {
        progress = result.progress;
      }
    } catch (error) {
      if (!restoreLegacy || (error as { status?: number })?.status !== 429) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 10000));
    }
  }
}

async function readAsset(url: string, type: string, limit: number) {
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok || !response.body)
    throw new Error("Não foi possível carregar a inicial do lote.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new Error("Inicial do lote maior que o permitido.");
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new Blob(chunks, { type });
}

export async function renderStaffPdfRecipe(recipe: StaffPdfRecipe) {
  if (recipe.rendererVersion !== 1)
    throw new Error("Esta receita exige uma versão diferente do editor.");
  const original = await readStaffPdf(recipe.originalUrl);
  const initial = recipe.initial
    ? {
        source: await readAsset(
          recipe.initial.url,
          "image/png",
          50 * 1024 * 1024,
        ),
        sizePercent: recipe.initial.sizePercent,
      }
    : undefined;
  const fonts = await Promise.all(
    recipe.fonts.map(async (font) => {
      if (!font.arquivoUrl) return font;
      const blob = await readAsset(
        font.arquivoUrl,
        `font/${font.arquivoFormato || "woff2"}`,
        16 * 1024 * 1024,
      );
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(new Error("Não foi possível ler a fonte do lote."));
        reader.readAsDataURL(blob);
      });
      return { ...font, arquivoUrl: data };
    }),
  );
  if (isStaffPdfSimpleJob(recipe.job)) {
    const { pdfPreviewPages } = await import("./pdfPreview");
    const { exportPersonalizationPdf } = await import(
      "./personalizationExport"
    );
    const { stampStaffBarcode } = await import("./staffPdfBarcode");
    const [page] = await pdfPreviewPages(original);
    const value = await exportPersonalizationPdf({
      title: recipe.job.outputName,
      originalPdf: original,
      repeatFrontForBack: true,
      customization: recipe.job.customization,
      fonts,
      initial,
      ...(recipe.printProfile ? { printProfile: recipe.printProfile } : {}),
      pages: [
        { label: "Capa", blob: page },
        { label: "Contracapa", blob: page },
      ],
    });
    return stampStaffBarcode(
      value,
      recipe.job.barcode,
      recipe.job.barcodeVersion ?? 1,
    );
  }
  return exportStaffPdf(original, recipe.job, fonts, recipe.fitMargin, initial);
}
