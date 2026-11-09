import type { Anuncio, ProductAttribute } from "../types.js";
import type { ProductPdfTemplate } from "./pdfTemplate.js";
import { validAlphabet } from "./decorativeInitial.js";
import { isTemplatePath } from "./pdfTemplate.js";
import {
  layoutFont,
  newPdfLine,
  normalizePdfLayout,
  type StaffPdfLayout,
  type StaffPdfJob,
} from "./staffPdf.js";
import {
  productRequiresArtwork,
  productRequiresText,
  type PersonalizationFont,
} from "./textCustomization.js";
import { parseMoneyToCents } from "./commerce.js";

export interface ProductPdfBinding {
  revision: string;
  baseId: string;
  baseRevision: string;
  layoutId: string;
  layoutRevision: string;
  layout: StaffPdfLayout;
  fonts: PersonalizationFont[];
  pdf: ProductPdfTemplate;
}
export interface ProductProductionAssets {
  imagemBase?: string;
  moldePdf?: ProductPdfBinding;
}

type ProductProduction = ProductProductionAssets & {
  atributos?: ProductAttribute[];
};

export function optionProductionAssets(
  atributos?: ProductAttribute[],
): ProductProductionAssets[] {
  return (atributos || []).flatMap((attribute) =>
    attribute.opcoes.flatMap((option) => {
      const config = attribute.configuracao?.[option];
      return config?.moldePdf || config?.imagemBase ? [config] : [];
    }),
  );
}

/** The first selected option with its own production assets replaces the entire default. */
export function resolveProductProduction(
  product: ProductProduction,
  selections: Record<string, string>,
): ProductProductionAssets & { fromOption: boolean } {
  for (const attribute of product.atributos || []) {
    const value = selections[attribute.nome];
    if (!attribute.opcoes.includes(value)) continue;
    const config = attribute.configuracao?.[value];
    if (config?.moldePdf || config?.imagemBase)
      return {
        moldePdf: config.moldePdf,
        imagemBase: config.imagemBase,
        fromOption: true,
      };
  }
  return {
    moldePdf: product.moldePdf,
    imagemBase: product.imagemBase,
    fromOption: false,
  };
}
export interface ProductPdfOrder {
  job: StaffPdfJob;
  fonts: PersonalizationFont[];
  fitMargin: number;
  fullPage: boolean;
}
/** A false choice suppresses the corresponding input and all its output. */
export function productCustomization(
  product: Pick<Anuncio, "tipoInput" | "atributos">,
  selections: Record<string, string>,
) {
  const selected = (product.atributos || []).map(
    (a) => a.configuracao?.[selections[a.nome]],
  );
  return {
    text:
      (productRequiresText(product.tipoInput) ||
        selected.some((o) => o?.texto === true)) &&
      !selected.some((o) => o?.texto === false),
    image:
      (productRequiresArtwork(product.tipoInput) ||
        selected.some((o) => o?.imagem === true)) &&
      !selected.some((o) => o?.imagem === false),
  };
}
const MAX_PRODUCT_PRICE_CENTS = 999999900;
function positivePrice(value: unknown): number | null {
  const cents = parseMoneyToCents(value);
  return cents !== null && cents > 0 && cents <= MAX_PRODUCT_PRICE_CENTS
    ? cents
    : null;
}

export function productPrice(
  product: Pick<
    Anuncio,
    "atributos" | "precificacao" | "combinacoes" | "preco_base"
  >,
  selections: Record<string, string>,
): number | null {
  const attributes = product.atributos || [];
  const chosen = Object.entries(selections);
  if (
    chosen.some(
      ([name, option]) =>
        !attributes.some((a) => a.nome === name && a.opcoes.includes(option)),
    )
  )
    return null;
  if (chosen.length === 0) {
    // Older combination products may have a marketing label in the base price field.
    if (
      attributes.length &&
      product.precificacao !== "adicionais" &&
      !/^(?:R\$\s*)?\d[\d.,\s]*$/i.test(String(product.preco_base).trim())
    )
      return null;
    return positivePrice(product.preco_base);
  }

  if (product.precificacao !== "adicionais") {
    if (chosen.length === attributes.length) {
      const key = attributes.map((a) => selections[a.nome]).join("|");
      return positivePrice(product.combinacoes?.[key]);
    }
    if (chosen.length === 1) {
      const [[name, option]] = chosen;
      return positivePrice(
        attributes.find((a) => a.nome === name)?.configuracao?.[option]
          ?.precoIndividual,
      );
    }
    return null;
  }

  let total = positivePrice(product.preco_base);
  if (total === null) return null;
  for (const attr of attributes) {
    if (!Object.hasOwn(selections, attr.nome)) continue;
    const extra = parseMoneyToCents(
      attr.configuracao?.[selections[attr.nome]]?.adicional ?? "0",
    );
    if (extra === null || extra < 0) return null;
    total += extra;
  }
  return Number.isSafeInteger(total) && total <= MAX_PRODUCT_PRICE_CENTS
    ? total
    : null;
}

