import type { Anuncio } from "../types";
export function variantImage(
  product: Pick<
    Anuncio,
    "imagem" | "imagens" | "imagensPorCombinacao" | "atributos"
  >,
  selections: Record<string, string>,
): string {
  const key = product.atributos.map((a) => selections[a.nome] || "").join("|");
  const image = product.imagensPorCombinacao?.[key];
  return image && [product.imagem, ...(product.imagens || [])].includes(image)
    ? image
    : product.imagem;
}
