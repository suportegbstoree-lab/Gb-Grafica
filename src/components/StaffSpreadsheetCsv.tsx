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
  staffSheetOrders,
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
  onUseCsv: (
    csv: string,
    name: string,
    separator: string,
    mapping: {
      reference: number;
      template: number;
      text: number;
      barcode: number;
    },
  ) => void;
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

  function convert(mode: "review" | "selected" | "all") {
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
      const mapped = [orderIndex, ...Object.values(columns)].filter(
        (index) => index >= 0,
      );
      if (new Set(mapped).size !== mapped.length)
        throw new Error("Use uma coluna diferente para cada campo.");
      const fields = {
        reference: orderIndex,
        template: columns.af_clean,
        text: columns.nome,
        barcode: columns.barcode,
      };
      const data = staffSheetOrders(
        current.rows.slice(start - 1),
        fields,
        match,
      );
      if (!data.length)
        throw new Error("Nenhum pedido encontrado nas linhas selecionadas.");
      const allColumns = mode !== "selected";
      const indexes = allColumns
        ? Array.from({ length: current.columns }, (_, i) => i)
        : headers.map((_, i) => i);
      if (indexes.length * data.length > 10 * 1024 * 1024)
        throw new Error("Divida a planilha em arquivos menores para exportar.");
      const output = allColumns
        ? [header, ...data]
        : [
            headers,
            ...data.map((row) =>
              [
                orderIndex,
                columns.barcode,
                columns.af_clean,
                columns.nome,
                ...optional.map((key) => columns[key]),
              ].map((index) => row[index] || ""),
            ),
          ];
      const csv = selectedColumnsCsv(output, indexes, ",");
      const filename = `${name}-${current.name}.csv`;
      if (mode === "review") onUseCsv(csv, filename, ",", fields);
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
              onClick={() => convert("review")}
            >
              Converter e revisar pedidos
            </button>
            <button
              className="rounded-xl border border-gray-700 px-5 py-3"
              onClick={() => convert("selected")}
            >
              Baixar CSV selecionado
            </button>
            <button
              className="rounded-xl border border-gray-700 px-5 py-3"
              onClick={() => convert("all")}
            >
              Baixar CSV com todas as colunas
            </button>
          </div>
        </>
      )}
    </section>
  );
}