export function productMinimum(product: Anuncio): number | null {
  const base = productPrice(product, {});
  const attributes = product.atributos || [];
  if (product.precificacao === "adicionais" || attributes.length === 0)
    return base;

  const fullPrices = Object.values(product.combinacoes || {}).map(
    positivePrice,
  );
  const singlePrices =
    attributes.length > 1
      ? attributes.flatMap((attr) =>
          attr.opcoes.map((option) =>
            productPrice(product, { [attr.nome]: option }),
          ),
        )
      : [];
  const prices = [base, ...fullPrices, ...singlePrices].filter(
    (n): n is number => n !== null,
  );
  return prices.length ? Math.min(...prices) : null;
}
export function bindingValid(
  value: unknown,
  productId: string,
): value is ProductPdfBinding {
  try {
    const b = value as ProductPdfBinding,
      hex = (v: unknown) => typeof v === "string" && /^[a-f0-9]{32}$/.test(v);
    return (
      !!b &&
      hex(b.revision) &&
      typeof b.baseId === "string" &&
      /^[A-Za-z0-9_-]{1,160}$/.test(b.baseId) &&
      hex(b.baseRevision) &&
      hex(b.layoutId) &&
      hex(b.layoutRevision) &&
      !!normalizePdfLayout(b.layout) &&
      Array.isArray(b.fonts) &&
      b.fonts.length <= 1 &&
      (b.pdf.alphabet === undefined ||
        validAlphabet(b.pdf.alphabet, b.pdf.name, productId)) &&
      isTemplatePath(b.pdf.path, productId) &&
      hex(b.pdf.id) &&
      b.pdf.path.endsWith("/" + b.pdf.id + ".pdf") &&
      typeof b.pdf.name === "string" &&
      b.pdf.name.length > 0 &&
      b.pdf.name.length <= 120 &&
      Array.isArray(b.pdf.pages) &&
      b.pdf.pages.length >= 1 &&
      b.pdf.pages.length <= 16 &&
      b.pdf.pages.every(
        (p) => typeof p === "string" && p.startsWith("https://"),
      )
    );
  } catch {
    return false;
  }
}
/** Both the storefront and checkout construct the same locked job from the published mold. */
export function productPdfOrder(
  binding: ProductPdfBinding,
  text: unknown,
  enabled: boolean,
): ProductPdfOrder {
  const normalized =
    typeof text === "string" ? text.replace(/\r\n?/g, "\n").trim() : "";
  if (
    enabled &&
    (!normalized ||
      normalized.length > 200 ||
      normalized.split("\n").length > 8 ||
      /[\u0000-\u0008\u000b-\u001f\u007f]/.test(normalized))
  )
    throw new Error("Informe até 200 caracteres e 8 linhas para o nome.");
  if (binding.layout.font_name && !layoutFont(binding.layout, binding.fonts))
    throw new Error(
      "A fonte do molde não está disponível. Atualize o vínculo no produto.",
    );
  const line = newPdfLine(binding.layout, binding.fonts);
  line.id = "00000000-0000-4000-8000-000000000001";
  line.kind = "main";
  line.text = enabled ? normalized : "";
  return {
    job: {
      schemaVersion: 1,
      baseId: binding.baseId,
      baseRevision: binding.baseRevision,
      layoutId: binding.layoutId,
      layoutRevision: binding.layoutRevision,
      lines: [line],
    },
    fonts: binding.fonts,
    fitMargin: binding.layout.fit_margin,
    fullPage: binding.layout.imagem_full_page,
  };
}

export function productionAssetUrls(product: Partial<Anuncio>): string[] {
  return [product, ...optionProductionAssets(product.atributos)].flatMap(
    (source) =>
      [
        source.imagemBase,
        source.moldePdf?.pdf.path,
        ...(source.moldePdf?.pdf.pages || []),
        ...Object.values(source.moldePdf?.pdf.alphabet?.letters || {}).map(
          (letter) => letter.url,
        ),
      ].filter((value): value is string => Boolean(value)),
  );
}

export function productMayRequireText(product: Partial<Anuncio>): boolean {
  return (
    productRequiresText(product.tipoInput) ||
    (product.atributos || []).some((a) =>
      Object.values(a.configuracao || {}).some(
        (option) => option.texto === true,
      ),
    )
  );
}
