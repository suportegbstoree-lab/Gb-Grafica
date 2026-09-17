export const MAX_CUSTOM_TEXT_LENGTH = 200;

export const TEXT_FONT_OPTIONS = [
  { id: 'arial', label: 'Arial', cssFamily: 'Arial, Helvetica, sans-serif' },
  { id: 'georgia', label: 'Georgia', cssFamily: 'Georgia, Times, serif' },
  { id: 'times', label: 'Times New Roman', cssFamily: '"Times New Roman", Times, serif' },
  { id: 'trebuchet', label: 'Trebuchet', cssFamily: '"Trebuchet MS", Arial, sans-serif' },
  { id: 'courier', label: 'Courier New', cssFamily: '"Courier New", Courier, monospace' },
] as const;

export type TextFontId = typeof TEXT_FONT_OPTIONS[number]['id'];
export type ProductCustomizationType = 'arte' | 'texto' | 'texto_arte' | 'nenhum';

export interface TextCustomization {
  texto: string;
  fonte: TextFontId;
  posicao: {
    x: number;
    y: number;
  };
}

export const DEFAULT_TEXT_CUSTOMIZATION: TextCustomization = {
  texto: '',
  fonte: 'arial',
  posicao: { x: 50, y: 50 },
};

const FONT_IDS = new Set<string>(TEXT_FONT_OPTIONS.map(option => option.id));
const PRODUCT_CUSTOMIZATION_TYPES = new Set<string>(['arte', 'texto', 'texto_arte', 'nenhum']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedCoordinate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value * 10) / 10;
}

export function isProductCustomizationType(value: unknown): value is ProductCustomizationType {
  return typeof value === 'string' && PRODUCT_CUSTOMIZATION_TYPES.has(value);
}

export function productRequiresArtwork(value: unknown): boolean {
  return value === 'arte' || value === 'texto_arte';
}

export function productRequiresText(value: unknown): boolean {
  return value === 'texto' || value === 'texto_arte';
}

export function normalizeTextCustomization(value: unknown): TextCustomization | null {
  if (!isRecord(value) || !isRecord(value.posicao)) return null;
  const texto = typeof value.texto === 'string'
    ? value.texto.trim().replace(/\s+/g, ' ')
    : '';
  const fonte = typeof value.fonte === 'string' && FONT_IDS.has(value.fonte)
    ? value.fonte as TextFontId
    : null;
  const x = normalizedCoordinate(value.posicao.x);
  const y = normalizedCoordinate(value.posicao.y);

  if (!texto || texto.length > MAX_CUSTOM_TEXT_LENGTH || !fonte || x === null || y === null) return null;
  return { texto, fonte, posicao: { x, y } };
}

export function legacyTextCustomization(value: unknown): TextCustomization | null {
  if (typeof value !== 'string') return null;
  return normalizeTextCustomization({
    ...DEFAULT_TEXT_CUSTOMIZATION,
    texto: value,
  });
}

export function textCustomizationFingerprint(value: TextCustomization): string {
  return `${value.texto}|${value.fonte}|${value.posicao.x.toFixed(1)}|${value.posicao.y.toFixed(1)}`;
}

export function textFontLabel(value: TextFontId): string {
  return TEXT_FONT_OPTIONS.find(option => option.id === value)?.label || value;
}

export function textFontCssFamily(value: TextFontId): string {
  return TEXT_FONT_OPTIONS.find(option => option.id === value)?.cssFamily || TEXT_FONT_OPTIONS[0].cssFamily;
}
