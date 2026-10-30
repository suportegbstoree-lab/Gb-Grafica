import {
  catalogImageExtension,
  isAllowedCatalogImage,
  matchesCatalogImageSignature,
  sanitizeCatalogImageName,
} from './catalogImage.js';

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

export type AdminFontFormat = 'woff2' | 'ttf' | 'otf';
const FONT_MIME = { woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' } as const;

export function adminFontFormat(contentType: string): AdminFontFormat | null {
  return (Object.keys(FONT_MIME) as AdminFontFormat[]).find(format => FONT_MIME[format] === contentType) || null;
}

export function adminFontUploadType(name: string, mime: string): string | null {
  const format = /\.(woff2|ttf|otf)$/i.exec(name)?.[1].toLowerCase() as AdminFontFormat | undefined;
  if (!format) return null;
  const aliases = { woff2: ['application/font-woff2'], ttf: ['application/x-font-ttf', 'application/x-font-truetype', 'application/font-sfnt'], otf: ['application/x-font-otf', 'application/x-font-opentype', 'application/font-sfnt'] };
  return ['', 'application/octet-stream', FONT_MIME[format], ...aliases[format]].includes(mime) ? FONT_MIME[format] : null;
}

export function adminFontPath(fontId: string, uploadId: string, contentType = 'font/woff2'): string | null {
  if (!isSafeAdminAssetId(fontId) || !/^[a-f0-9]{32}$/.test(uploadId)) return null;
  const format = adminFontFormat(contentType);
  return format ? `catalog/fonts/${fontId}/${uploadId}.${format}` : null;
}

export function isAdminFontPath(value: string): boolean {
  return /^catalog\/fonts\/[A-Za-z0-9_-]{1,100}\/[a-f0-9]{32}\.(woff2|ttf|otf)$/.test(value);
}

export function isAllowedAdminFont(contentType: string, size: number): boolean {
  return (adminFontFormat(contentType) !== null || contentType === 'application/font-woff2') &&
    Number.isFinite(size) && size > 0 && size <= MAX_ADMIN_FONT_BYTES;
}

export function matchesWoff2Signature(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && String.fromCharCode(...bytes.slice(0, 4)) === 'wOF2';
}

export function matchesAdminFontSignature(contentType: string, bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const tag = String.fromCharCode(...bytes.slice(0, 4));
  const trueType = tag === '\x00\x01\x00\x00' || tag === 'true';
  if (contentType === 'font/woff2') return matchesWoff2Signature(bytes);
  if (contentType === 'font/ttf') return trueType;
  return contentType === 'font/otf' && (tag === 'OTTO' || trueType);
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
