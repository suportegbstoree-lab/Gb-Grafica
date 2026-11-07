import { STAFF_PDF_DPI, staffPdfOutputName } from "./staffPdf.js";

export const STAFF_BARCODE_WIDTH = 412;
export const STAFF_BARCODE_HEIGHT = 222;
export const STAFF_BARCODE_MARGIN = 210;
export const STAFF_BATCH_TTL_MS = 3 * 86400000;

export function staffTrackingBarcode(value: string) {
  return /^BR(?:\d{12}[A-Z]|\d{13})$/.test(value);
}

export function normalizeStaffBarcode(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Informe um código de barras.");
  const code = value.trim().toUpperCase();
  if (!staffTrackingBarcode(code) && !/^GB[A-F0-9]{16}$/.test(code))
    throw new Error(
      "Use BR com 12 dígitos e uma letra, BR com 13 dígitos ou o código interno gerado.",
    );
  return code;
}

export function automaticStaffBarcode(requestId: string) {
  return "GB" + requestId.replaceAll("-", "").slice(0, 16).toUpperCase();
}

export function staffBarcodeBoxes(width: number, height: number) {
  const w = (STAFF_BARCODE_WIDTH * 72) / STAFF_PDF_DPI;
  const h = (STAFF_BARCODE_HEIGHT * 72) / STAFF_PDF_DPI;
  const margin = (STAFF_BARCODE_MARGIN * 72) / STAFF_PDF_DPI;
  if (width < w || height < h * 2 + margin * 2)
    throw new Error(
      "A página é pequena para posicionar o código de barras sem sobreposição.",
    );
  const x = (width - w) / 2;
  return [
    { x, y: height - margin - h, width: w, height: h },
    { x, y: margin, width: w, height: h },
  ];
}

export function staffPdfDefaultFilename(
  variation: string,
  text: string,
  barcode: string,
) {
  const suffix = normalizeStaffBarcode(barcode);
  const prefix = staffPdfOutputName(
    `${variation.replace(/\.pdf$/i, "").replace(/_template(?:__?\d+p)?$/i, "")} ${text.replace(/\s+/g, " ")}`,
  );
  const room = 120 - suffix.length - 1;
  return `${prefix.slice(0, room).trim()} ${suffix}`.trim();
}
