import {
  matchPdfLayout,
  staffPdfSourceName,
  type StaffPdfBase,
  type StaffPdfLayoutView,
} from "./staffPdf.js";

const separators = [";", ",", "\t", "|"];
const MAX_CSV_RECORDS = 10_000;

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
  const rows = readRows(csv, separator, MAX_CSV_RECORDS + 2);
  if (rows.length > MAX_CSV_RECORDS + 1)
    throw new Error("O CSV excede 10.000 registros.");
  if (!rows.length) throw new Error("O CSV está vazio.");
  return { rows, separator };
}

export function parseStaffPdfCsv(input: string, separator?: string) {
  return readStaffPdfCsv(input, separator).rows;
}

function key(value: string) {
  return value
    .trim()
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
      "base",
      "af_clean",
      "base_pdf",
      "nome_base",
      "nome_da_base",
      "tema",
      "ae",
      "sku",
      "modelo_do_sku",
      "sku_do_produto",
      "af",
      "arte",
      "design",
      "nome_do_produto",
      "produto",
    ]),
    reference:
      staffOrderColumn(headers) >= 0
        ? staffOrderColumn(headers)
        : find(["codigo", "serial", "rastreio", "barcode", "tracking"]),
  };
}

export function staffPdfNameColumn(headers: string[]) {
  return headers.findIndex((header) => key(header) === "nome");
}

const nameParticles = new Set(["da", "das", "de", "do", "dos", "e"]);

export function formatStaffPdfPersonName(value: string) {
  return value.toLocaleLowerCase("pt-BR").replace(
    /(\p{L})[\p{L}\p{M}]*/gu,
    (word, first: string, offset: number, line: string) =>
      nameParticles.has(word) && /\S/.test(line.slice(line.lastIndexOf("\n", offset) + 1, offset))
        ? word
        : first.toLocaleUpperCase("pt-BR") + word.slice(first.length),
  );
}

export function expandStaffPdfQuantities(
  rows: string[][],
  quantityColumn: number,
  firstRow = 2,
) {
  if (quantityColumn < 0) return rows;
  const expanded: string[][] = [];
  for (const [index, row] of rows.entries()) {
    const value = row[quantityColumn]?.trim() || "";
    const quantity = value ? Number(value.replace(",", ".")) : 1;
    if ((value && !/^\d+(?:[.,]0+)?$/.test(value)) ||
      !Number.isSafeInteger(quantity) || quantity < 1) {
      throw new Error(`Informe uma quantidade inteira maior que zero na linha ${firstRow + index}.`);
    }
    if (expanded.length + quantity > MAX_CSV_RECORDS)
      throw new Error("O CSV excede 10.000 registros após separar as quantidades.");
    if (quantity === 1) expanded.push(row);
    else {
      for (let copy = 0; copy < quantity; copy++) {
        const unit = row.slice();
        unit[quantityColumn] = "1";
        expanded.push(unit);
      }
    }
  }
  return expanded;
}

const modelStem = (name: string) =>
  key(name).replace(/_template(?:_\d+p)?$/, "");

const modelPageCount = (normalizedName: string) =>
  Number(/_template_(\d+)p$/.exec(normalizedName)?.[1]) || undefined;

const withoutNameOption = (value: string) =>
  value.trim().replace(/[\s_-]+(?:com|sem)[\s_-]+nome(?:\.pdf)?$/i, "");

function csvModelStem(value: string) {
  return modelStem(withoutNameOption(value))
    .replace(/(?:^|_)(?:de|da|do|das|dos)(?=_|$)/g, "")
    .replace(/(^|_)receitas(?=_|$)/g, "$1receita")
    .replace(/^_/, "");
}

export function createStaffSkuMatcher(layouts: StaffPdfLayoutView[]) {
  const candidates = layouts
    .flatMap(({ name, layout, previousNames = [] }) => [name, ...previousNames].map(alias => ({
      name: layout.base_pdf_name ? name : name.replace(/_template(?:__?\d+p)?$/i, ""),
      match: modelStem(alias),
      explicit: key(alias),
    })))
    .filter((item) => item.match)
    .sort((a, b) => b.match.length - a.match.length)
    .map((item) => ({
      ...item,
      pattern: new RegExp(`(?:^|_)${item.match}(?:_|$)`),
    }));
  return (value: string) => {
    const label = value.trim();
    if (withoutNameOption(label) !== label) return label;
    const sku = key(label);
    const explicit = candidates.find((item) => item.explicit === sku);
    if (explicit) return explicit.name;
    const hits = candidates.filter(({ pattern }) => pattern.test(sku));
    if (!hits.length) return label;
    const top = hits.filter(
      (item) => item.match.length === hits[0].match.length,
    );
    return new Set(top.map((item) => item.name)).size === 1
      ? top[0].name
      : label;
  };
}

const quantityHeaders = [
  "quantidade_de_itens",
  "quantidade_itens",
  "qtd_do_produto",
  "quantidade",
];

