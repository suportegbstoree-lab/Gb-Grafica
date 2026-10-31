import type { StaffPermission } from './staffAccess';

export type PanelSection = 'products' | 'categories' | 'orders' | 'promotions' | 'branding' | 'fonts' | 'config' | 'staff';
const SECTION_PERMISSIONS: Record<PanelSection, readonly StaffPermission[]> = {
  products: ['products.manage', 'products.images', 'products.personalization'],
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
