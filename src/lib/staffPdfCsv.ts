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
    field();
    if (row.some((value) => value.trim())) rows.push(row);
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

export function parseStaffPdfCsv(input: string, separator?: string) {
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
  return rows;
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
    ]),
    template: find([
      "template",
      "modelo",
      "tema",
      "ae",
      "sku",
      "af_clean",
      "af",
      "arte",
      "design",
    ]),
    reference: find([
      "pedido_plataforma",
      "numero_pedido_plataforma",
      "pedido",
      "order",
      "order_id",
      "order_number",
      "codigo",
      "serial",
      "rastreio",
      "barcode",
      "tracking",
    ]),
  };
}

export function resolveStaffPdfCsvModel(
  value: string,
  bases: StaffPdfBase[],
  layouts: StaffPdfLayoutView[],
) {
  const exact = key(value);
  if (!exact) return;
  const stem = (name: string) => key(name).replace(/_template(?:_\d+p)?$/, "");
  const candidates = bases.filter((base) => stem(base.name) === stem(value));
  const internal = candidates.filter((base) => base.source === "internal");
  const choices = internal.length ? internal : candidates;
  if (choices.length !== 1) return;
  const [base] = choices;
  const variant = /_template(?:_(\d+)p)?$/.exec(exact);
  const named = variant
    ? layouts.filter((layout) => key(layout.name) === exact)
    : [];
  const layout =
    variant &&
    named.length === 1 &&
    (!variant[1] || Number(variant[1]) === base.pageCount)
      ? named[0]
      : matchPdfLayout(base.name, base.pageCount, layouts);
  return { baseId: base.id, layoutId: layout?.id || "" };
}
