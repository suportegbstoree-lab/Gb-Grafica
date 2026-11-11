import { STAFF_PDF_DPI, staffPdfOutputName } from "./staffPdf.js";

export const STAFF_BARCODE_WIDTH = 650;
export const STAFF_BARCODE_BASE_LENGTH = 15;
export const STAFF_BARCODE_HORIZONTAL_SCALE = 1.8;
export const STAFF_BARCODE_MAX_WIDTH = Math.floor(
  STAFF_BARCODE_WIDTH * STAFF_BARCODE_HORIZONTAL_SCALE,
);
export const STAFF_BARCODE_HEIGHT = 222;
export const STAFF_BARCODE_MARGIN = 210;
export const STAFF_BATCH_TTL_MS = 3 * 86400000;
export const STAFF_BARCODE_QUIET_ZONE_RATIO = 0.06;
export const STAFF_BARCODE_QUIET_ZONE_MIN_PX = 8;
export const STAFF_BARCODE_VERSION = 3;

export type StaffBarcodeVersion = 1 | 2 | typeof STAFF_BARCODE_VERSION;
export interface StaffBarcodeSize {
  widthMm: number;
  heightMm: number;
  horizontalScale: number;
}
export const DEFAULT_STAFF_BARCODE_SIZE: Readonly<StaffBarcodeSize> = {
  widthMm: 45,
  heightMm: 18,
  horizontalScale: STAFF_BARCODE_HORIZONTAL_SCALE,
};

export function isStaffBarcodeVersion(
  value: unknown,
): value is StaffBarcodeVersion {
  return value === 1 || value === 2 || value === STAFF_BARCODE_VERSION;
}

export function normalizeStaffBarcodeSize(value: unknown): StaffBarcodeSize {
  const { widthMm, heightMm, horizontalScale } = (value ??
    {}) as StaffBarcodeSize;
  if (
    !Number.isFinite(widthMm) ||
    widthMm <= 0 ||
    widthMm > 100 ||
    !Number.isFinite(heightMm) ||
    heightMm < 2 ||
    heightMm > 100 ||
    !Number.isFinite(horizontalScale) ||
    horizontalScale <= 0 ||
    horizontalScale > 10
  )
    throw new Error(
      "Informe uma largura de até 100 mm, altura de 2 a 100 mm e escala horizontal maior que zero e de até 10×.",
    );
  return { widthMm, heightMm, horizontalScale };
}

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

export function staffBarcodeImageWidth(
  value: string,
  version: StaffBarcodeVersion = STAFF_BARCODE_VERSION,
) {
  if (version === 1) return 412;
  const length = normalizeStaffBarcode(value).length;
  return Math.floor(
    STAFF_BARCODE_WIDTH * Math.max(1, length / STAFF_BARCODE_BASE_LENGTH),
  );
}

export function staffBarcodeSizePixels(
  value: string,
  size: StaffBarcodeSize = DEFAULT_STAFF_BARCODE_SIZE,
) {
  const { widthMm, heightMm, horizontalScale } =
    normalizeStaffBarcodeSize(size);
  const pixelsPerMm = STAFF_PDF_DPI / 25.4;
  const lengthScale = Math.max(
    1,
    normalizeStaffBarcode(value).length / STAFF_BARCODE_BASE_LENGTH,
  );
  // The reference in millimeters already includes the default 1.8× stretch.
  const placedWidth = Math.min(
    STAFF_BARCODE_MAX_WIDTH,
    (widthMm * pixelsPerMm * lengthScale * horizontalScale) /
      STAFF_BARCODE_HORIZONTAL_SCALE,
  );
  const height = heightMm * pixelsPerMm;
  const quietZone = Math.max(
    STAFF_BARCODE_QUIET_ZONE_MIN_PX,
    Math.round(
      (height * STAFF_BARCODE_QUIET_ZONE_RATIO) /
        (1 + 2 * STAFF_BARCODE_QUIET_ZONE_RATIO),
    ),
  );
  if (placedWidth <= quietZone * 2)
    throw new Error(
      "Aumente a largura do código para acomodar as barras e as margens.",
    );
  return { placedWidth, height, quietZone };
}

export function automaticStaffBarcode(requestId: string) {
  return "GB" + requestId.replaceAll("-", "").slice(0, 16).toUpperCase();
}

export function staffBarcodeBoxes(
  width: number,
  height: number,
  value = "BR0000000000000",
  version: StaffBarcodeVersion = STAFF_BARCODE_VERSION,
  size?: StaffBarcodeSize,
) {
  const available = width - (2 * 3 * 72) / 25.4;
  const dimensions =
    version === STAFF_BARCODE_VERSION
      ? staffBarcodeSizePixels(value, size)
      : undefined;
  const requested =
    dimensions?.placedWidth ??
    (version === 1
      ? 412
      : Math.min(
          STAFF_BARCODE_MAX_WIDTH,
          staffBarcodeImageWidth(value) * STAFF_BARCODE_HORIZONTAL_SCALE,
        ));
  const w = Math.min((requested * 72) / STAFF_PDF_DPI, available);
  const h = ((dimensions?.height ?? STAFF_BARCODE_HEIGHT) * 72) / STAFF_PDF_DPI;
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
