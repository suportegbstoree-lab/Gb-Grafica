import {
  matchPdfLayout,
  type StaffPdfBase,
  type StaffPdfLayoutView,
} from "./staffPdf.js";

const separators = [";", ",", "\t", "|"];

function readRows(csv: string, separator: string, limit: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  function field() {
    if (row.length >= 16384) throw new Error("O CSV possui colunas demais.");
    row.push(cell);
    cell = "";
    closed = false;
  }
  function record() {
    const explicit = row.length > 0 || closed;
    field();
    if (explicit || row[0].trim()) rows.push(row);
    row = [];
  }
  for (let i = 0; i < csv.length && rows.length < limit; i++) {
    const char = csv[i];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (char === separator) field();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && csv[i + 1] === "\n") i++;
      record();
    } else if (closed) throw new Error("Há conteúdo fora das aspas no CSV.");
    else if (char === '"' && cell === "") quoted = true;
    else cell += char;
  }
  if (quoted) throw new Error("Há um campo sem aspas de fechamento no CSV.");
  if (rows.length < limit && (row.length || cell || closed)) record();
  return rows;
}

export function readStaffPdfCsv(input: string, separator?: string) {
  const csv = input.replace(/^\ufeff/, "");
  if (csv.length > 10 * 1024 * 1024)
    throw new Error("Envie um CSV de até 10 MB.");
  if (!separator) {
    const candidates = separators.map((value) => {
      try {
        const sample = readRows(csv, value, 12);
        const columns = sample[0]?.length || 0;
        const matches = sample.filter((row) => row.length === columns).length;
        return { value, score: columns > 1 ? matches : 0, columns };
      } catch {
        return { value, score: -1, columns: 0 };
      }
    });
    candidates.sort((a, b) => b.score - a.score || b.columns - a.columns);
    separator = candidates[0].value;
  }
  if (!separators.includes(separator))
    throw new Error("Separador CSV inválido.");
  const rows = readRows(csv, separator, 10002);
  if (rows.length > 10001) throw new Error("O CSV excede 10.000 registros.");
  if (!rows.length) throw new Error("O CSV está vazio.");
  return { rows, separator };
}

export function parseStaffPdfCsv(input: string, separator?: string) {
  return readStaffPdfCsv(input, separator).rows;
}

function key(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const orderHeaders = [
  "pedido_plataforma",
  "numero_pedido_plataforma",
  "n_de_pedido_da_plataforma",
  "no_de_pedido_da_plataforma",
  "numero_de_pedido_da_plataforma",
  "n_do_pedido_da_plataforma",
  "no_do_pedido_da_plataforma",
  "n_do_pedido",
  "no_do_pedido",
  "numero_do_pedido",
  "n_pedido",
  "no_pedido",
  "numero_pedido",
  "id_do_pedido",
  "pedido",
  "order",
  "order_id",
  "order_number",
];

export function staffOrderColumn(headers: string[]) {
  const names = headers.map(key);
  return (
    orderHeaders.map((name) => names.indexOf(name)).find((i) => i >= 0) ?? -1
  );
}

export function defaultStaffPdfCsvColumns(headers: string[]) {
  const names = headers.map(key);
  const find = (choices: string[]) =>
    choices
      .map((choice) => names.indexOf(choice))
      .find((index) => index >= 0) ?? -1;
  return {
    text: find([
      "texto_principal",
      "texto",
      "nome",
      "name",
      "destinatario",
      "cliente",
      "notas_do_comprador",
    ]),
    template: find([
      "template",
      "modelo",
      "tema",
      "ae",
      "sku",
      "modelo_do_sku",
      "sku_do_produto",
      "af_clean",
      "af",
      "arte",
      "design",
    ]),
    reference:
      staffOrderColumn(headers) >= 0
        ? staffOrderColumn(headers)
        : find(["codigo", "serial", "rastreio", "barcode", "tracking"]),
  };
}

export function staffSheetOrders(
  rows: string[][],
  columns: { reference: number; template: number; text: number },
  matchSku: (sku: string) => string,
) {
  const seen = new Set<string>();
  return rows
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => {
      const result = row.slice();
      const reference = row[columns.reference]?.trim();
      const sku = row[columns.template]?.trim() || "";
      if (reference && sku) {
        const key = JSON.stringify([reference, sku]);
        if (seen.has(key)) result[columns.text] = "";
        seen.add(key);
      }
      result[columns.template] = matchSku(sku);
      return result;
    });
}

