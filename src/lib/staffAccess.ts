export const STAFF_ACCESS_COLLECTION = '_staffAccess';
export const STAFF_ROLES_COLLECTION = '_staffRoles';
export const STAFF_EPOCH_CLAIM = 'gbStaffEpoch';
export const STAFF_ROLE_CLAIM = 'staffRole';

export const STAFF_PERMISSIONS = [
  { id:'documents.templates.manage',label:'Cadastrar PDFs internos e criar, editar e excluir moldes JSON' },
  { id:'documents.generate',label:'Gerar, baixar e compartilhar PDFs internos' },
  { id:'operations.self',label:'Consultar meu expediente e minha produtividade' },
  { id: 'bundles.manage', label: 'Criar, editar e excluir pacotes de produtos' },
  { id: 'emails.manage', label: 'Gerenciar campanhas e fila de e-mails' },
  { id: 'operations.manage', label: 'Consultar minha produção e relatórios operacionais' },
  { id: 'products.manage', label: 'Criar, editar e excluir produtos' },
  { id: 'products.images', label: 'Alterar imagens dos produtos' },
  { id: 'products.personalization', label: 'Alterar opções de personalização dos produtos' },
  { id: 'categories.manage', label: 'Gerenciar categorias' },
  { id: 'promotions.manage', label: 'Gerenciar promoções' },
  { id: 'coupons.manage', label: 'Criar, editar e excluir cupons da loja e de frete' },
  { id: 'branding.manage', label: 'Gerenciar identidade visual e banners' },
  { id: 'fonts.manage', label: 'Gerenciar fontes da personalização' },
  { id: 'settings.manage', label: 'Gerenciar atendimento e configurações comerciais' },
  { id: 'orders.read', label: 'Consultar pedidos e fichas de produção' },
  { id: 'orders.artwork', label: 'Consultar e baixar artes dos pedidos' },
  { id: 'orders.fulfillment', label: 'Alterar etapas de produção e envio' },
  { id: 'shipments.read', label: 'Consultar etiquetas de postagem' },
  { id: 'shipments.manage', label: 'Comprar, emitir, imprimir e cancelar etiquetas de postagem' },
  { id: 'ai.generate', label: 'Usar IA para textos dos produtos' },
] as const;
export type StaffPermission = typeof STAFF_PERMISSIONS[number]['id'];
export type StaffRoleId = string;
export type AssignedRole = StaffRoleId | 'administrator' | 'none';
export const ALL_STAFF_PERMISSIONS: StaffPermission[] = STAFF_PERMISSIONS.map(permission => permission.id);
export const STAFF_ROLE_LABELS: Record<AssignedRole, string> = {
  designer: 'Designer', 'product-manager': 'Gestor de Produtos', administrator: 'Administrador', none: 'Sem acesso ao painel',
};
export const DEFAULT_ROLE_PERMISSIONS: Record<StaffRoleId, StaffPermission[]> = {
  designer: ['products.images', 'products.personalization', 'branding.manage', 'fonts.manage', 'orders.read', 'orders.artwork'],
  'product-manager': ['products.manage', 'categories.manage', 'promotions.manage', 'coupons.manage', 'ai.generate'],
};

export interface StaffAccessRecord {
  schemaVersion: 1; enabled: boolean; epoch: string; roleId: StaffRoleId;
  updatedAt: string; updatedBy: string;
}
export interface StaffRoleRecord {
  deletionPending?: boolean; deleted?: boolean; deletedAt?: string;
  name?: string; schemaVersion: 1; enabled: boolean; revision: string; permissions: StaffPermission[];
  updatedAt: string; updatedBy: string;
}
export interface StaffRoleView extends StaffRoleRecord { id: StaffRoleId; configured: boolean; }
export interface StaffMember { uid: string; email: string; name?: string; role: AssignedRole; enabled: boolean; }
export interface StaffOverview { notifications?: Array<{ id: string; email: string; createdAt: string }>; roles: StaffRoleView[]; members: StaffMember[]; emailConfigured: boolean; truncated: boolean; }

export function isStaffRoleId(value: unknown): value is StaffRoleId { return typeof value === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(value) && !['admin', 'administrator', 'administrador', 'none', 'owner', 'root', 'constructor', 'prototype'].includes(value); }
export const STAFF_PERMISSION_DEPENDENCIES: Partial<Record<StaffPermission, StaffPermission[]>> = {
  'orders.artwork': ['orders.read'],
  'orders.fulfillment': ['orders.read'],
  'shipments.read': ['orders.read'],
  'shipments.manage': ['orders.read', 'shipments.read'],
};

export function parseStaffPermissions(value: unknown): StaffPermission[] | null {
  if (!Array.isArray(value) || value.length > ALL_STAFF_PERMISSIONS.length || new Set(value).size !== value.length ||
      value.some(entry => !ALL_STAFF_PERMISSIONS.includes(entry as StaffPermission))) return null;
  if (ALL_STAFF_PERMISSIONS.some(permission => value.includes(permission) &&
    STAFF_PERMISSION_DEPENDENCIES[permission]?.some(dependency => !value.includes(dependency)))) return null;
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
    /^[a-f0-9]{32}$/.test(record.revision) && parseStaffPermissions(record.permissions) !== null &&
    (record.deleted === undefined || typeof record.deleted === 'boolean') &&
    (record.deletionPending === undefined || typeof record.deletionPending === 'boolean') &&
    (!(record.deleted || record.deletionPending) || (record.enabled === false && (record.permissions as unknown[]).length === 0)) &&
    (record.name === undefined || (typeof record.name === 'string' && record.name.trim().length > 0 && record.name.length <= 80));
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

export const PRODUCT_IMAGE_FIELDS = ['imagem', 'imagens', 'imagensPorCombinacao', 'modelosPdf', 'imagemBase'] as const;
export const PRODUCT_PERSONALIZATION_FIELDS = ['tipoInput', 'labelTexto', 'printProfile', 'moldePdf'] as const;
export const BRANDING_FIELDS = ['logo_url', 'banner_principal', 'banner_titulo', 'banner_subtitulo', 'banner_botao'] as const;
export const FONTS_FIELDS = ['fontes_personalizacao'] as const;
export const SETTINGS_FIELDS = ['contatos', 'beneficios', 'telefone1', 'telefone2', 'beneficio1_titulo', 'beneficio1_desc', 'beneficio2_titulo', 'beneficio2_desc', 'beneficio3_titulo', 'beneficio3_desc', 'razao_social', 'documento_fiscal', 'endereco_comercial', 'email_atendimento', 'email_privacidade', 'prazo_producao'] as const;

export function permittedProductPatch(product: Record<string, unknown>, permissions: readonly StaffPermission[]): Record<string, unknown> {
  const fields = [...(canEditProductImages(permissions) ? PRODUCT_IMAGE_FIELDS : []), ...(canEditProductPersonalization(permissions) ? PRODUCT_PERSONALIZATION_FIELDS : [])];
  return Object.fromEntries(fields.filter(key => Object.hasOwn(product, key)).map(key => [key, product[key]]));
}

export function staffRoleName(id: string, role?: { name?: string }): string { return role?.name || (Object.hasOwn(STAFF_ROLE_LABELS, id) ? STAFF_ROLE_LABELS[id] : id); }
export function validStaffName(value: unknown): value is string { return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 120 && !/[\x00-\x1f\x7f]/.test(value); }
