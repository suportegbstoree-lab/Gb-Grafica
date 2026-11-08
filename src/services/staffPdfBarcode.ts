import {
  STAFF_BARCODE_HEIGHT,
  STAFF_BARCODE_HORIZONTAL_SCALE,
  STAFF_BARCODE_MAX_WIDTH,
  staffBarcodeImageWidth,
  normalizeStaffBarcode,
  staffBarcodeBoxes,
} from "../lib/staffPdfBarcode";

export async function staffBarcodeCanvas(value: string, version: 1 | 2 = 2) {
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
      includetext: version === 1,
      textxalign: "center",
      textsize: 10,
      paddingwidth: version === 1 ? 10 : 0,
      paddingheight: 0,
    });
    target.width = staffBarcodeImageWidth(text, version);
    target.height = STAFF_BARCODE_HEIGHT;
    const ctx = target.getContext("2d");
    if (!ctx) throw new Error("Não foi possível desenhar o código de barras.");
    ctx.imageSmoothingEnabled = false;
    const pad =
      version === 1 ? 0 : Math.max(8, Math.round(STAFF_BARCODE_HEIGHT * 0.06));
    const placedWidth = Math.min(
      target.width * STAFF_BARCODE_HORIZONTAL_SCALE,
      STAFF_BARCODE_MAX_WIDTH,
    );
    const horizontalPad =
      version === 1
        ? 0
        : Math.max(8, Math.ceil((pad * target.width) / placedWidth));
    ctx.drawImage(
      source,
      horizontalPad,
      pad,
      target.width - 2 * horizontalPad,
      target.height - 2 * pad,
    );
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
  value: string,
  version: 1 | 2 = 2,
) {
  for (const box of staffBarcodeBoxes(
    (ctx.canvas.width * 72) / 300,
    (ctx.canvas.height * 72) / 300,
    value,
    version,
  ))
    ctx.drawImage(
      image,
      (box.x * 300) / 72,
      ctx.canvas.height - ((box.y + box.height) * 300) / 72,
      (box.width * 300) / 72,
      (box.height * 300) / 72,
    );
}

export async function stampStaffBarcode(
  original: Blob,
  value: string,
  version: 1 | 2 = 2,
) {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.load(await original.arrayBuffer(), {
    updateMetadata: false,
  });
  const canvas = await staffBarcodeCanvas(value, version);
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
      for (const box of staffBarcodeBoxes(
        page.getWidth(),
        page.getHeight(),
        value,
        version,
      ))
        page.drawImage(png, box);
    }
    return new Blob([new Uint8Array(await pdf.save())], {
      type: "application/pdf",
    });
  } finally {
    canvas.width = canvas.height = 1;
  }
}
