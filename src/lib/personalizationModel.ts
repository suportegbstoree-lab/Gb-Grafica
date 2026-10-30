// Este módulo também é executado pela Function ESM da Vercel. A extensão .js
// é obrigatória em imports relativos após a transpiração de TypeScript.
import { sanitizeArtworkName } from './artwork.js';

export const PERSONALIZATION_MODEL_MIME_TYPE = 'image/png';
export const MAX_PERSONALIZATION_MODEL_BYTES = 15 * 1024 * 1024;
// Falhar explicitamente é preferível a reduzir a resolução sem avisar.
// O navegador ainda pode ter um limite menor de memória/canvas.
export const MAX_PERSONALIZATION_MODEL_EDGE = 32_767;
export const MAX_PERSONALIZATION_MODEL_PIXELS = 64_000_000;

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
  if (Math.max(normalizedWidth, normalizedHeight) > MAX_PERSONALIZATION_MODEL_EDGE ||
      normalizedWidth * normalizedHeight > MAX_PERSONALIZATION_MODEL_PIXELS) return null;
  return { width: normalizedWidth, height: normalizedHeight };
}

export function personalizationTextScale(text: string): number {
  const length = text.trim().length;
  if (length > 120) return 0.038;
  if (length > 80) return 0.044;
  if (length > 40) return 0.052;
  if (length > 20) return 0.06;
  return 0.072;
}

export function personalizationModelName(productName: string, sourceName?: string, back = false): string {
  const sourceBase = sourceName?.replace(/\.[^.]+$/, '') || productName || 'personalizacao';
  const normalized = sanitizeArtworkName(sourceBase)
    .replace(/\.[^.]+$/, '')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9À-ÿ_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90) || 'personalizacao';
  return `${normalized}-${back ? 'contracapa' : 'modelo'}.png`;
}