const modelStem = (name: string) =>
  key(name).replace(/_template(?:_\d+p)?$/, "");

export function createStaffSkuMatcher(layouts: StaffPdfLayoutView[]) {
  const candidates = layouts
    .map(({ name, layout }) => ({
      name: layout.base_pdf_name
        ? name
        : name.replace(/_template(?:__?\d+p)?$/i, ""),
      match: modelStem(name),
      explicit: key(name),
    }))
    .filter((item) => item.match)
    .sort((a, b) => b.match.length - a.match.length)
    .map((item) => ({
      ...item,
      pattern: new RegExp(`(?:^|_)${item.match}(?:_|$)`),
    }));
  return (value: string) => {
    const sku = key(value);
    const explicit = candidates.find((item) => item.explicit === sku);
    if (explicit) return explicit.name;
    const hits = candidates.filter(({ pattern }) => pattern.test(sku));
    if (!hits.length) return value.trim();
    const top = hits.filter(
      (item) => item.match.length === hits[0].match.length,
    );
    return new Set(top.map((item) => item.name)).size === 1
      ? top[0].name
      : value.trim();
  };
}

export const STAFF_SHEET_FIELDS = [
  {
    key: "af_clean",
    label: "SKU",
    aliases: ["sku", "af_clean", "sku_do_produto", "modelo_do_sku"],
  },
  {
    key: "nome",
    label: "Notas do comprador",
    aliases: ["notas_do_comprador", "nota_do_comprador", "nome"],
  },
  {
    key: "barcode",
    label: "Número de rastreio",
    aliases: [
      "n_de_rastreio",
      "no_de_rastreio",
      "numero_de_rastreio",
      "numero_de_rastreamento",
      "barcode",
      "tracking_number",
    ],
  },
  {
    key: "prazo_envio",
    label: "Prazo de envio",
    aliases: ["prazo_de_envio", "prazo_envio", "data_limite_para_envio"],
  },
  {
    key: "quantidade_itens",
    label: "Quantidade de itens",
    aliases: [
      "quantidade_de_itens",
      "quantidade_itens",
      "qtd_do_produto",
      "quantidade",
    ],
  },
] as const;
export type StaffSheetField = (typeof STAFF_SHEET_FIELDS)[number]["key"];

export function staffSheetColumn(
  value: string,
  width: number,
  header: string[],
) {
  const field = value.trim();
  if (!field) return -1;
  const normalized = key(field);
  const matches = header.flatMap((name, index) =>
    key(name) === normalized ? [index] : [],
  );
  if (matches.length === 1) return matches[0];
  if (!/^[A-Za-z]{1,3}$/.test(field)) return -1;
  const column =
    [...field.toUpperCase()].reduce(
      (total, letter) => total * 26 + letter.charCodeAt(0) - 64,
      0,
    ) - 1;
  return column < width ? column : -1;
}

export function resolveStaffPdfCsvModel(
  value: string,
  bases: StaffPdfBase[],
  layouts: StaffPdfLayoutView[],
) {
  const exact = key(value);
  if (!exact) return;
  const named = layouts.filter((layout) => key(layout.name) === exact);
  const associated =
    named.length === 1 ? named[0].layout.base_pdf_name : undefined;
  const associatedId = named.length === 1 ? named[0].layout.base_id : undefined;
  const candidates = bases.filter((base) =>
    associatedId
      ? base.id === associatedId
      : associated
        ? key(base.name) === key(associated)
        : modelStem(base.name) === modelStem(value),
  );
  const internal = candidates.filter((base) => base.source === "internal");
  const choices = internal.length ? internal : candidates;
  if (choices.length !== 1) return;
  const [base] = choices;
  const variant = /_template(?:_(\d+)p)?$/.exec(exact);
  const layout =
    named.length === 1 &&
    (!variant?.[1] || Number(variant[1]) === base.pageCount)
      ? named[0]
      : matchPdfLayout(base.name, base.pageCount, layouts, base.id);
  return { baseId: base.id, layoutId: layout?.id || "" };
}
