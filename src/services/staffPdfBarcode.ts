import {
  STAFF_BARCODE_HEIGHT,
  STAFF_BARCODE_HORIZONTAL_SCALE,
  STAFF_BARCODE_MAX_WIDTH,
  STAFF_BARCODE_VERSION,
  staffBarcodeSizePixels,
  staffBarcodeImageWidth,
  normalizeStaffBarcode,
  staffBarcodeBoxes,
  type StaffBarcodeSize,
  type StaffBarcodeVersion,
} from "../lib/staffPdfBarcode";
import { STAFF_PDF_DPI } from "../lib/staffPdf";

export async function staffBarcodeCanvas(
  value: string,
  version: StaffBarcodeVersion = STAFF_BARCODE_VERSION,
  size?: StaffBarcodeSize,
) {
  const text = normalizeStaffBarcode(value);
  const dimensions =
    version === STAFF_BARCODE_VERSION
      ? staffBarcodeSizePixels(text, size)
      : undefined;
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
    target.width = Math.max(
      staffBarcodeImageWidth(text, version),
      Math.ceil(dimensions?.placedWidth ?? 0),
    );
    target.height = Math.round(dimensions?.height ?? STAFF_BARCODE_HEIGHT);
    const ctx = target.getContext("2d");
    if (!ctx) throw new Error("Não foi possível desenhar o código de barras.");
    ctx.imageSmoothingEnabled = false;
    const pad =
      dimensions?.quietZone ??
      (version === 1
        ? 0
        : Math.max(8, Math.round(STAFF_BARCODE_HEIGHT * 0.06)));
    const placedWidth =
      dimensions?.placedWidth ??
      Math.min(
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
  version: StaffBarcodeVersion = STAFF_BARCODE_VERSION,
  size?: StaffBarcodeSize,
) {
  const boxes = staffBarcodeBoxes(
    (ctx.canvas.width * 72) / STAFF_PDF_DPI,
    (ctx.canvas.height * 72) / STAFF_PDF_DPI,
    value,
    version,
    size,
  );
  ctx.save();
  try {
    if (version === STAFF_BARCODE_VERSION) ctx.imageSmoothingEnabled = false;
    for (const box of boxes)
      ctx.drawImage(
        image,
        (box.x * STAFF_PDF_DPI) / 72,
        ctx.canvas.height - ((box.y + box.height) * STAFF_PDF_DPI) / 72,
        (box.width * STAFF_PDF_DPI) / 72,
        (box.height * STAFF_PDF_DPI) / 72,
      );
  } finally {
    ctx.restore();
  }
}

export async function stampStaffBarcode(
  original: Blob,
  value: string,
  version: StaffBarcodeVersion = STAFF_BARCODE_VERSION,
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
