import type { StaffPdfJob } from "./staffPdf.js";
import type { StaffBarcodeVersion } from "./staffPdfBarcode.js";

export const STAFF_PDF_BATCH_MAX_ITEMS = 50;
export const STAFF_PDF_BATCH_NAME_MAX = 80;
export function staffPdfBatchName(value: unknown): string {
  if (typeof value !== "string" || value.length > STAFF_PDF_BATCH_NAME_MAX || /[\x00-\x1f\x7f]/.test(value))
    throw new Error("Informe um nome de lote com até 80 caracteres.");
  return value.trim().normalize("NFC");
}

import type { PrintProfile } from "./printProfile.js";
import type { TextCustomization } from "./textCustomization.js";
import type { PersonalizationFont } from "./textCustomization.js";
export interface StaffPdfSimpleJob {
  kind: "simple";
  productId: string;
  templateId: string;
  customization: TextCustomization;
  barcode: string;
  barcodeVersion?: StaffBarcodeVersion;
  outputName: string;
}
export type StaffPdfBatchJob = StaffPdfJob | StaffPdfSimpleJob;
export const isStaffPdfSimpleJob = (
  job: StaffPdfBatchJob,
): job is StaffPdfSimpleJob => "kind" in job && job.kind === "simple";

export interface StaffPdfBatchView {
  id: string;
  reference: string;
  name?: string;
  createdAt: string;
  expiresAt: string;
  ownerName: string;
  count: number;
}
export interface StaffPdfBatchItemView {
  id: string;
  outputName: string;
  barcode: string;
  status: "pending" | "ready";
}
export interface StaffPdfRecipe {
  item: StaffPdfBatchItemView;
  job: StaffPdfBatchJob;
  printProfile?: PrintProfile;
  fitMargin: number;
  originalUrl: string;
  fonts: PersonalizationFont[];
  initial?: { url: string; sizePercent: number };
  rendererVersion: 1;
}
export interface StaffPdfBatchApi {
  list(): Promise<{ batches: StaffPdfBatchView[] }>;
  rename(id: string, name: string): Promise<StaffPdfBatchView>;
  create(requestId: string, name?: string): Promise<StaffPdfBatchView>;
  items(batchId: string): Promise<{ items: StaffPdfBatchItemView[] }>;
  save(
    batchId: string,
    job: StaffPdfBatchJob,
    requestId: string,
  ): Promise<StaffPdfRecipe>;
  recipe(batchId: string, itemId: string): Promise<StaffPdfRecipe>;
  complete(batchId: string, itemId: string): Promise<void>;
}
