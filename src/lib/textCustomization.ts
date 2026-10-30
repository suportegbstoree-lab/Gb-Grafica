export const MAX_CUSTOM_TEXT_LENGTH = 200;
export const MAX_CUSTOM_TEXT_LINES = 8;
export const MIN_TEXT_SIZE = 1;
export const MAX_TEXT_SIZE = 20;
export const MAX_PERSONALIZATION_FONTS = 20;

export type ProductCustomizationType = 'arte' | 'texto' | 'texto_arte' | 'nenhum';

export interface PersonalizationFont {
  id: string;
  nome: string;
  cssFamily: string;
  arquivoUrl?: string;
  arquivoFormato?: 'woff2' | 'ttf' | 'otf';
  ativo: boolean;
}

export interface TextCustomization {
  texto: string;
  fonte: string;
  fonteNome?: string;
  fonteCssFamily?: string;
  fonteArquivoUrl?: string;
  /** Font size as a percentage of the source image width. Optional on old orders. */
  tamanhoFonte?: number;
  cor?: string;
  linhas?: TextCustomizationLine[];
  fonteCompartilhada?: boolean;
  corCompartilhada?: boolean;
  posicao: {
    x: number;
    y: number;
  };
}

export interface TextCustomizationLine {
  id: string;
  texto: string;
  fonte?: string;
  fonteNome?: string;
  fonteCssFamily?: string;
  fonteArquivoUrl?: string;
  tamanhoFonte?: number;
  cor?: string;
  posicao: { x: number; y: number };
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
      ...(['woff2', 'ttf', 'otf'].includes(String(entry.arquivoFormato)) ? { arquivoFormato: entry.arquivoFormato as PersonalizationFont['arquivoFormato'] } : {}),
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
  let texto = typeof value.texto === 'string'
    ? value.texto.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim().replace(/[^\S\n]+/g, ' ')).join('\n')
    : '';
  if (value.linhas === undefined) texto = texto.trim();
  const fonte = normalizedFontId(value.fonte);
  const configuredFont = allowedFonts?.find(font => font.ativo && font.id === fonte);
  const x = normalizedCoordinate(value.posicao.x);
  const y = normalizedCoordinate(value.posicao.y);

  if (
    !texto.trim() || texto.length > MAX_CUSTOM_TEXT_LENGTH || texto.split('\n').length > MAX_CUSTOM_TEXT_LINES || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(texto) || !fonte ||
    (value.cor !== undefined && (typeof value.cor !== 'string' || !/^#[a-f0-9]{6}$/i.test(value.cor))) ||
    (value.tamanhoFonte !== undefined && (typeof value.tamanhoFonte !== 'number' || !Number.isFinite(value.tamanhoFonte) || value.tamanhoFonte < MIN_TEXT_SIZE || value.tamanhoFonte > MAX_TEXT_SIZE)) ||
    (allowedFonts && !configuredFont) || x === null || y === null
  ) return null;

  const fonteNome = configuredFont?.nome || normalizedFontName(value.fonteNome);
  const fonteCssFamily = configuredFont?.cssFamily || normalizedCssFamily(value.fonteCssFamily);
  const fonteArquivoUrl = configuredFont?.arquivoUrl || normalizedFontUrl(value.fonteArquivoUrl);
  const normalized: TextCustomization = {
    texto,
    fonte,
    ...(fonteNome ? { fonteNome } : {}),
    ...(fonteCssFamily ? { fonteCssFamily } : {}),
    ...(fonteArquivoUrl ? { fonteArquivoUrl } : {}),
    ...(typeof value.cor === 'string' ? { cor: value.cor.toLowerCase() } : {}),
    ...(typeof value.tamanhoFonte === 'number' ? { tamanhoFonte: Math.round(value.tamanhoFonte * 10) / 10 } : {}),
    posicao: { x, y },
  };
  if (value.linhas !== undefined) {
    const rows = texto.split('\n');
    if (!Array.isArray(value.linhas) || value.linhas.length !== rows.length ||
        (value.fonteCompartilhada !== undefined && typeof value.fonteCompartilhada !== 'boolean') ||
        (value.corCompartilhada !== undefined && typeof value.corCompartilhada !== 'boolean')) return null;
    const ids = new Set<string>();
    const lines: TextCustomizationLine[] = [];
    for (let i = 0; i < value.linhas.length; i++) {
      const line = value.linhas[i];
      if (!isRecord(line) || !isRecord(line.posicao) || typeof line.id !== 'string' ||
          !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(line.id) || ids.has(line.id) ||
          typeof line.texto !== 'string' || /[\r\n]/.test(line.texto) ||
          (line.tamanhoFonte !== undefined && (typeof line.tamanhoFonte !== 'number' || !Number.isFinite(line.tamanhoFonte) || line.tamanhoFonte < MIN_TEXT_SIZE || line.tamanhoFonte > MAX_TEXT_SIZE)) ||
          (line.cor !== undefined && (typeof line.cor !== 'string' || !/^#[a-f0-9]{6}$/i.test(line.cor))) ||
          (line.fonte !== undefined && !normalizedFontId(line.fonte)) ||
          line.texto.trim().replace(/\s+/g, ' ') !== rows[i]) return null;
      ids.add(line.id);
      const separateFont = value.fonteCompartilhada === false && line.fonte !== undefined;
      const style = normalizeTextCustomization({
        texto: rows[i] || '_',
        fonte: separateFont ? line.fonte : normalized.fonte,
        fonteNome: separateFont ? line.fonteNome : normalized.fonteNome,
        fonteCssFamily: separateFont ? line.fonteCssFamily : normalized.fonteCssFamily,
        fonteArquivoUrl: separateFont ? line.fonteArquivoUrl : normalized.fonteArquivoUrl,
        tamanhoFonte: line.tamanhoFonte ?? normalized.tamanhoFonte,
        cor: value.corCompartilhada === false ? line.cor ?? normalized.cor : normalized.cor,
        posicao: line.posicao,
      }, allowedFonts);
      if (!style) return null;
      lines.push({ id: line.id, ...style, texto: rows[i] });
    }
    normalized.linhas = lines;
    normalized.fonteCompartilhada = value.fonteCompartilhada !== false;
    normalized.corCompartilhada = value.corCompartilhada !== false;
  }
  return normalized;
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
  const style = (line: TextCustomization | TextCustomizationLine) => [line.texto, line.fonte, line.posicao.x.toFixed(1), line.posicao.y.toFixed(1), line.tamanhoFonte ?? 'auto', line.cor ?? '#ffffff'];
  return JSON.stringify([style(value), value.fonteCompartilhada ?? true, value.corCompartilhada ?? true, value.linhas?.map(style)]);
}

export function textCustomizationFontLabel(value: TextCustomization, fonts: PersonalizationFont[] = []): string {
  if (value.fonteCompartilhada === false && value.linhas?.some(line => line.fonte && line.fonte !== value.fonte)) return 'Fontes por linha';
  return textFontLabel(value.fonte, fonts, value.fonteNome);
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
