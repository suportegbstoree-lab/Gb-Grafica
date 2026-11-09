import type { Anuncio, ProductAttribute } from "../types.js";

export interface VariationType {
  id: string;
  name: string;
  revision: string;
}

export const MAX_PRODUCT_SKU = 180;
export const MAX_VARIATION_SKU = 100;
export const MAX_COMBINATION_SKU = 420;

export function cleanSku(value: unknown, max: number): string | null {
  if (value === undefined || value === "") return "";
  if (
    typeof value !== "string" ||
    /[\x00-\x1f\x7f]/.test(value) ||
    value.trim().length > max
  )
    return null;
  return value.trim().replace(/\s+/g, " ");
}

export function variationTypeName(value: unknown): string {
  const name = cleanSku(value, 80);
  if (!name || name.includes("|") || Object.hasOwn(Object.prototype, name)) {
    throw new Error("Informe um nome de variação válido de até 80 caracteres.");
  }
  return name;
}

export function variationImage(
  product: Pick<Anuncio, "atributos">,
  selections: Record<string, string>,
): string {
  for (const attribute of product.atributos || []) {
    const option = selections[attribute.nome];
    if (attribute.opcoes.includes(option)) {
      const image = attribute.configuracao?.[option]?.referencia;
      if (image) return image;
    }
  }
  return "";
}

export function variationReferenceUrls(product: Partial<Anuncio>): string[] {
  return (product.atributos || []).flatMap((attribute) =>
    Object.values(attribute.configuracao || {}).flatMap((config) =>
      config.referencia ? [config.referencia] : [],
    ),
  );
}

export function productSku(
  product: Pick<Anuncio, "nome" | "sku" | "atributos" | "skuPorCombinacao">,
  selections: Record<string, string>,
): string {
  const options = (product.atributos || []).map(
    (attribute) => selections[attribute.nome],
  );
  const base = cleanSku(product.sku, MAX_PRODUCT_SKU) || product.nome.trim();
  if (options.some((option) => !option)) return base;
  const override = options.length
    ? product.skuPorCombinacao?.[options.join("|")]
    : undefined;
  return (
    cleanSku(override, MAX_COMBINATION_SKU) ||
    [
      base,
      ...(product.atributos || []).map(
        (attribute, i) =>
          cleanSku(
            attribute.configuracao?.[options[i]]?.sku,
            MAX_VARIATION_SKU,
          ) || options[i],
      ),
    ]
      .join(" ")
      .slice(0, MAX_COMBINATION_SKU)
  );
}

/** An option rename carries its price, SKU, image and shipping configuration into the new key. */
export function replaceProductOption(
  product: Partial<Anuncio>,
  index: number,
  option: string,
  replacement?: string,
): Partial<Anuncio> {
  const attributes = product.atributos || [];
  const old = attributes[index];
  const { [option]: optionConfig, ...config } = old.configuracao || {};
  const next = {
    ...old,
    opcoes: old.opcoes.flatMap((value) =>
      value === option ? (replacement ? [replacement] : []) : [value],
    ),
    configuracao:
      replacement && optionConfig
        ? { ...config, [replacement]: optionConfig }
        : config,
  } satisfies ProductAttribute;
  function remap<T>(values: Record<string, T> | undefined) {
    return Object.fromEntries(
      Object.entries(values || {}).flatMap(([key, value]) => {
        const parts = key.split("|");
        if (parts[index] !== option) return [[key, value] as const];
        if (!replacement) return [];
        parts[index] = replacement;
        return [[parts.join("|"), value] as const];
      }),
    );
  }
  return {
    ...product,
    atributos: attributes.map((attribute, i) =>
      i === index ? next : attribute,
    ),
    combinacoes: remap(product.combinacoes),
    skuPorCombinacao: remap(product.skuPorCombinacao),
    imagensPorCombinacao: remap(product.imagensPorCombinacao),
    shippingByCombination: remap(product.shippingByCombination),
  };
}
