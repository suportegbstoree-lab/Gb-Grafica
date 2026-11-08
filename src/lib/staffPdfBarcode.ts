import { STAFF_PDF_DPI, staffPdfOutputName } from "./staffPdf.js";

export const STAFF_BARCODE_WIDTH = 650;
export const STAFF_BARCODE_BASE_LENGTH = 15;
export const STAFF_BARCODE_HORIZONTAL_SCALE = 1.8;
export const STAFF_BARCODE_MAX_WIDTH = 1170;
export const STAFF_BARCODE_HEIGHT = 222;
export const STAFF_BARCODE_MARGIN = 210;
export const STAFF_BATCH_TTL_MS = 3 * 86400000;

export function staffTrackingBarcode(value: string) {
  return /^[\x20-\x7e]{1,80}$/.test(value.trim()) && Boolean(value.trim());
}

export function normalizeStaffBarcode(value: unknown): string {
  if (typeof value !== "string" || !staffTrackingBarcode(value))
    throw new Error(
      "Informe um código de 1 a 80 caracteres, sem acentos nem caracteres de controle.",
    );
  return value.trim();
}

export function staffBarcodeImageWidth(value: string, version: 1 | 2 = 2) {
  if (version === 1) return 412;
  const length = normalizeStaffBarcode(value).length;
  return Math.floor(
    STAFF_BARCODE_WIDTH * Math.max(1, length / STAFF_BARCODE_BASE_LENGTH),
  );
}

export function automaticStaffBarcode(requestId: string) {
  return "GB" + requestId.replaceAll("-", "").slice(0, 16).toUpperCase();
}

export function staffBarcodeBoxes(
  width: number,
  height: number,
  value = "BR0000000000000",
  version: 1 | 2 = 2,
) {
  const available = width - (2 * 3 * 72) / 25.4;
  const requested =
    version === 1
      ? 412
      : Math.min(
          STAFF_BARCODE_MAX_WIDTH,
          staffBarcodeImageWidth(value) * STAFF_BARCODE_HORIZONTAL_SCALE,
        );
  const w = Math.min((requested * 72) / STAFF_PDF_DPI, available);
  const h = (STAFF_BARCODE_HEIGHT * 72) / STAFF_PDF_DPI;
  const margin = (STAFF_BARCODE_MARGIN * 72) / STAFF_PDF_DPI;
  if (w < 20 || height < h * 2 + margin * 2)
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
  const suffix = staffPdfOutputName(normalizeStaffBarcode(barcode)) || "codigo";
  const prefix = staffPdfOutputName(
    `${variation.replace(/\.pdf$/i, "").replace(/_template(?:__?\d+p)?$/i, "")} ${text.replace(/\s+/g, " ")}`,
  );
  const room = 120 - suffix.length - 1;
  return `${prefix.slice(0, room).trim()} ${suffix}`.trim();
}
