type TextFragment = { str: string; transform: number[]; width: number };
export interface LabelProduct {
  sku: string;
  description: string;
  variation: string;
  quantity: number;
}
export interface LabelPage {
  products: LabelProduct[];
  issue?: string;
}

const normalize = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
/** Read the goods table in its own coordinate system, including sideways declarations. */
export function parseLabelPage(fragments: TextFragment[]): LabelPage {
  const words = fragments.filter((word) => word.str.trim());
  const result: LabelPage = { products: [] };
  const pending = (issue: string): LabelPage => ({ ...result, products: [], issue });
  const headers = words.filter((word) => normalize(word.str) === "sku");
  if (headers.length !== 1)
    return pending(
      headers.length > 1
        ? "Há mais de uma tabela de produtos nesta página."
        : "Tabela de produtos sem texto legível ou em outro formato.",
    );
  const head = headers[0],
    [a, b] = head.transform;
  const scale = Math.hypot(a, b);
  if (!scale) return pending("Orientação da tabela ilegível.");
  const dx = a / scale,
    dy = b / scale;
  const points = words
    .filter((w) => {
      const [wa, wb] = w.transform;
      return wa * dx + wb * dy > 0.99 * Math.hypot(wa, wb);
    })
    .map((w) => {
      const x = w.transform[4] - head.transform[4],
        y = w.transform[5] - head.transform[5];
      return { text: w.str.trim(), x: x * dx + y * dy, y: x * dy - y * dx, width: w.width };
    });
  const header = points.filter((p) => Math.abs(p.y) <= scale * 0.65);
  const columns = [/^(n|no|numero)$/, /^sku$/, /^descricao$/, /^variacao$/, /^(qtd|quantidade)$/].map(
    (pattern) => header.find((p) => pattern.test(normalize(p.text))),
  );
  if (columns.some((c, i) => !c || (i > 0 && c.x <= columns[i - 1].x)))
    return pending("Cabeçalho da tabela de produtos incompleto.");
  const [number, sku, description, variation, quantity] = columns;
  const slack = scale * 0.6;
  const region = points.filter(
    (p) =>
      p.x >= number.x - slack && p.x <= quantity.x + quantity.width + 3 * scale && p.y > scale * 0.65,
  );
  const footer = region
    .filter((p) => /^total$/i.test(p.text) && p.x >= variation.x - slack)
    .sort((a, b) => a.y - b.y)[0];
  if (!footer) return pending("Fim da tabela de produtos não identificado.");
  const body = region.filter((p) => p.y < footer.y - slack);
  const starts = body
    .filter((p) => p.x < sku.x - slack && /^\d+$/.test(p.text))
    .sort((a, b) => a.y - b.y);
  if (!starts.length) return pending("Nenhum item legível na tabela.");
  for (const [index, start] of starts.entries()) {
    if (Number(start.text) !== index + 1) return pending("Numeração dos itens incompleta.");
    const row = body
      .filter((p) => p.y >= start.y - slack && (!starts[index + 1] || p.y < starts[index + 1].y - slack))
      .sort((a, b) => (Math.abs(a.y - b.y) < slack ? a.x - b.x : a.y - b.y));
    const cell = (left: number, right: number, separator = " ") =>
      row
        .filter((p) => p.x >= left - slack && p.x < right - slack)
        .map((p) => p.text)
        .join(separator);
    const units = cell(quantity.x, Infinity);
    const product = {
      sku: cell(sku.x, description.x, ""),
      description: cell(description.x, variation.x),
      variation: cell(variation.x, quantity.x),
      quantity: Number(units),
    };
    if (
      (!product.sku && !product.description) ||
      !/^\d+$/.test(units) ||
      !Number.isSafeInteger(product.quantity) ||
      product.quantity < 1 ||
      product.quantity > 10000
    )
      return pending("Produto ou quantidade ilegível na tabela.");
    result.products.push(product);
  }
  const total = region.find(
    (p) => p.x >= quantity.x - slack && Math.abs(p.y - footer.y) < slack && /^\d+$/.test(p.text),
  );
  if (total && Number(total.text) !== result.products.reduce((sum, p) => sum + p.quantity, 0))
    return pending("A quantidade lida difere do total da etiqueta.");
  return result;
}

export interface LabelCategory {
  id: string;
  name: string;
}
export interface LabelCategoryDirectory {
  categories: LabelCategory[];
  assignments: Record<string, string>;
}
export interface LabelCategoryApi {
  archive: LabelArchiveApi;
  rename(id: string, expectedName: string, name: string): Promise<void>;
  remove(id: string, expectedName: string): Promise<void>;
  lookup(keys: string[]): Promise<LabelCategoryDirectory>;
  create(name: string): Promise<LabelCategory>;
  assign(key: string, categoryId: string): Promise<void>;
}

type ProductIdentityFields = Pick<LabelProduct, "sku" | "description" | "variation">;
export interface ImportedProduct extends ProductIdentityFields {
  key: string;
}
export interface ImportedLabel {
  number?: number;
  products: ImportedProduct[];
  issue?: string;
}
export interface LabelImport {
  id: string;
  name: string;
  importedAt: number;
  pages: ImportedLabel[];
  // Snapshot of the confirmed categories used when this PDF was completed.
  completed?: Record<string, string>;
}
export function labelProductIdentity(product: ProductIdentityFields) {
  const sku = product.sku.trim().normalize("NFC").toUpperCase();
  const normalized = (v: string) =>
    v.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("pt-BR");
  return JSON.stringify(
    sku ? ["sku", sku] : ["descricao", normalized(product.description), normalized(product.variation)],
  );
}

export async function labelDigest(bytes: Uint8Array<ArrayBuffer>) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function identifyProduct(
  product: ProductIdentityFields,
  cache = new Map<string, string>(),
): Promise<ImportedProduct> {
  const identity = labelProductIdentity(product);
  let key = cache.get(identity);
  if (!key) {
    key = await labelDigest(new TextEncoder().encode(identity));
    cache.set(identity, key);
  }
  return { sku: product.sku, description: product.description, variation: product.variation, key };
}
export function missingLabelCategories(pages: ImportedLabel[], assignments: Record<string, string>) {
  return pages.filter(
    (page) => page.issue || !page.products.length || page.products.some((p) => !assignments[p.key]),
  ).length;
}

export interface LabelArchiveHeader {
  id: string;
  revision: string;
  name: string;
  importedAt: number;
  total: number;
  count: number;
  state: "uploading" | "ready" | "deleting";
  confirmed: boolean;
}
export type LabelArchiveRef = Pick<LabelArchiveHeader, "id" | "revision">;
export interface LabelTransferPage {
  number: number;
  label: ImportedLabel;
  data?: string;
  parts?: number;
}
export interface LabelArchiveApi {
  list(): Promise<LabelArchiveHeader[]>;
  read(ref: LabelArchiveRef): Promise<ImportedLabel[]>;
  begin(id: string, name: string, total: number): Promise<LabelArchiveHeader>;
  upload(ref: LabelArchiveRef, pages: LabelTransferPage[]): Promise<void>;
  part(ref: LabelArchiveRef, number: number, part: number, data: string): Promise<void>;
  identify(ref: LabelArchiveRef, number: number, products: ImportedProduct[]): Promise<void>;
  confirm(ref: LabelArchiveRef): Promise<void>;
  links(ref: LabelArchiveRef, numbers: number[]): Promise<string[]>;
  remove(ref: LabelArchiveRef, number?: number): Promise<void>;
}
