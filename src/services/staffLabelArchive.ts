import type {
  LabelArchiveApi,
  LabelArchiveRef,
  LabelImport,
  LabelTransferPage,
} from "../lib/staffLabelImport";

async function dataUrl(blob: Blob) {
  const reader = new FileReader();
  return new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function encode(bytes: Uint8Array) {
  return (await dataUrl(new Blob([new Uint8Array(bytes)]))).split(",")[1];
}

export async function uploadLabelPages(
  api: LabelArchiveApi,
  file: File,
  item: LabelImport,
  progress: (n: number, total: number) => void,
) {
  const header = await api.begin(item.id, item.name, item.pages.length);
  const ref = { id: header.id, revision: header.revision };
  if (header.state === "ready") return;
  const existing = new Set((await api.read(ref)).map((page) => page.number));
  const { PDFDocument } = await import("pdf-lib");
  const source = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  let group: LabelTransferPage[] = [];
  let size = 0,
    sent = existing.size;
  async function flush() {
    if (!group.length) return;
    await api.upload(ref, group);
    sent += group.length;
    progress(sent, item.pages.length);
    group = [];
    size = 0;
  }
  for (const [i, label] of item.pages.entries()) {
    const number = i + 1;
    if (existing.has(number)) continue;
    const pdf = await PDFDocument.create({ updateMetadata: false });
    const [page] = await pdf.copyPages(source, [i]);
    pdf.addPage(page);
    const bytes = await pdf.save();
    if (bytes.length > 50 * 1024 * 1024) throw new Error("A página " + number + " excede 50 MB.");
    const entry: LabelTransferPage = { number, label };
    if (bytes.length > 1536 * 1024) {
      await flush();
      const step = 512 * 1024;
      entry.parts = Math.ceil(bytes.length / step);
      for (let j = 0; j < entry.parts; j++)
        await api.part(ref, number, j + 1, await encode(bytes.subarray(j * step, (j + 1) * step)));
    } else entry.data = await encode(bytes);
    const length = JSON.stringify(entry).length;
    if (group.length >= 20 || size + length > 2400 * 1024) await flush();
    group.push(entry);
    size += length;
  }
  await flush();
}

/** Read the private, persisted PDFs for the in-panel viewer. */
export async function labelPdfFile(
  api: LabelArchiveApi,
  ref: LabelArchiveRef,
  numbers: number[],
  signal: AbortSignal,
  kind?: "active" | "excluded",
): Promise<Blob> {
  const { readStaffPdf } = await import("./staffPdfRequest");
  if (kind) {
    signal.throwIfAborted();
    const result = await api.export(ref, kind);
    signal.throwIfAborted();
    return readStaffPdf(result.url, signal, Infinity);
  }
  if (!numbers.length) throw new Error("Selecione ao menos uma etiqueta.");
  const { PDFDocument } = await import("pdf-lib");
  const combined = numbers.length > 1 ? await PDFDocument.create({ updateMetadata: false }) : undefined;
  for (let start = 0; start < numbers.length; start += 12) {
    signal.throwIfAborted();
    const selection = numbers.slice(start, start + 12);
    const urls = await api.links(ref, selection);
    signal.throwIfAborted();
    if (
      !Array.isArray(urls) ||
      urls.length !== selection.length ||
      urls.some((url) => typeof url !== "string" || !url.trim())
    )
      throw new Error("Não foi possível localizar o PDF das etiquetas. Atualize a importação.");
    for (const url of urls) {
      signal.throwIfAborted();
      let blob: Blob;
      try {
        blob = await readStaffPdf(url, signal);
      } catch {
        signal.throwIfAborted();
        throw new Error("Não foi possível baixar a etiqueta salva. Tente novamente.");
      }
      signal.throwIfAborted();
      let source;
      try {
        source = await PDFDocument.load(await blob.arrayBuffer(), { updateMetadata: false });
      } catch {
        throw new Error("O arquivo salvo da etiqueta não é um PDF válido.");
      }
      if (source.getPageCount() !== 1)
        throw new Error("O PDF salvo deve conter uma etiqueta por página.");
      if (!combined) return blob;
      const [page] = await combined.copyPages(source, [0]);
      combined.addPage(page);
    }
  }
  signal.throwIfAborted();
  return new Blob([new Uint8Array(await combined!.save())], { type: "application/pdf" });
}
