import { validAlphabet, type DecorativeAlphabet } from './decorativeInitial';
export interface ProductPdfTemplate {
  alphabet?: DecorativeAlphabet;
  id: string;
  path: string;
  name: string;
  pages: string[];
}
export function isTemplatePath(
  value: unknown,
  productId: string,
): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{1,100}$/.test(productId) &&
    new RegExp(`^catalog/templates/${productId}/[a-f0-9]{32}\\.pdf$`).test(
      value,
    )
  );
}
export function validPdfTemplates(
  value: unknown,
  productId: string,
  gallery: string[],
): value is ProductPdfTemplate[] {
  return (
    Array.isArray(value) &&
    value.length <= 25 &&
    new Set(value.map((t) => t?.id)).size === value.length &&
    value.every(
      (t) =>
        t &&
        typeof t.id === "string" &&
        /^[a-f0-9]{32}$/.test(t.id) &&
        isTemplatePath(t.path, productId) &&
        t.path.endsWith(`/${t.id}.pdf`) &&
        typeof t.name === "string" &&
        t.name.length > 0 && t.name.length <= 120 &&
        (t.alphabet === undefined || validAlphabet(t.alphabet, t.name, productId)) &&
        Array.isArray(t.pages) &&
        t.pages.length >= 1 &&
        t.pages.length <= 2 &&
        t.pages.every(
          (page: unknown) => typeof page === "string" && gallery.includes(page),
        ),
    )
  );
}
