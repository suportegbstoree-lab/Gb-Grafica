import type { ImportedProduct } from "./staffLabelImport";
import type { StaffPdfBase } from "./staffPdf";

type BaseInfo = Pick<StaffPdfBase, "id" | "name" | "sourceName" | "category" | "initialFolderName">;
export interface LabelBaseSuggestion {
  id: string;
  /** Relative ranking only, not a probability. Never used to save a binding. */
  score: number;
  reason: string;
}

const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const plain = (value: string) => fold(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const generic = new Set([
  "com", "sem", "para", "por", "das", "dos", "uma", "uns", "seu", "sua", "que",
  "nome", "nomes", "personalizado", "personalizada", "personalizados", "personalizadas",
  "produto", "produtos", "base", "bases", "pdf", "template", "modelo", "modelos",
  "kit", "unidade", "unidades", "folha", "folhas", "fazemos", "qualquer", "tema", "temas",
]);
const singular = (word: string) => {
  if (word === "flores") return "flor";
  if (word === "azuis") return "azul";
  if (word.endsWith("oes")) return word.slice(0, -3) + "ao";
  return word.length > 4 && word.endsWith("s") && !/(?:is|us)$/.test(word) ? word.slice(0, -1) : word;
};
function tokens(value: string) {
  return [...new Set(plain(value.replace(/\.pdf\b/gi, "").replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")).split(/\s+/)
    .filter(word => word.length >= 3 && !generic.has(word) && !/^\d+(?:p|x|cm|mm)?$/.test(word))
    .map(singular))];
}
function containsSku(name: string, sku: string) {
  const parts = plain(name).split(/\s+/);
  return parts.some((_, start) => {
    let code = "";
    for (let i = start; i < parts.length && code.length < sku.length; i++) {
      code += parts[i];
      if (code === sku) return true;
    }
    return false;
  });
}
/** A single missing/replaced letter is useful for long names, not for short codes or colors. */
function similarity(a: string, b: string) {
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1 ||
    /\d/.test(a + b)) return 0;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return 0;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (i < a.length || j < b.length ? 1 : 0) <= 1 ? 0.82 : 0;
}

/** Suggest from existing metadata only; no PDF download, API key or automatic association. */
export function suggestLabelBases(
  product: Pick<ImportedProduct, "sku" | "description" | "variation">,
  bases: BaseInfo[],
  limit = 3,
): LabelBaseSuggestion[] {
  const candidates = bases.map(base => ({
    base,
    names: [base.name, base.sourceName, base.initialFolderName].filter(Boolean) as string[],
    terms: tokens([base.name, base.sourceName, base.initialFolderName].filter(Boolean).join(" ")),
    category: tokens(base.category ?? ""),
  }));
  const frequency = new Map<string, number>();
  const baseNames = new Map(bases.map(base => [base.id, base.name]));
  for (const candidate of candidates)
    for (const term of candidate.terms) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  const weight = (term: string) => 1 + Math.log(1 + bases.length / (frequency.get(term) ?? 1));
  function match(query: string[], target: string[]) {
    const matches: string[] = [];
    let matchedWeight = 0;
    for (const term of query) {
      const best = Math.max(0, ...target.map(value => similarity(term, value)));
      if (best) { matches.push(term); matchedWeight += weight(term) * best; }
    }
    const total = query.reduce((sum, term) => sum + weight(term), 0);
    return { matches, coverage: total ? matchedWeight / total : 0 };
  }
  const description = tokens(product.description), variation = tokens(product.variation);
  const sku = plain(product.sku), compactSku = sku.replace(/\s/g, "");
  // Numeric marketplace SKUs only help if that entire code is actually in the base's name.
  const usableSku = compactSku.length >= (/^\d+$/.test(compactSku) ? 4 : 3);
  const ranked = candidates.flatMap(({ base, names, terms, category }) => {
    const skuExact = usableSku && names.some(name => containsSku(name, compactSku));
    const skuTerms = usableSku && !/^\d+$/.test(compactSku)
      ? terms.filter(term => term.length >= 4 && !category.includes(term) && compactSku.includes(term)) : [];
    const skuTheme = skuTerms.length >= 2;
    const byVariation = match(variation, terms), byDescription = match(description, terms);
    const byCategory = match(description, category);
    const distinctDescription = byDescription.matches.filter(term =>
      !category.some(value => similarity(term, value)) &&
      (bases.length <= 1 || (frequency.get(term) ?? 1) / bases.length < 0.7),
    );
    const variationHit = byVariation.matches.length > 0 && byVariation.coverage >= 0.5;
    const descriptionHit = distinctDescription.length > 0 &&
      (byDescription.matches.length >= 2 || byDescription.coverage >= 0.7 ||
        distinctDescription.some(term => term.length >= 5));
    if (!skuExact && !skuTheme && !variationHit && !descriptionHit) return [];
    const score = (skuExact ? 120 : skuTheme ? 55 : 0) + byVariation.coverage * 70 +
      byDescription.coverage * 25 + distinctDescription.length * 4 + byCategory.coverage * 8;
    const reasons: string[] = [];
    if (skuExact) reasons.push("SKU encontrado nos dados da base");
    else if (skuTheme) reasons.push("Termos do SKU em comum: " + skuTerms.slice(0, 3).join(", "));
    if (variationHit) reasons.push("Variação em comum: " + byVariation.matches.slice(0, 4).join(", "));
    else if (descriptionHit) reasons.push("Descrição em comum: " + distinctDescription.slice(0, 4).join(", "));
    return [{ id: base.id, score, reason: reasons.join(" · "), specific: skuExact || skuTheme || variationHit }];
  });
  // Prefer actual SKU/variation evidence when present, instead of filling the list with other themes.
  const hasSpecific = ranked.some(item => item.specific);
  return ranked.filter(item => !hasSpecific || item.specific).sort((a, b) => b.score - a.score ||
    (baseNames.get(a.id) ?? "").localeCompare(
      baseNames.get(b.id) ?? "", "pt-BR", { numeric: true },
    ) || a.id.localeCompare(b.id)).slice(0, Math.max(0, limit))
    .map(({ id, score, reason }) => ({ id, score, reason }));
}
