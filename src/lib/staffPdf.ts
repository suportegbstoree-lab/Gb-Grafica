import { normalizeStaffBarcode } from "./staffPdfBarcode.js";
import type { PersonalizationFont } from "./textCustomization.js";

export const STAFF_PDF_MAX_PAGES = 16;
export const STAFF_PDF_DPI = 300;
export const STAFF_PDF_MAX_LINES = 30;
export const STAFF_PDF_LAYOUT_PERMISSION = "documents.templates.manage";
export type PdfTextLayout = "portrait" | "landscape";
export interface PdfTextBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Desktop templates use top-left pixels at 300 DPI, including landscape coordinates. */
export interface StaffPdfLayout {
  base_pdf_name?: string;
  pos_x: number;
  pos_y: number;
  max_width_pixels: number;
  max_height_pixels: number;
  pos_x_landscape: number;
  pos_y_landscape: number;
  max_width_pixels_landscape: number;
  max_height_pixels_landscape: number;
  font_size: number;
  font_name: string;
  color: string;
  align: "left" | "center" | "right";
  imagem_full_page: boolean;
  text_rotation: number;
  fit_margin: number;
}
export interface StaffPdfBase {
  id: string;
  name: string;
  pageCount: number;
  revision: string;
  pages: Array<{ width: number; height: number }>;
  source?: "internal" | "catalog";
  productId?: string;
  templateId?: string;
}
export interface StaffPdfLayoutView {
  id: string;
  name: string;
  revision: string;
  layout: StaffPdfLayout;
}
export interface StaffPdfLine {
  id: string;
  kind?: "main" | "extra";
  text: string;
  fontId: string;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
  rotation: number;
  effects?: StaffPdfTextEffects;
  portrait: PdfTextBox;
  landscape: PdfTextBox;
}
export interface StaffPdfTextEffects {
  bold: boolean;
  opacity: number;
  outline: boolean;
  outlineColor: string;
  outlineWidth: number;
  outlineOpacity?: number;
  shadow?: { x: number; y: number; blur: number; color: string };
  glow?: { intensity: number; color: string };
  curve: number;
  letterSpacing: number;
  lineSpacing: number;
}
export const DEFAULT_PDF_TEXT_EFFECTS: StaffPdfTextEffects = {
  bold: false,
  opacity: 100,
  outline: false,
  outlineColor: "#000000",
  outlineWidth: 7,
  outlineOpacity: 100,
  curve: 0,
  letterSpacing: 0,
  lineSpacing: 1.15,
};

