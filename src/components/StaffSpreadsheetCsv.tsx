import React from "react";
import {
  parseStaffXlsx,
  selectedColumnsCsv,
  excelColumn,
  type StaffWorkbook,
} from "../lib/spreadsheetCsv";
import {
  createStaffSkuMatcher,
  staffOrderColumn,
  staffSheetColumn,
  STAFF_SHEET_FIELDS,
  type StaffSheetField,
} from "../lib/staffPdfCsv";
import type { StaffPdfLayoutView } from "../lib/staffPdf";
import { downloadPersonalization } from "../services/personalizationExport";

const field =
  "mt-1 block w-full rounded-lg border border-gray-700 bg-black p-2";
type Mapping = Record<StaffSheetField, string>;

export default function StaffSpreadsheetCsv({
  onUseCsv,
  layouts,
}: {
  onUseCsv: (csv: string, name: string, separator: string) => void;
  layouts: StaffPdfLayoutView[];
}) {
  const [book, setBook] = React.useState<StaffWorkbook | null>(null);
  const [sheet, setSheet] = React.useState(0);
  const [start, setStart] = React.useState(2);
  const [mapping, setMapping] = React.useState<Mapping>({
    af_clean: "",
    nome: "",
    barcode: "",
    prazo_envio: "",
    quantidade_itens: "",
  });
  const [error, setError] = React.useState("");
  const [name, setName] = React.useState("planilha");
  const [busy, setBusy] = React.useState(false);
  const current = book?.sheets[sheet];

  function useSheet(workbook: StaffWorkbook, index: number) {
    const header = workbook.sheets[index].rows[0] ?? [];
    setSheet(index);
    setStart(2);
    setMapping(
      Object.fromEntries(
        STAFF_SHEET_FIELDS.map(({ key, aliases }) => {
          const normalize = (value: string) =>
            value
              .normalize("NFD")
              .replace(/\p{M}/gu, "")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_|_$/g, "");
          const found = header.findIndex((value) =>
            aliases.some((alias) => alias === normalize(value)),
          );
          return [key, found < 0 ? "" : excelColumn(found)];
        }),
      ) as Mapping,
    );
  }

  async function load(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (!/\.xlsx$/i.test(file.name) || file.size > 10 * 1024 * 1024)
        throw new Error("Selecione um XLSX de até 10 MB.");
      const result = parseStaffXlsx(new Uint8Array(await file.arrayBuffer()));
      setBook(result);
      useSheet(result, 0);
      setName(file.name.replace(/\.xlsx$/i, ""));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function convert(useInQueue: boolean) {
    if (!current) return;
    try {
      if (!Number.isInteger(start) || start < 1 || start > current.rows.length)
        throw new Error("Primeira linha de pedidos inválida.");
      const header = current.rows[0] ?? [];
      const orderIndex = staffOrderColumn(header);
      const entries = STAFF_SHEET_FIELDS.map(({ key, label }) => {
        const index = staffSheetColumn(mapping[key], current.columns, header);
        if (
          (mapping[key].trim() || key === "af_clean" || key === "nome") &&
          index < 0
        )
          throw new Error(`Informe uma coluna válida para ${label}.`);
        return [key, index] as const;
      });
      const columns = Object.fromEntries(entries) as Record<
        StaffSheetField,
        number
      >;
      const optional = (["prazo_envio", "quantidade_itens"] as const).filter(
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
      const data = current.rows
        .slice(start - 1)
        .map((row) => [
          row[orderIndex] || "",
          row[columns.barcode] || "",
          match(row[columns.af_clean] || ""),
          row[columns.nome] || "",
          ...optional.map((key) => row[columns[key]] || ""),
        ])
        .filter((row) => row.some((cell) => cell.trim()));
      if (!data.length)
        throw new Error("Nenhum pedido encontrado nas linhas selecionadas.");
      const csv = selectedColumnsCsv(
        [headers, ...data],
        headers.map((_, i) => i),
        ",",
      );
      const filename = `${name}-${current.name}.csv`;
      if (useInQueue) onUseCsv(csv, filename, ",");
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
      <label className="block text-sm">
        Arquivo XLSX
        <input
          disabled={busy}
          type="file"
          accept=".xlsx"
          className="mt-2 block max-w-full"
          onChange={(e) => {
            void load(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {busy && <p role="status">Lendo planilha...</p>}
      {current && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              Aba
              <select
                aria-label="Aba da planilha"
                className={field}
                value={sheet}
                onChange={(e) => useSheet(book!, Number(e.target.value))}
              >
                {book!.sheets.map((item, i) => (
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
                value={start}
                onChange={(e) => setStart(Number(e.target.value))}
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
                  value={mapping[key]}
                  onChange={(e) =>
                    setMapping({ ...mapping, [key]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <p className="text-sm text-gray-400">
            Use a letra da coluna, como AF, ou o texto do cabeçalho. O número do
            pedido é lido pelo cabeçalho da planilha.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-xl bg-pink-500 px-5 py-3 font-bold"
              onClick={() => convert(true)}
            >
              Converter e revisar pedidos
            </button>
            <button
              className="rounded-xl border border-gray-700 px-5 py-3"
              onClick={() => convert(false)}
            >
              Baixar CSV selecionado
            </button>
          </div>
        </>
      )}
    </section>
  );
}
