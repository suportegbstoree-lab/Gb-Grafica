import {
  catalogImageExtension,
  isAllowedCatalogImage,
  matchesCatalogImageSignature,
  sanitizeCatalogImageName,
} from './catalogImage';

export type AdminImageScope = 'categories' | 'site' | 'promotions';
export const MAX_ADMIN_FONT_BYTES = 3 * 1024 * 1024;

export function isSafeAdminAssetId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

export function adminImagePath(scope: AdminImageScope, ownerId: string, uploadId: string, contentType: string): string | null {
  if (!isSafeAdminAssetId(ownerId) || !/^[a-f0-9]{32}$/.test(uploadId)) return null;
  const extension = catalogImageExtension(contentType);
  return extension ? `catalog/${scope}/${ownerId}/${uploadId}.${extension}` : null;
}

export function isAdminImagePath(value: string): boolean {
  return /^catalog\/(categories|site|promotions)\/[A-Za-z0-9_-]{1,100}\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(value);
}

export function isAllowedAdminImage(contentType: string, size: number): boolean {
  return isAllowedCatalogImage(contentType, size);
}

export function matchesAdminImageSignature(contentType: string, bytes: Uint8Array): boolean {
  return matchesCatalogImageSignature(contentType, bytes);
}

export function adminFontPath(fontId: string, uploadId: string): string | null {
  if (!isSafeAdminAssetId(fontId) || !/^[a-f0-9]{32}$/.test(uploadId)) return null;
  return `catalog/fonts/${fontId}/${uploadId}.woff2`;
}

export function isAdminFontPath(value: string): boolean {
  return /^catalog\/fonts\/[A-Za-z0-9_-]{1,100}\/[a-f0-9]{32}\.woff2$/.test(value);
}

export function isAllowedAdminFont(contentType: string, size: number): boolean {
  return (contentType === 'font/woff2' || contentType === 'application/font-woff2') &&
    Number.isFinite(size) && size > 0 && size <= MAX_ADMIN_FONT_BYTES;
}

export function matchesWoff2Signature(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && String.fromCharCode(...bytes.slice(0, 4)) === 'wOF2';
}

export function sanitizeAdminAssetName(value: string): string {
  return sanitizeCatalogImageName(value);
}

export function adminAssetPathFromUrl(value: string, storageBucket: string): string | null {
  if (!value || !storageBucket) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'firebasestorage.googleapis.com') return null;
    const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!match || decodeURIComponent(match[1]) !== storageBucket) return null;
    const objectPath = decodeURIComponent(match[2]);
    return isAdminImagePath(objectPath) || isAdminFontPath(objectPath) ? objectPath : null;
  } catch {
    return null;
  }
}
