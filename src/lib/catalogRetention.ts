export const CATALOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const RETAINED_COLLECTIONS = [
  "anuncios",
  "categories",
  "promocoes",
  "config",
  "_staffPdfBases",
  "_staffPdfLayouts",
] as const;
export function isRetainedAssetPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    (/^catalog\/(products|categories|site|promotions)\/[A-Za-z0-9_-]{1,100}\/[a-f0-9]{32}\.(jpg|jpeg|png|webp)$/.test(
      path,
    ) ||
      /^catalog\/fonts\/[A-Za-z0-9_-]{1,100}\/[a-f0-9]{32}\.(woff2|ttf|otf)$/.test(
        path,
      ) ||
      /^catalog\/templates\/[A-Za-z0-9_-]{1,100}\/[a-f0-9]{32}\.pdf$/.test(
        path,
      ) ||
      /^staff-pdf-bases\/[a-f0-9]{32}\/(original\.pdf|upload\.pdf|(versions\/[a-f0-9]{32}\.pdf)|(letters\/[a-f0-9]{32}\.png))$/.test(
        path,
      ))
  );
}
export function retainedAssetPath(
  value: unknown,
  bucket: string,
): string | null {
  if (isRetainedAssetPath(value)) return value;
  if (typeof value !== "string" || !bucket) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    let path: string | undefined;
    if (url.hostname === "firebasestorage.googleapis.com") {
      const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
      if (match && decodeURIComponent(match[1]) === bucket)
        path = decodeURIComponent(match[2]);
    } else if (url.hostname === "storage.googleapis.com") {
      const prefix = `/${bucket}/`;
      if (url.pathname.startsWith(prefix))
        path = decodeURIComponent(url.pathname.slice(prefix.length));
    }
    return isRetainedAssetPath(path) ? path : null;
  } catch {
    return null;
  }
}
const assetKeys = new Set([
  "imagem",
  "imagens",
  "image",
  "images",
  "imagensPorAtributo",
  "imagensPorCombinacao",
  "imagensVariantes",
  "variantImages",
  "modelosPdf",
  "logo_url",
  "banner_principal",
  "icon",
  "path",
  "url",
  "arquivoUrl",
  "fonteArquivoUrl",
  "arquivoPath",
  "modeloPath",
  "contracapaPath",
  "contracapaOriginalPath",
  "inicialPath",
  "alphabet",
  "letters",
]);
export function retainedAssetPaths(data: unknown, bucket: string): Set<string> {
  const paths = new Set<string>();
  const visit = (value: unknown, capture = false, depth = 0) => {
    if (depth > 30) return;
    if (typeof value === "string") {
      if (capture) {
        const path = retainedAssetPath(value, bucket);
        if (path) paths.add(path);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, capture, depth + 1));
      return;
    }
    if (value && typeof value === "object")
      for (const [key, entry] of Object.entries(value))
        visit(entry, capture || assetKeys.has(key), depth + 1);
  };
  visit(data);
  return paths;
}
export function isRetainedSourcePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    new RegExp(
      `^(${[...RETAINED_COLLECTIONS, '_emailCampaigns'].join("|")})/[A-Za-z0-9_-]{1,160}$`,
    ).test(path)
  );
}
