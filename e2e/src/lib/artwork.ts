export const MAX_ARTWORK_BYTES = 15 * 1024 * 1024;

export const ALLOWED_ARTWORK_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function artworkExtension(contentType: string): string | null {
  return EXTENSIONS[contentType] || null;
}

export function isAllowedArtwork(contentType: unknown, size: unknown): boolean {
  return typeof contentType === 'string' &&
    ALLOWED_ARTWORK_TYPES.has(contentType) &&
    typeof size === 'number' &&
    Number.isFinite(size) &&
    size > 0 &&
    size <= MAX_ARTWORK_BYTES;
}

export function matchesArtworkSignature(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === 'application/pdf') {
    return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';
  }
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

export function sanitizeArtworkName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '-')
    .trim()
    .slice(0, 120) || 'arte';
}

export function isPendingArtworkPath(value: unknown, userId: string): value is string {
  if (typeof value !== 'string' || !userId) return false;
  return new RegExp(`^artworks/${escapeRegExp(userId)}/pending/[a-f0-9]{32}\\.(pdf|jpg|png|webp)$`).test(value);
}

export function isOrderArtworkPath(value: unknown, userId: string, orderId: string): value is string {
  if (typeof value !== 'string' || !userId || !orderId) return false;
  return new RegExp(
    `^artworks/${escapeRegExp(userId)}/orders/${escapeRegExp(orderId)}/[A-Za-z0-9_-]{1,150}/[a-f0-9]{32}\\.(pdf|jpg|png|webp)$`,
  ).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
