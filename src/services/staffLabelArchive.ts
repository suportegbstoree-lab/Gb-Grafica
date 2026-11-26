import type {
  LabelArchiveApi,
  LabelArchiveHeader,
  LabelImport,
  LabelTransferPage,
} from "../lib/staffLabelImport";

async function encode(bytes: Uint8Array) {
  const reader = new FileReader();
  return new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([new Uint8Array(bytes)]));
  });
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

// Print at the original physical dimensions. The printable window only contains
// pixels rendered by PDF.js, even for a PDF with interactive content.
export async function openLabels(
  api: LabelArchiveApi,
  header: LabelArchiveHeader,
  numbers: number[],
  print: boolean,
) {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Permita abrir uma nova janela para visualizar as etiquetas.");
  popup.opener = null;
  const doc = popup.document;
  doc.title = header.name;
  doc.documentElement.lang = "pt-BR";
  const status = doc.createElement("p");
  status.textContent = "Carregando etiquetas…";
  doc.body.append(status);
  try {
    const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
    GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    const style = doc.createElement("style");
    style.textContent =
      "body{margin:0;background:#eee;color:#151515;font:16px system-ui}p,button{margin:12px}img{display:block;max-width:100%;height:auto;margin:0 auto 12px;background:white}@media print{body{background:white}p,button{display:none}img{margin:0;break-after:page;max-width:none}img:last-child{break-after:auto}}";
    doc.head.append(style);
    for (let start = 0; start < numbers.length; start += 12) {
      const selection = numbers.slice(start, start + 12);
      const urls = await api.links({ id: header.id, revision: header.revision }, selection);
      for (const [index, url] of urls.entries()) {
        if (popup.closed) return;
        const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
        if (!response.ok)
          throw new Error("Não foi possível abrir a etiqueta. Atualize a lista e tente novamente.");
        const task = getDocument({
          data: new Uint8Array(await response.arrayBuffer()),
          enableXfa: false,
        });
        try {
          const page = await (await task.promise).getPage(1);
          const original = page.getViewport({ scale: 1 });
          const scale = Math.min(
            300 / 72,
            4096 / Math.max(original.width, original.height),
            Math.sqrt(12000000 / (original.width * original.height)),
          );
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, viewport }).promise;
          const png = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (blob) =>
                blob ? resolve(blob) : reject(new Error("Não foi possível preparar a impressão.")),
              "image/png",
            ),
          );
          canvas.width = canvas.height = 0;
          const img = doc.createElement("img");
          img.alt = "Etiqueta da página " + selection[index];
          const key = "label" + selection[index];
          style.sheet!.insertRule(
            "@page " + key + " {size:" + original.width + "pt " + original.height + "pt;margin:0}",
          );
          img.style.page = key;
          img.style.width = original.width + "pt";
          // The popup owns these URLs so the browser frees them when it closes.
          img.src = doc.defaultView!.URL.createObjectURL(png);
          await img.decode();
          doc.body.append(img);
        } finally {
          await task.destroy();
        }
      }
    }
    status.remove();
    const button = doc.createElement("button");
    button.textContent = "Imprimir";
    button.onclick = () => popup.print();
    doc.body.prepend(button);
    if (print && !popup.closed) {
      popup.focus();
      popup.print();
    }
  } catch (error) {
    popup.close();
    throw error;
  }
}
