import { MAX_ARTWORK_BYTES, matchesArtworkSignature } from "../lib/artwork";

const previews = new WeakMap<Blob, Map<number, Promise<File[]>>>();
export function pdfPreviewPages(blob: Blob, maxPages = 2): Promise<File[]> {
  let variants = previews.get(blob);
  if (!variants) {
    variants = new Map();
    previews.set(blob, variants);
  }
  const cached = variants.get(maxPages);
  if (cached) return cached;
  const pending = renderPdfPages(blob, maxPages);
  variants.set(maxPages, pending);
  void pending.catch(() => variants!.delete(maxPages));
  return pending;
}

/** Staff previews only render the selected page; customer limits remain unchanged. */
export async function staffPdfPreviewPage(blob: Blob, pageNumber = 1): Promise<File> {
  const pages = await renderPdfPages(blob, 16, pageNumber);
  return pages[0];
}

/** Raster previews are local. The original PDF remains a separate production asset. */
async function renderPdfPages(blob: Blob, maxPages = 2, selectedPage?: number): Promise<File[]> {
  if (
    blob.type !== "application/pdf" ||
    blob.size <= 0 ||
    blob.size > MAX_ARTWORK_BYTES ||
    !matchesArtworkSignature(
      blob.type,
      new Uint8Array(await blob.slice(0, 8).arrayBuffer()),
    )
  )
    throw new Error("Envie um PDF válido de até 50 MB.");
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = (
    await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  ).default;
  const task = getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    enableXfa: false,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > maxPages)
      throw new Error(
        `Use um PDF de até ${maxPages} páginas para capa e contracapa.`,
      );
    const results: File[] = [];
    if (selectedPage !== undefined && (!Number.isInteger(selectedPage) || selectedPage < 1 || selectedPage > pdf.numPages)) throw new Error('Página inválida.');
    for (let i = selectedPage || 1; i <= (selectedPage || pdf.numPages); i++) {
      const page = await pdf.getPage(i),
        viewport = page.getViewport({ scale: 300 / 72 });
      if (
        viewport.width * viewport.height > 64_000_000 ||
        Math.max(viewport.width, viewport.height) > 32767
      )
        throw new Error(
          "Esta página excede a capacidade de edição a 300 DPI. Nenhuma redução foi aplicada.",
        );
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      try {
        await page.render({ canvas, viewport }).promise;
        const png = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value
                ? resolve(value)
                : reject(new Error("Não foi possível gerar a prévia.")),
            "image/png",
          ),
        );
        if (png.size > MAX_ARTWORK_BYTES)
          throw new Error("A prévia em resolução integral excede 50 MB.");
        results.push(new File([png], `pagina-${i}.png`, { type: "image/png" }));
      } finally {
        canvas.width = canvas.height = 1;
      }
    }
    return results;
  } finally {
    await task.destroy();
  }
}
