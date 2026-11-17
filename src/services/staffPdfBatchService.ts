import {
  isStaffPdfSimpleJob,
  type StaffPdfArchiveFormat,
  type StaffPdfBatchApi,
  type StaffPdfRecipe,
  type StaffPdfArchiveProgress,
} from "../lib/staffPdfBatch";
import { readStaffPdf, staffPdfRequest } from "./staffPdfRequest";
import { exportStaffPdf } from "./staffPdfRender";

export const staffPdfBatchApi: StaffPdfBatchApi = {
  list: (cursor) => staffPdfRequest(`/batches${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
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
  archive: (batchId, progress, format = "zip") => staffPdfRequest(`/batches/${batchId}/archive`, { ...progress, format }),
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

export async function restoreStaffPdfBatchFile(
  api: StaffPdfBatchApi, batchId: string, itemId: string,
  assets?: ReturnType<typeof createStaffPdfAssetCache>,
) {
  const recipe = await api.recipe(batchId, itemId);
  if (!recipe.item.hasFile) {
    if (!recipe.uploadExists)
      await api.upload(batchId, itemId, await renderStaffPdfRecipe(recipe, assets));
    await api.complete(batchId, itemId);
  }
}

export async function retryStaffPdfRateLimit<T>(request: () => Promise<T>, active: () => boolean) {
  for (let retries = 0; ; retries++) {
    try {
      return await request();
    } catch (error) {
      if ((error as { status?: number })?.status !== 429 || retries >= 4 || !active()) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 15000));
      if (!active()) throw error;
    }
  }
}

export async function loadStaffPdfArchive(
  api: StaffPdfBatchApi,
  batchId: string,
  { restoreLegacy = false, active = () => true, format = "zip", legacyReadOnly = false }: {
    restoreLegacy?: boolean;
    legacyReadOnly?: boolean;
    active?: () => boolean;
    format?: StaffPdfArchiveFormat;
  } = {},
) {
  let progress: StaffPdfArchiveProgress | undefined;
  const assets = createStaffPdfAssetCache();
  while (active()) {
    const result = await retryStaffPdfRateLimit(() => api.archive(batchId, progress, format), active);
    if ("url" in result) return result;
    if ("empty" in result) return;
    if ("legacy" in result) {
      if (legacyReadOnly) throw new Error("Este lote precisa ser recuperado pelo responsável para o download em conjunto. Os PDFs individuais estão disponíveis.");
      if (!restoreLegacy) return;
      for (const itemId of result.legacy) {
        if (!active()) return;
        await retryStaffPdfRateLimit(() => restoreStaffPdfBatchFile(api, batchId, itemId, assets), active);
      }
      progress = undefined;
    } else {
      progress = result.progress;
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

export function createStaffPdfAssetCache() {
  const limit = 96 * 1024 * 1024;
  const entries = new Map<string, { result: Promise<Blob>; size?: number }>();
  let bytes = 0;
  return (key: string | undefined, fetchAsset: () => Promise<Blob>) => {
    if (!key) return fetchAsset();
    const cached = entries.get(key);
    if (cached) {
      entries.delete(key);
      entries.set(key, cached);
      return cached.result;
    }
    const entry: { result: Promise<Blob>; size?: number } = { result: fetchAsset() };
    entries.set(key, entry);
    void entry.result.then((blob) => {
      entry.size = blob.size;
      bytes += blob.size;
      for (const [oldKey, old] of entries) {
        if (bytes <= limit && entries.size <= 128) break;
        if (old.size === undefined) continue;
        entries.delete(oldKey);
        bytes -= old.size;
      }
    }, () => { entries.delete(key); });
    return entry.result;
  };
}

export async function renderStaffPdfRecipe(
  recipe: StaffPdfRecipe,
  asset = (_key: string | undefined, download: () => Promise<Blob>) => download(),
) {
  if (recipe.rendererVersion !== 1)
    throw new Error("Esta receita exige uma versão diferente do editor.");
  const [original, initial, fonts] = await Promise.all([
    asset(recipe.originalKey, () => readStaffPdf(recipe.originalUrl)),
    recipe.initial && asset(recipe.initial.assetKey, () =>
      readAsset(recipe.initial!.url, "image/png", 50 * 1024 * 1024),
    ).then((source) => ({ source, sizePercent: recipe.initial!.sizePercent })),
    Promise.all(recipe.fonts.map(async (font) => {
      if (!font.arquivoUrl) return font;
      const blob = await asset(font.assetKey, () =>
        readAsset(font.arquivoUrl!, `font/${font.arquivoFormato || "woff2"}`, 16 * 1024 * 1024),
      );
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(new Error("Não foi possível ler a fonte do lote."));
        reader.readAsDataURL(blob);
      });
      return {
        ...font,
        arquivoUrl: data,
        // Concurrent recipes can refer to different revisions of the same font.
        ...(font.assetKey ? { cssFamily: `StaffPdf-${font.assetKey}` } : {}),
      };
    })),
  ]);
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
