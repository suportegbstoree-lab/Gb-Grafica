export interface StaffPdfCompoundMarker {
  x: number;
  y: number;
  size: number;
  color: string;
  font: "courier" | "helvetica";
  angle: 0 | 90 | 180 | 270;
}

export const DEFAULT_STAFF_PDF_COMPOUND_MARKER: StaffPdfCompoundMarker = {
  x: 94.3, y: 49, size: 10, color: "#000000", font: "courier", angle: 90,
};

export function normalizeStaffPdfCompoundMarker(value: unknown): StaffPdfCompoundMarker {
  const marker = value as Partial<StaffPdfCompoundMarker> | undefined;
  const within = (number: unknown, min: number, max: number): number is number =>
    typeof number === "number" && Number.isFinite(number) && number >= min && number <= max;
  if (!marker || !within(marker.x, 0, 100) || !within(marker.y, 0, 100) ||
      !within(marker.size, 6, 36) || typeof marker.color !== "string" || !/^#[\da-f]{6}$/i.test(marker.color) ||
      (marker.font !== "courier" && marker.font !== "helvetica") ||
      ![0, 90, 180, 270].includes(marker.angle!)) {
    throw new Error("Confira a posição, o tamanho, a cor e a orientação do identificador.");
  }
  return { x: marker.x, y: marker.y, size: marker.size, color: marker.color.toLowerCase(), font: marker.font, angle: marker.angle! };
}

export function staffPdfRepeatedBarcodes(items: ReadonlyArray<{ job: { barcode?: string } }>) {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const { job } of items) {
    const code = job.barcode;
    if (!code) continue;
    if (seen.has(code)) repeated.add(code);
    seen.add(code);
  }
  return repeated;
}
