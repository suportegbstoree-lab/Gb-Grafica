import type { StaffPdfJob } from "./staffPdf.js";
import type { StaffBarcodeVersion } from "./staffPdfBarcode.js";

export const STAFF_PDF_BATCH_MAX_ITEMS = 50;
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
  create(requestId: string): Promise<StaffPdfBatchView>;
  items(batchId: string): Promise<{ items: StaffPdfBatchItemView[] }>;
  save(
    batchId: string,
    job: StaffPdfBatchJob,
    requestId: string,
  ): Promise<StaffPdfRecipe>;
  recipe(batchId: string, itemId: string): Promise<StaffPdfRecipe>;
  complete(batchId: string, itemId: string): Promise<void>;
}
