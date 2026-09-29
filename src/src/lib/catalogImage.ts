export const MAX_CATALOG_IMAGE_BYTES = 8 * 1024 * 1024;

const CATALOG_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isSafeCatalogProductId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

export function catalogImageExtension(contentType: string): string | null {
  return CATALOG_IMAGE_EXTENSIONS[contentType] || null;
}

export function isAllowedCatalogImage(contentType: string, size: number): boolean {
  return Boolean(catalogImageExtension(contentType)) && Number.isFinite(size) && size > 0 && size <= MAX_CATALOG_IMAGE_BYTES;
}

export function matchesCatalogImageSignature(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === 'image/png') {
    return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10]
      .every((value, index) => bytes[index] === value);
  }
  if (contentType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === 'image/webp') {
    return bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  return false;
}

export function sanitizeCatalogImageName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]+/g, '-')
    .trim()
    .slice(0, 120) || 'imagem';
}

export function isCatalogImagePath(value: string, productId?: string): boolean {
  if (productId && !isSafeCatalogProductId(productId)) return false;
  const productPattern = productId ? escapeRegExp(productId) : '[A-Za-z0-9_-]{1,100}';
  return new RegExp(`^catalog/products/${productPattern}/[a-f0-9]{32}\\.(jpg|png|webp)$`).test(value);
}

export function catalogImagePathFromUrl(
  value: string,
  storageBucket: string,
  productId?: string,
): string | null {
  if (!value || !storageBucket) return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'firebasestorage.googleapis.com') return null;

    const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!match) return null;

    const bucket = decodeURIComponent(match[1]);
    const objectPath = decodeURIComponent(match[2]);
    if (bucket !== storageBucket || !isCatalogImagePath(objectPath, productId)) return null;
    return objectPath;
  } catch {
    return null;
  }
}
