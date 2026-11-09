import type { StaffPermission } from './staffAccess';

export type PanelSection = 'products' | 'categories' | 'orders' | 'promotions' | 'branding' | 'fonts' | 'config' | 'staff' | 'operations' | 'email' | 'bundles' | 'documents' | 'variation-types' | 'coupons';
const SECTION_PERMISSIONS: Record<PanelSection, readonly StaffPermission[]> = {
  operations: ['operations.manage','operations.self'],
  documents:['documents.generate','documents.templates.manage'],
  email: ['emails.manage'],
  bundles: ['bundles.manage'],
  products: ['products.manage', 'products.images', 'products.personalization'],
  'variation-types': ['products.manage'], coupons: ['promotions.manage'],
  categories: ['categories.manage'], orders: ['orders.read'], promotions: ['promotions.manage'],
  branding: ['branding.manage'], fonts: ['fonts.manage'], config: ['settings.manage'], staff: [],
};

/** A role name never substitutes for its live policy. Staff management is root-admin only. */
export function allowedPanelSections(fullAdmin: boolean, permissions: readonly StaffPermission[]): PanelSection[] {
  return (Object.keys(SECTION_PERMISSIONS) as PanelSection[]).filter(section => fullAdmin ||
    SECTION_PERMISSIONS[section].some(permission => permissions.includes(permission)));
}
export function mayEnterPanel(fullAdmin: boolean, permissions: readonly StaffPermission[]): boolean {
  return allowedPanelSections(fullAdmin, permissions).length > 0;
}
