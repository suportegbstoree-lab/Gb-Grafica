export const UNCATEGORIZED_PDFS = "Sem categoria";
export function normalizePdfCategory(value: unknown): string {
  if (typeof value !== "string") throw new Error("Informe a categoria do PDF.");
  const name = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (
    !name ||
    name.length > 100 ||
    /[\x00-\x1f\x7f/\\]/.test(name) ||
    [".", ".."].includes(name)
  )
    throw new Error("Use um nome de categoria de até 100 caracteres.");
  return name;
}
export function pdfCategoryKey(value: string) {
  return normalizePdfCategory(value).toLocaleLowerCase("pt-BR");
}
export function pdfBaseIdentity(name: string, category: string) {
  return pdfCategoryKey(category) === pdfCategoryKey(UNCATEGORIZED_PDFS)
    ? name
    : JSON.stringify([
        pdfCategoryKey(category),
        name.normalize("NFC").toLocaleLowerCase("pt-BR"),
      ]);
}
