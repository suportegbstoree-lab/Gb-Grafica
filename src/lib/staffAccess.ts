export const STAFF_ACCESS_COLLECTION = '_staffAccess';
export const STAFF_ROLES_COLLECTION = '_staffRoles';
export const STAFF_EPOCH_CLAIM = 'gbStaffEpoch';
export const STAFF_ROLE_CLAIM = 'staffRole';

export const STAFF_PERMISSIONS = [
  { id: 'products.manage', label: 'Criar, editar e excluir produtos' },
  { id: 'products.images', label: 'Alterar imagens dos produtos' },
  { id: 'products.personalization', label: 'Alterar opções de personalização dos produtos' },
  { id: 'categories.manage', label: 'Gerenciar categorias' },
  { id: 'promotions.manage', label: 'Gerenciar promoções' },
  { id: 'branding.manage', label: 'Gerenciar identidade visual e banners' },
  { id: 'fonts.manage', label: 'Gerenciar fontes da personalização' },
  { id: 'settings.manage', label: 'Gerenciar atendimento e configurações comerciais' },
  { id: 'orders.read', label: 'Consultar pedidos e fichas de produção' },
  { id: 'orders.artwork', label: 'Consultar e baixar artes dos pedidos' },
  { id: 'orders.fulfillment', label: 'Alterar etapas de produção e envio' },
  { id: 'ai.generate', label: 'Usar IA para textos dos produtos' },
] as const;
export type StaffPermission = typeof STAFF_PERMISSIONS[number]['id'];
export type StaffRoleId = 'designer' | 'product-manager';
export type AssignedRole = StaffRoleId | 'administrator' | 'none';
export const ALL_STAFF_PERMISSIONS: StaffPermission[] = STAFF_PERMISSIONS.map(permission => permission.id);
export const STAFF_ROLE_LABELS: Record<AssignedRole, string> = {
  designer: 'Designer', 'product-manager': 'Gestor de Produtos', administrator: 'Administrador', none: 'Sem acesso ao painel',
};
export const DEFAULT_ROLE_PERMISSIONS: Record<StaffRoleId, StaffPermission[]> = {
  designer: ['products.images', 'products.personalization', 'branding.manage', 'fonts.manage', 'orders.read', 'orders.artwork'],
  'product-manager': ['products.manage', 'categories.manage', 'promotions.manage', 'ai.generate'],
};

export interface StaffAccessRecord {
  schemaVersion: 1; enabled: boolean; epoch: string; roleId: StaffRoleId;
  updatedAt: string; updatedBy: string;
}
export interface StaffRoleRecord {
  schemaVersion: 1; enabled: boolean; revision: string; permissions: StaffPermission[];
  updatedAt: string; updatedBy: string;
}
export interface StaffRoleView extends StaffRoleRecord { id: StaffRoleId; configured: boolean; }
export interface StaffMember { uid: string; email: string; role: AssignedRole; enabled: boolean; }
export interface StaffOverview { notifications?: Array<{ id: string; email: string; createdAt: string }>; roles: StaffRoleView[]; members: StaffMember[]; emailConfigured: boolean; truncated: boolean; }

export function isStaffRoleId(value: unknown): value is StaffRoleId { return value === 'designer' || value === 'product-manager'; }
export function parseStaffPermissions(value: unknown): StaffPermission[] | null {
  if (!Array.isArray(value) || value.length > ALL_STAFF_PERMISSIONS.length || new Set(value).size !== value.length ||
      value.some(entry => !ALL_STAFF_PERMISSIONS.includes(entry as StaffPermission))) return null;
  if ((value.includes('orders.artwork') || value.includes('orders.fulfillment')) && !value.includes('orders.read')) return null;
  return ALL_STAFF_PERMISSIONS.filter(permission => value.includes(permission));
}
export function validStaffAccess(value: unknown): value is StaffAccessRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && typeof record.enabled === 'boolean' && isStaffRoleId(record.roleId) &&
    typeof record.epoch === 'string' && /^[a-f0-9]{32}$/.test(record.epoch);
}
export function validStaffRole(value: unknown): value is StaffRoleRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && typeof record.enabled === 'boolean' && typeof record.revision === 'string' &&
    /^[a-f0-9]{32}$/.test(record.revision) && parseStaffPermissions(record.permissions) !== null;
}
export function staffRecordMatches(value: unknown, claims: Record<string, unknown>): value is StaffAccessRecord {
  return claims.admin !== true && validStaffAccess(value) && value.enabled && value.epoch === claims[STAFF_EPOCH_CLAIM] && value.roleId === claims[STAFF_ROLE_CLAIM];
}
export function staffPermissions(value: unknown, policy: unknown, claims: Record<string, unknown>): StaffPermission[] {
  return staffRecordMatches(value, claims) && validStaffRole(policy) && policy.enabled ? policy.permissions : [];
}
export function hasStaffPermission(permissions: readonly StaffPermission[], permission: StaffPermission): boolean { return permissions.includes(permission); }
export function canEditProductImages(permissions: readonly StaffPermission[]): boolean { return permissions.includes('products.manage') || permissions.includes('products.images'); }
export function canEditProductPersonalization(permissions: readonly StaffPermission[]): boolean { return permissions.includes('products.manage') || permissions.includes('products.personalization'); }

export const PRODUCT_IMAGE_FIELDS = ['imagem', 'imagens'] as const;
export const PRODUCT_PERSONALIZATION_FIELDS = ['tipoInput', 'labelTexto', 'printProfile'] as const;
export const BRANDING_FIELDS = ['logo_url', 'banner_principal', 'banner_titulo', 'banner_subtitulo', 'banner_botao'] as const;
export const FONTS_FIELDS = ['fontes_personalizacao'] as const;
export const SETTINGS_FIELDS = ['contatos', 'beneficios', 'telefone1', 'telefone2', 'beneficio1_titulo', 'beneficio1_desc', 'beneficio2_titulo', 'beneficio2_desc', 'beneficio3_titulo', 'beneficio3_desc', 'razao_social', 'documento_fiscal', 'endereco_comercial', 'email_atendimento', 'email_privacidade', 'prazo_producao'] as const;

export function permittedProductPatch(product: Record<string, unknown>, permissions: readonly StaffPermission[]): Record<string, unknown> {
  const fields = [...(canEditProductImages(permissions) ? PRODUCT_IMAGE_FIELDS : []), ...(canEditProductPersonalization(permissions) ? PRODUCT_PERSONALIZATION_FIELDS : [])];
  return Object.fromEntries(fields.filter(key => Object.hasOwn(product, key)).map(key => [key, product[key]]));
}
