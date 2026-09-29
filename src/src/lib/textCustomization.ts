export const MAX_CUSTOM_TEXT_LENGTH = 200;
export const MAX_PERSONALIZATION_FONTS = 20;

export type ProductCustomizationType = 'arte' | 'texto' | 'texto_arte' | 'nenhum';

export interface PersonalizationFont {
  id: string;
  nome: string;
  cssFamily: string;
  arquivoUrl?: string;
  ativo: boolean;
}

export interface TextCustomization {
  texto: string;
  fonte: string;
  fonteNome?: string;
  fonteCssFamily?: string;
  fonteArquivoUrl?: string;
  posicao: {
    x: number;
    y: number;
  };
}

export const DEFAULT_TEXT_CUSTOMIZATION: TextCustomization = {
  texto: '',
  fonte: '',
  posicao: { x: 50, y: 50 },
};

const PRODUCT_CUSTOMIZATION_TYPES = new Set<string>(['arte', 'texto', 'texto_arte', 'nenhum']);
const LEGACY_FONT: PersonalizationFont = {
  id: 'arial',
  nome: 'Arial',
  cssFamily: 'Arial, Helvetica, sans-serif',
  ativo: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedCoordinate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value * 10) / 10;
}

function normalizedFontId(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) ? value : '';
}

function normalizedFontName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
}

function normalizedCssFamily(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, 160);
  return normalized && !/[<>{};]/.test(normalized) ? normalized : '';
}

function normalizedFontUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const normalized = value.trim();
  if (normalized.startsWith('/') && !normalized.startsWith('//') && !normalized.includes('\\')) return normalized;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export function normalizePersonalizationFonts(value: unknown): PersonalizationFont[] {
  if (!Array.isArray(value)) return [];
  const normalized: PersonalizationFont[] = [];
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();

  for (const entry of value.slice(0, MAX_PERSONALIZATION_FONTS)) {
    if (!isRecord(entry)) continue;
    const id = normalizedFontId(entry.id);
    const nome = normalizedFontName(entry.nome);
    const cssFamily = normalizedCssFamily(entry.cssFamily);
    const arquivoUrl = normalizedFontUrl(entry.arquivoUrl);
    const nameKey = nome.toLocaleLowerCase('pt-BR');
    if (!id || !nome || !cssFamily || usedIds.has(id) || usedNames.has(nameKey)) continue;
    usedIds.add(id);
    usedNames.add(nameKey);
    normalized.push({
      id,
      nome,
      cssFamily,
      ...(arquivoUrl ? { arquivoUrl } : {}),
      ativo: entry.ativo !== false,
    });
  }
  return normalized;
}

export function activePersonalizationFonts(value: unknown): PersonalizationFont[] {
  return normalizePersonalizationFonts(value).filter(font => font.ativo);
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

export function normalizeTextCustomization(
  value: unknown,
  allowedFonts?: PersonalizationFont[],
): TextCustomization | null {
  if (!isRecord(value) || !isRecord(value.posicao)) return null;
  const texto = typeof value.texto === 'string'
    ? value.texto.trim().replace(/\s+/g, ' ')
    : '';
  const fonte = normalizedFontId(value.fonte);
  const configuredFont = allowedFonts?.find(font => font.ativo && font.id === fonte);
  const x = normalizedCoordinate(value.posicao.x);
  const y = normalizedCoordinate(value.posicao.y);

  if (
    !texto || texto.length > MAX_CUSTOM_TEXT_LENGTH || !fonte ||
    (allowedFonts && !configuredFont) || x === null || y === null
  ) return null;

  const fonteNome = configuredFont?.nome || normalizedFontName(value.fonteNome);
  const fonteCssFamily = configuredFont?.cssFamily || normalizedCssFamily(value.fonteCssFamily);
  const fonteArquivoUrl = configuredFont?.arquivoUrl || normalizedFontUrl(value.fonteArquivoUrl);
  return {
    texto,
    fonte,
    ...(fonteNome ? { fonteNome } : {}),
    ...(fonteCssFamily ? { fonteCssFamily } : {}),
    ...(fonteArquivoUrl ? { fonteArquivoUrl } : {}),
    posicao: { x, y },
  };
}

export function legacyTextCustomization(
  value: unknown,
  allowedFonts?: PersonalizationFont[],
): TextCustomization | null {
  if (typeof value !== 'string') return null;
  const fallbackFont = allowedFonts?.find(font => font.ativo) || LEGACY_FONT;
  return normalizeTextCustomization({
    ...DEFAULT_TEXT_CUSTOMIZATION,
    texto: value,
    fonte: fallbackFont.id,
    fonteNome: fallbackFont.nome,
    fonteCssFamily: fallbackFont.cssFamily,
    fonteArquivoUrl: fallbackFont.arquivoUrl,
  }, allowedFonts?.length ? allowedFonts : undefined);
}

export function textCustomizationFingerprint(value: TextCustomization): string {
  return `${value.texto}|${value.fonte}|${value.posicao.x.toFixed(1)}|${value.posicao.y.toFixed(1)}`;
}

export function textFontLabel(
  value: string,
  fonts: PersonalizationFont[] = [],
  snapshotName?: string,
): string {
  return snapshotName || fonts.find(option => option.id === value)?.nome || (value === LEGACY_FONT.id ? LEGACY_FONT.nome : value);
}

export function textFontCssFamily(
  value: string,
  fonts: PersonalizationFont[] = [],
  snapshotCssFamily?: string,
): string {
  return snapshotCssFamily || fonts.find(option => option.id === value)?.cssFamily || LEGACY_FONT.cssFamily;
}
