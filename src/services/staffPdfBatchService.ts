import {
  isStaffPdfSimpleJob,
  type StaffPdfBatchApi,
  type StaffPdfRecipe,
} from "../lib/staffPdfBatch";
import { readStaffPdf, staffPdfRequest } from "./staffPdfRequest";
import { exportStaffPdf } from "./staffPdfRender";

export const staffPdfBatchApi: StaffPdfBatchApi = {
  list: () => staffPdfRequest("/batches"),
  create: async (requestId, name) =>
    (await staffPdfRequest("/batches", { requestId, name })).batch,
  rename: async (id, name) =>
    (await staffPdfRequest(`/batches/${id}/name`, { name })).batch,
  items: (id) => staffPdfRequest(`/batches/${id}/items`),
  save: (id, job, requestId) =>
    staffPdfRequest(`/batches/${id}/items`, { job, requestId }),
  recipe: (batchId, itemId) =>
    staffPdfRequest(`/batches/${batchId}/items/${itemId}`),
  complete: async (batchId, itemId) => {
    await staffPdfRequest(`/batches/${batchId}/items/${itemId}/complete`, {});
  },
};

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
