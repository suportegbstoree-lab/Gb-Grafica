// Este módulo também é executado pela Function ESM da Vercel. A extensão .js
// é obrigatória em imports relativos após a transpiração de TypeScript.
import { sanitizeArtworkName } from './artwork.js';

export const PERSONALIZATION_MODEL_MIME_TYPE = 'image/webp';
export const MAX_PERSONALIZATION_MODEL_BYTES = 15 * 1024 * 1024;
export const MAX_PERSONALIZATION_MODEL_EDGE = 3200;
export const MAX_PERSONALIZATION_MODEL_PIXELS = 10_000_000;

const COMPOSABLE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export interface PersonalizationModelDimensions {
  width: number;
  height: number;
}

export function isComposablePersonalizationImage(contentType: unknown, size: unknown): boolean {
  return typeof contentType === 'string' &&
    COMPOSABLE_IMAGE_TYPES.has(contentType) &&
    typeof size === 'number' &&
    Number.isFinite(size) &&
    size > 0 &&
    size <= MAX_PERSONALIZATION_MODEL_BYTES;
}

export function personalizationModelDimensions(width: number, height: number): PersonalizationModelDimensions | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  const normalizedWidth = Math.max(1, Math.round(width));
  const normalizedHeight = Math.max(1, Math.round(height));
  const edgeScale = Math.min(1, MAX_PERSONALIZATION_MODEL_EDGE / Math.max(normalizedWidth, normalizedHeight));
  const pixelScale = Math.min(1, Math.sqrt(MAX_PERSONALIZATION_MODEL_PIXELS / (normalizedWidth * normalizedHeight)));
  const scale = Math.min(edgeScale, pixelScale);

  return {
    width: Math.max(1, Math.round(normalizedWidth * scale)),
    height: Math.max(1, Math.round(normalizedHeight * scale)),
  };
}

export function personalizationTextScale(text: string): number {
  const length = text.trim().length;
  if (length > 120) return 0.038;
  if (length > 80) return 0.044;
  if (length > 40) return 0.052;
  if (length > 20) return 0.06;
  return 0.072;
}

export function personalizationModelName(productName: string, sourceName?: string): string {
  const sourceBase = sourceName?.replace(/\.[^.]+$/, '') || productName || 'personalizacao';
  const normalized = sanitizeArtworkName(sourceBase)
    .replace(/\.[^.]+$/, '')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9À-ÿ_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90) || 'personalizacao';
  return `${normalized}-modelo.webp`;
}
