export const STAFF_PDF_MARKETPLACE_LABELS = {
  tiktok: "TikTok",
  shopee: "Shopee",
} as const;

export type StaffPdfMarketplace = keyof typeof STAFF_PDF_MARKETPLACE_LABELS;

export function isStaffPdfMarketplace(value: unknown): value is StaffPdfMarketplace {
  return value === "tiktok" || value === "shopee";
}

export function staffPdfMarketplace(value: string): StaffPdfMarketplace | undefined {
  const text = value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const tiktok = /(?:^|[^a-z0-9])tik[^a-z0-9]*tok(?:shop(?:br)?)?(?=$|[^a-z])/.test(text);
  const shopee = /(?:^|[^a-z0-9])shopee(?:br)?(?=$|[^a-z])/.test(text);
  if (tiktok === shopee) return undefined;
  return tiktok ? "tiktok" : "shopee";
}