function normalizePdfTextEffects(value: unknown): StaffPdfTextEffects {
  if (!object(value)) throw new Error("Efeitos do texto inválidos.");
  const effects = { ...DEFAULT_PDF_TEXT_EFFECTS, ...value };
  const {
    bold,
    opacity,
    outline,
    outlineColor,
    outlineWidth,
    curve,
    letterSpacing,
    lineSpacing,
    outlineOpacity,
    shadow,
    glow,
  } = effects;
  if (
    typeof bold !== "boolean" ||
    typeof outline !== "boolean" ||
    typeof outlineColor !== "string" ||
    !/^#[a-f0-9]{6}$/i.test(outlineColor) ||
    !number(opacity, 0, 100) ||
    !number(outlineWidth, 1, 30) ||
    !number(outlineOpacity, 0, 100) ||
    (shadow !== undefined &&
      (!object(shadow) ||
        !number(shadow.x, -200, 200) ||
        !number(shadow.y, -200, 200) ||
        !number(shadow.blur, 0, 100) ||
        typeof shadow.color !== "string" ||
        !/^#[a-f0-9]{6}$/i.test(shadow.color))) ||
    (glow !== undefined &&
      (!object(glow) ||
        !number(glow.intensity, 1, 100) ||
        typeof glow.color !== "string" ||
        !/^#[a-f0-9]{6}$/i.test(glow.color))) ||
    !number(curve, -100, 100) ||
    !number(letterSpacing, -50, 100) ||
    !number(lineSpacing, 0.5, 3)
  )
    throw new Error("Revise os efeitos e o espaçamento do texto.");
  return {
    bold,
    opacity,
    outline,
    outlineColor,
    outlineWidth,
    curve,
    letterSpacing,
    lineSpacing,
    ...(value.outlineOpacity === undefined ? {} : { outlineOpacity }),
    ...(shadow
      ? {
          shadow: {
            x: shadow.x,
            y: shadow.y,
            blur: shadow.blur,
            color: shadow.color,
          },
        }
      : {}),
    ...(glow ? { glow: { intensity: glow.intensity, color: glow.color } } : {}),
  };
}

export interface StaffPdfJob {
  schemaVersion: 1;
  barcode?: string;
  baseId: string;
  baseRevision: string;
  layoutId: string;
  layoutRevision: string;
  lines: StaffPdfLine[];
  outputName?: string;
}
export function staffPdfOutputName(value: string): string {
  return value
    .trim()
    .replace(/(?:\.pdf)+$/i, "")
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 120)
    .replace(/[. ]+$/g, "");
}
export function staffPdfName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 180 ||
    /[\x00-\x1f\x7f/\\]/.test(value)
  )
    throw new Error("Nome do PDF ou molde inválido.");
  const name = value.normalize("NFC").trim();
  if (!name || ["__proto__", "prototype", "constructor"].includes(name))
    throw new Error("Nome inválido.");
  return name;
}
export function defaultPdfLayout(): StaffPdfLayout {
  return {
    pos_x: 200,
    pos_y: 1000,
    max_width_pixels: 2000,
    max_height_pixels: 400,
    pos_x_landscape: 200,
    pos_y_landscape: 800,
    max_width_pixels_landscape: 2500,
    max_height_pixels_landscape: 400,
    font_size: 150,
    font_name: "",
    color: "#000000",
    align: "center",
    imagem_full_page: false,
    text_rotation: 0,
    fit_margin: 0.2,
  };
}
const object = (v: unknown): v is Record<string, any> =>
  Boolean(v && typeof v === "object" && !Array.isArray(v));
const number = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
export function normalizePdfLayout(value: unknown): StaffPdfLayout {
  if (!object(value)) throw new Error("Molde inválido.");
  const fallback = defaultPdfLayout(),
    output = { ...fallback };
  for (const key of [
    "pos_x",
    "pos_y",
    "max_width_pixels",
    "max_height_pixels",
    "pos_x_landscape",
    "pos_y_landscape",
    "max_width_pixels_landscape",
    "max_height_pixels_landscape",
  ] as const) {
    const portrait = key.replace("_landscape", "") as keyof StaffPdfLayout;
    const v = value[key] ?? value[portrait] ?? fallback[key];
    if (!number(v, key.includes("max_") ? 1 : 0, 60000))
      throw new Error(`Geometria inválida: ${key}.`);
    output[key] = v;
  }
  for (const [key, min, max] of [
    ["font_size", 1, 4000],
    ["text_rotation", -180, 180],
    ["fit_margin", 0, 0.5],
  ] as const) {
    const v = value[key] ?? fallback[key];
    if (!number(v, min, max)) throw new Error(`Valor inválido: ${key}.`);
    output[key] = v;
  }
  if (
    value.font_name !== undefined &&
    (typeof value.font_name !== "string" ||
      value.font_name.length > 180 ||
      /[\x00-\x1f\x7f/\\]/.test(value.font_name))
  )
    throw new Error("Nome da fonte inválido.");
  if (value.base_pdf_name !== undefined && value.base_pdf_name !== "") {
    output.base_pdf_name = staffPdfName(value.base_pdf_name);
    if (!/\.pdf$/i.test(output.base_pdf_name))
      throw new Error("Escolha um nome de base PDF.");
  }
  output.font_name = value.font_name ?? "";
  let color = value.color ?? fallback.color;
  if (typeof color === "string" && /^#[a-fA-F0-9]{3}$/.test(color))
    color = "#" + [...color.slice(1)].map((c) => c + c).join("");
  if (typeof color !== "string" || !/^#[a-fA-F0-9]{6}$/.test(color))
    throw new Error("Cor inválida.");
  output.color = color.toLowerCase();
  if (!["left", "center", "right"].includes(value.align ?? fallback.align))
    throw new Error("Alinhamento inválido.");
  output.align = value.align ?? fallback.align;
  if (
    value.imagem_full_page !== undefined &&
    typeof value.imagem_full_page !== "boolean"
  )
    throw new Error("Opção de imagem inválida.");
  output.imagem_full_page = value.imagem_full_page ?? false;
  return output;
}
export function parsePdfLayoutMap(
  value: unknown,
): Array<{ name: string; layout: StaffPdfLayout }> {
  if (!object(value) || Object.keys(value).length > 1000)
    throw new Error("O JSON deve conter até 1.000 moldes.");
  return Object.entries(value).map(([name, layout]) => ({
    name: staffPdfName(name),
    layout: normalizePdfLayout(layout),
  }));
}
export function matchPdfLayout(
  name: string,
  pageCount: number,
  layouts: StaffPdfLayoutView[],
) {
  const stem = name.replace(/\.pdf$/i, "").normalize("NFC");
  const candidates = [
    stem,
    `${stem}_template__${pageCount}p`,
    `${stem}_template`,
  ];
  const normalized = (value: string) => value.normalize("NFC").toLowerCase();
  const eligible = layouts.filter(
    (item) =>
      !item.layout.base_pdf_name ||
      normalized(item.layout.base_pdf_name) === normalized(name),
  );
  const linked = eligible.filter((item) => item.layout.base_pdf_name);
  return (
    candidates
      .map((key) => eligible.find((t) => t.name === key))
      .find(Boolean) ??
    candidates
      .map((key) => {
        const matches = eligible.filter(
          (t) => normalized(t.name) === normalized(key),
        );
        return matches.length === 1 ? matches[0] : undefined;
      })
      .find(Boolean) ??
    (linked.length === 1 ? linked[0] : undefined)
  );
}
export function layoutBox(
  layout: StaffPdfLayout,
  orientation: PdfTextLayout,
): PdfTextBox {
  return orientation === "portrait"
    ? {
        x: layout.pos_x,
        y: layout.pos_y,
        width: layout.max_width_pixels,
        height: layout.max_height_pixels,
      }
    : {
        x: layout.pos_x_landscape,
        y: layout.pos_y_landscape,
        width: layout.max_width_pixels_landscape,
        height: layout.max_height_pixels_landscape,
      };
}
export const STAFF_PDF_SYSTEM_FONT: PersonalizationFont = {
  id: "staff-pdf-system",
  nome: "Padrão do sistema",
  cssFamily: "Arial, sans-serif",
  ativo: true,
};

export function staffPdfFont(id: string, fonts: PersonalizationFont[]) {
  return id === STAFF_PDF_SYSTEM_FONT.id
    ? STAFF_PDF_SYSTEM_FONT
    : fonts.find((f) => f.id === id);
}

export function layoutFont(
  layout: StaffPdfLayout,
  fonts: PersonalizationFont[],
) {
  const stem = (name: string) =>
    name
      .normalize("NFC")
      .toLowerCase()
      .replace(/\.(ttf|otf|woff2)$/i, "")
      .trim();
  const expected = stem(layout.font_name);
  return (
    fonts.find((font) => font.id === layout.font_name) ??
    (expected ? fonts.find((font) => stem(font.nome) === expected) : undefined)
  );
}
export function newPdfLine(
  layout: StaffPdfLayout,
  fonts: PersonalizationFont[],
  index = 0,
): StaffPdfLine {
  const portrait = layoutBox(layout, "portrait"),
    landscape = layoutBox(layout, "landscape");
  portrait.y += index * Math.min(layout.font_size * 1.2, portrait.height);
  landscape.y += index * Math.min(layout.font_size * 1.2, landscape.height);
  return {
    id: crypto.randomUUID(),
    text: "",
    fontId: layoutFont(layout, fonts)?.id || STAFF_PDF_SYSTEM_FONT.id,
    fontSize: layout.font_size,
    color: layout.color,
    align: layout.align,
    rotation: layout.text_rotation,
    portrait,
    landscape,
  };
}
export function fixedStaffPdfMain(
  layout: StaffPdfLayout,
  line: StaffPdfLine,
): StaffPdfLine {
  const { id, text, fontId, fontSize } = line;
  return {
    id,
    kind: "main",
    text,
    fontId,
    fontSize,
    color: layout.color,
    align: layout.align,
    rotation: layout.text_rotation,
    portrait: layoutBox(layout, "portrait"),
    landscape: layoutBox(layout, "landscape"),
  };
}

export function normalizeStaffPdfJob(
  value: unknown,
  fonts: PersonalizationFont[],
): StaffPdfJob {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    typeof value.baseId !== "string" ||
    !/^[A-Za-z0-9_-]{1,160}$/.test(value.baseId) ||
    !/^[a-f0-9]{32}$/.test(value.baseRevision) ||
    !/^[a-f0-9]{32}$/.test(value.layoutId) ||
    !/^[a-f0-9]{32}$/.test(value.layoutRevision) ||
    !Array.isArray(value.lines) ||
    value.lines.length < 1 ||
    value.lines.length > STAFF_PDF_MAX_LINES
  )
    throw new Error("Edição do PDF inválida.");
  const lines = value.lines.map((line: any): StaffPdfLine => {
    if (
      !object(line) ||
      typeof line.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(line.id) ||
      typeof line.text !== "string" ||
      line.text.length > 500 ||
      /[\x00-\x08\x0b-\x1f\x7f]/.test(line.text) ||
      (line.kind !== undefined && !["main", "extra"].includes(line.kind)) ||
      !staffPdfFont(line.fontId, fonts) ||
      !number(line.fontSize, 1, 4000) ||
      !/^#[a-fA-F0-9]{6}$/.test(line.color) ||
      !["left", "center", "right"].includes(line.align) ||
      !number(line.rotation, -180, 180)
    )
      throw new Error("Revise as linhas, as fontes, as cores e os tamanhos.");
    const box = (v: any): PdfTextBox => {
      if (
        !object(v) ||
        !number(v.x, 0, 60000) ||
        !number(v.y, 0, 60000) ||
        !number(v.width, 1, 60000) ||
        !number(v.height, 1, 60000)
      )
        throw new Error("Posição de texto inválida.");
      return { x: v.x, y: v.y, width: v.width, height: v.height };
    };
    return {
      id: line.id,
      ...(line.kind === undefined ? {} : { kind: line.kind }),
      text: line.text,
      fontId: line.fontId,
      fontSize: line.fontSize,
      color: line.color.toLowerCase(),
      align: line.align,
      rotation: line.rotation,
      ...(line.effects === undefined
        ? {}
        : { effects: normalizePdfTextEffects(line.effects) }),
      portrait: box(line.portrait),
      landscape: box(line.landscape),
    };
  });
  if (
    (lines.some((line) => line.kind) &&
      (lines[0].kind !== "main" ||
        lines.slice(1).some((line) => line.kind !== "extra"))) ||
    !lines.some((l) => l.text.trim()) ||
    new Set(lines.map((l) => l.id)).size !== lines.length
  )
    throw new Error("Adicione texto e use linhas distintas.");
  if (
    value.outputName !== undefined &&
    (typeof value.outputName !== "string" ||
      !value.outputName ||
      staffPdfOutputName(value.outputName) !== value.outputName)
  )
    throw new Error("Nome do arquivo final inválido.");
  return {
    ...(value.barcode === undefined
      ? {}
      : { barcode: normalizeStaffBarcode(value.barcode) }),
    ...(value.outputName ? { outputName: value.outputName } : {}),
    schemaVersion: 1,
    baseId: value.baseId,
    baseRevision: value.baseRevision,
    layoutId: value.layoutId,
    layoutRevision: value.layoutRevision,
    lines,
  };
}
export function staffPdfStoragePath(id: string, uploadId?: string): string {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("PDF interno inválido.");
  if (uploadId !== undefined) {
    if (!/^[a-f0-9]{32}$/.test(uploadId))
      throw new Error("Versão do PDF inválida.");
    return `staff-pdf-bases/${id}/versions/${uploadId}.pdf`;
  }
  return `staff-pdf-bases/${id}/original.pdf`;
}
