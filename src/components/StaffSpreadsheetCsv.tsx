import React from "react";
import StaffSpreadsheetPicker from "./StaffSpreadsheetPicker";
import {
  parseStaffXlsx,
  selectedColumnsCsv,
  excelColumn,
  type StaffWorkbook,
} from "../lib/spreadsheetCsv";
import {
  createStaffSkuMatcher,
  expandStaffPdfQuantities,
  staffOrderColumn,
  staffPdfMarketplaceColumn,
  staffSheetColumn,
  STAFF_SHEET_FIELDS,
  type StaffSheetField,
} from "../lib/staffPdfCsv";
import type { StaffPdfLayoutView } from "../lib/staffPdf";
import { downloadPersonalization } from "../services/personalizationExport";

const field =
  "mt-1 block w-full rounded-lg border border-gray-700 bg-black p-2";
type Mapping = Record<StaffSheetField, string>;
export interface StaffWorkbookDraft {
  id: string;
  book: StaffWorkbook;
  name: string;
  sheet: number;
  start: number;
  mapping: Mapping;
  originOverride?: string;
}

export default function StaffSpreadsheetCsv({
  onUseCsv,
  layouts,
  draft,
  save,
  disabled,
}: {
  onUseCsv: (csv: string, name: string, separator: string, workbookId: string) => Promise<void>;
  layouts: StaffPdfLayoutView[];
  draft: StaffWorkbookDraft | null;
  save: (change: (previous: StaffWorkbookDraft | null) => StaffWorkbookDraft | null) => Promise<void>;
  disabled: boolean;
}) {
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const current = draft?.book.sheets[draft.sheet];
  const header = current?.rows[0] ?? [];
  const previousOrigin = draft?.mapping.origem ?? "";
  const previousColumn = staffSheetColumn(previousOrigin, current?.columns ?? 0, header);
  const originColumn = staffPdfMarketplaceColumn(header, previousColumn);
  const originMapping = draft?.originOverride ?? (
    previousColumn >= 0 && previousColumn === originColumn ? previousOrigin
      : originColumn >= 0 ? excelColumn(originColumn) : ""
  );

  function sheetSettings(workbook: StaffWorkbook, index: number) {
    const header = workbook.sheets[index].rows[0] ?? [];
    return {
      sheet: index,
      start: 2,
      originOverride: undefined,
      mapping: Object.fromEntries(
        STAFF_SHEET_FIELDS.map(({ key, aliases }) => {
          const normalize = (value: string) =>
            value
              .normalize("NFD")
              .replace(/\p{M}/gu, "")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_|_$/g, "");
          const found = key === "origem" ? staffPdfMarketplaceColumn(header) : header.findIndex((value) =>
            aliases.some((alias) => alias === normalize(value ?? "")),
          );
          return [key, found < 0 ? "" : excelColumn(found)];
        }),
      ) as Mapping,
    };
  }

  async function load(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (!/\.xlsx$/i.test(file.name) || file.size > 10 * 1024 * 1024)
        throw new Error("Selecione um XLSX de até 10 MB.");
      const result = parseStaffXlsx(new Uint8Array(await file.arrayBuffer()));
      await save(() => ({
        id: crypto.randomUUID(),
        book: result,
        name: file.name.replace(/\.xlsx$/i, ""),
        ...sheetSettings(result, 0),
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function convert(review: boolean) {
    if (!current || !draft) return;
    const { name, start, mapping } = draft;
    try {
      if (!Number.isInteger(start) || start < 1 || start > current.rows.length)
        throw new Error("Primeira linha de pedidos inválida.");
      const header = current.rows[0] ?? [];
      const orderIndex = staffOrderColumn(header);
      const entries = STAFF_SHEET_FIELDS.map(({ key, label }) => {
        const column = key === "origem" ? originMapping : mapping[key] ?? "";
        const index = staffSheetColumn(column, current.columns, header);
        if (
          (column.trim() || key === "modelo") && index < 0
        )
          throw new Error(`Informe uma coluna válida para ${label}.`);
        return [key, index] as const;
      });
      const columns = Object.fromEntries(entries) as Record<
        StaffSheetField,
        number
      >;
      const optional = (["prazo_envio", "quantidade_itens", "origem"] as const).filter(
        (key) => columns[key] >= 0,
      );
      const headers = [
        "pedido_plataforma",
        "barcode",
        "af_clean",
        "nome",
        ...optional,
      ];
      const match = createStaffSkuMatcher(layouts);
      const mapped = [orderIndex, ...Object.values(columns)].filter(
        (index) => index >= 0,
      );
      if (new Set(mapped).size !== mapped.length)
        throw new Error("Use uma coluna diferente para cada campo.");
      const data = current.rows.slice(start - 1)
        .filter((row) => row.some((cell) => cell.trim()));
      if (!data.length)
        throw new Error("Nenhum pedido encontrado nas linhas selecionadas.");
      const rows = expandStaffPdfQuantities(data, columns.quantidade_itens, start);
      const csv = selectedColumnsCsv(
        [
          headers,
          ...rows.map((row) => [
            row[orderIndex] ?? "",
            row[columns.barcode] ?? "",
            match(row[columns.modelo] ?? ""),
            row[columns.nome] ?? "",
            ...optional.map((key) => row[columns[key]] ?? ""),
          ]),
        ],
        headers.map((_, i) => i),
        ",",
      );
      const filename = `${name}-${current.name}.csv`;
      if (review) await onUseCsv(csv, filename, ",", draft.id);
      else
        downloadPersonalization(
          new Blob([csv], { type: "text/csv;charset=utf-8" }),
          filename,
        );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-gray-800 p-5">
      <h3 className="text-lg font-bold">Converter XLSX para CSV</h3>
      <StaffSpreadsheetPicker format="XLSX" disabled={disabled || busy} onFile={(file) => void load(file)} />
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {busy && <p role="status">Lendo planilha...</p>}
      {current && draft && (
        <fieldset className="space-y-4" disabled={disabled || busy}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              Aba
              <select
                aria-label="Aba da planilha"
                className={field}
                value={draft.sheet}
                onChange={(e) => {
                  const settings = sheetSettings(draft.book, Number(e.target.value));
                  void save((previous) => previous && { ...previous, ...settings });
                }}
              >
                {draft.book.sheets.map((item, i) => (
                  <option key={i} value={i}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Primeira linha de pedidos
              <input
                type="number"
                className={field}
                min={1}
                max={current.rows.length}
                value={draft.start}
                onChange={(e) => {
                  const start = Number(e.target.value);
                  void save((previous) => previous && { ...previous, start });
                }}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {STAFF_SHEET_FIELDS.map(({ key, label }) => (
              <label key={key} className="text-sm">
                {label}
                <input
                  className={field}
                  placeholder="Letra ou nome da coluna"
                  value={key === "origem" ? originMapping : draft.mapping[key] ?? ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    void save((previous) => previous && {
                      ...previous,
                      ...(key === "origem"
                        ? { originOverride: value }
                        : { mapping: { ...previous.mapping, [key]: value } }),
                    });
                  }}
                />
              </label>
            ))}
          </div>
          <p className="text-sm text-gray-400">
            Use a letra da coluna, como AF, ou o texto do cabeçalho. O número do
            pedido é lido pelo cabeçalho da planilha. No UpSeller, use a coluna Plataformas para separar TikTok e Shopee.
            Se você já preencheu os nomes para impressão no XLSX, indique a coluna em Nome para personalização.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-xl bg-pink-500 px-5 py-3 font-bold"
              onClick={() => void convert(true)}
            >
              Converter e revisar pedidos
            </button>
            <button
              className="rounded-xl border border-gray-700 px-5 py-3"
              onClick={() => void convert(false)}
            >
              Baixar CSV selecionado
            </button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