export const STAFF_SHEET_FIELDS = [
  {
    key: "modelo",
    label: "SKU",
    aliases: ["sku", "sku_do_produto", "modelo_do_sku", "modelo", "base", "af_clean"],
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
    aliases: quantityHeaders,
  },
] as const;
export type StaffSheetField = (typeof STAFF_SHEET_FIELDS)[number]["key"];
export function staffPdfObservationColumn(headers: string[]) {
  return headers.findIndex(header => ["observacao", "observacoes"].includes(key(header)));
}

export function staffPdfDeadlineColumn(headers: string[]) {
  return headers.findIndex(header => STAFF_SHEET_FIELDS[2].aliases.some(alias => alias === key(header)));
}

const deadlineDay = 86400000;
const saoPauloDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
export function staffPdfDeadline(value: string) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/.exec(value.trim());
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/.exec(value.trim());
  if (!iso && !br) return undefined;
  const [year, month, day] = (iso ? iso.slice(1) : [br![3], br![2], br![1]]).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.getTime();
}

export function staffPdfDaysToDeadline(value: string, now = new Date()) {
  const due = staffPdfDeadline(value);
  return due === undefined ? undefined : (due - staffPdfDeadline(saoPauloDay.format(now))!) / deadlineDay;
}

export function staffPdfQuantityColumn(headers: string[]) {
  return headers.findIndex((header) => quantityHeaders.includes(key(header)));
}

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

function resolveExactModel(
  value: string,
  bases: StaffPdfBase[],
  layouts: StaffPdfLayoutView[],
) {
  const exact = key(value);
  if (!exact) return;
  const current = layouts.filter((layout) => key(layout.name) === exact);
  const named = current.length ? current : layouts.filter(layout => layout.previousNames?.some(name => key(name) === exact));
  const associated =
    named.length === 1 ? named[0].layout.base_pdf_name : undefined;
  const associatedId = named.length === 1 ? named[0].layout.base_id : undefined;
  const matchesName = (name: string) => associated
    ? key(name) === key(associated)
    : modelStem(name) === modelStem(value);
  const candidates = bases.filter((base) =>
    associatedId ? base.id === associatedId : matchesName(staffPdfSourceName(base)),
  );
  const matching = candidates.length || associatedId
    ? candidates
    : bases.filter((base) => matchesName(base.name));
  const internal = matching.filter((base) => base.source === "internal");
  const choices = internal.length ? internal : matching;
  if (!choices.length) return;
  if (choices.length !== 1) return null;
  const [base] = choices;
  const variantPages = modelPageCount(exact);
  const sourceName = staffPdfSourceName(base);
  const layout = named.length === 1 &&
    (!variantPages || variantPages === base.pageCount)
    ? named[0]
    : matchPdfLayout(sourceName, base.pageCount, layouts, base.id);
  if (layout) return { baseId: base.id, layoutId: layout.id };

  const stem = csvModelStem(sourceName);
  const equivalent = layouts.filter((mold) => {
    const pages = modelPageCount(key(mold.name));
    return (
      csvModelStem(mold.name) === stem &&
      (!pages || pages === base.pageCount) &&
      (mold.layout.base_id
        ? mold.layout.base_id === base.id
        : !mold.layout.base_pdf_name ||
          key(mold.layout.base_pdf_name) === key(sourceName))
    );
  });
  const sized = equivalent.filter(
    (mold) => modelPageCount(key(mold.name)) === base.pageCount,
  );
  const compatible = sized.length ? sized : equivalent;
  return {
    baseId: base.id,
    layoutId: compatible.length === 1 ? compatible[0].id : "",
  };
}

export function resolveStaffPdfCsvModel(
  value: string,
  bases: StaffPdfBase[],
  layouts: StaffPdfLayoutView[],
) {
  const name = withoutNameOption(value);
  const exact = resolveExactModel(name, bases, layouts);
  if (exact !== undefined) return exact ?? undefined;

  const stem = csvModelStem(name);
  if (!stem) return;
  const aliases = new Set([
    ...bases.flatMap((base) => [base.name, staffPdfSourceName(base)]),
    ...layouts
      .filter(({ layout }) => layout.base_id || layout.base_pdf_name)
      .flatMap(({ name, previousNames = [] }) => [name, ...previousNames]),
  ]);
  let longest = 0;
  let matches: string[] = [];
  for (const alias of aliases) {
    const prefix = csvModelStem(alias);
    if (!prefix || (stem !== prefix && !stem.startsWith(prefix + "_"))) continue;
    if (prefix.length > longest) {
      longest = prefix.length;
      matches = [];
    }
    if (prefix.length === longest) matches.push(alias);
  }

  const resolved = matches.map((alias) =>
    resolveExactModel(alias, bases, layouts),
  );
  if (resolved.some((match) => match === null)) return;
  const choices = resolved.filter((match) => match != null);
  const baseIds = new Set(choices.map((match) => match.baseId));
  const layoutIds = new Set(
    choices.map((match) => match.layoutId).filter(Boolean),
  );
  if (baseIds.size !== 1 || layoutIds.size > 1) return;
  return { baseId: choices[0].baseId, layoutId: [...layoutIds][0] ?? "" };
}
