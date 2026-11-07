import {
  STAFF_BARCODE_HEIGHT,
  STAFF_BARCODE_WIDTH,
  normalizeStaffBarcode,
  staffBarcodeBoxes,
} from "../lib/staffPdfBarcode";

export async function staffBarcodeCanvas(value: string) {
  const text = normalizeStaffBarcode(value);
  const { default: bwip } = await import("bwip-js/browser");
  const source = document.createElement("canvas");
  const target = document.createElement("canvas");
  try {
    bwip.toCanvas(source, {
      bcid: "code128",
      text,
      scale: 4,
      height: 18,
      includetext: true,
      textxalign: "center",
      textsize: 10,
      paddingwidth: 10,
    });
    target.width = STAFF_BARCODE_WIDTH;
    target.height = STAFF_BARCODE_HEIGHT;
    const ctx = target.getContext("2d");
    if (!ctx) throw new Error("Não foi possível desenhar o código de barras.");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, target.width, target.height);
    return target;
  } catch (error) {
    target.width = target.height = 1;
    throw error;
  } finally {
    source.width = source.height = 1;
  }
}

export function drawStaffBarcode(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
) {
  for (const box of staffBarcodeBoxes(
    (ctx.canvas.width * 72) / 300,
    (ctx.canvas.height * 72) / 300,
  ))
    ctx.drawImage(
      image,
      (box.x * 300) / 72,
      ctx.canvas.height - ((box.y + box.height) * 300) / 72,
      (box.width * 300) / 72,
      (box.height * 300) / 72,
    );
}

export async function stampStaffBarcode(original: Blob, value: string) {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.load(await original.arrayBuffer(), {
    updateMetadata: false,
  });
  const canvas = await staffBarcodeCanvas(value);
  try {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error("Falha ao gerar o código de barras.")),
        "image/png",
      ),
    );
    const png = await pdf.embedPng(await blob.arrayBuffer());
    for (const [index, page] of pdf.getPages().entries()) {
      if (index !== 0 && !(pdf.getPageCount() === 4 && index === 2)) continue;
      for (const box of staffBarcodeBoxes(page.getWidth(), page.getHeight()))
        page.drawImage(png, box);
    }
    return new Blob([new Uint8Array(await pdf.save())], {
      type: "application/pdf",
    });
  } finally {
    canvas.width = canvas.height = 1;
  }
}
