import React from "react";
import {
  parseStaffXlsx,
  selectedColumnsCsv,
  excelColumn,
  type StaffWorkbook,
} from "../lib/spreadsheetCsv";
import { downloadPersonalization } from "../services/personalizationExport";
export default function StaffSpreadsheetCsv() {
  const [book, setBook] = React.useState<StaffWorkbook | null>(null),
    [sheet, setSheet] = React.useState(0),
    [columns, setColumns] = React.useState<number[]>([]),
    [start, setStart] = React.useState(1),
    [separator, setSeparator] = React.useState(";"),
    [error, setError] = React.useState(""),
    [name, setName] = React.useState("planilha"),
    [busy, setBusy] = React.useState(false);
  const current = book?.sheets[sheet];
  const load = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (!/\.xlsx$/i.test(file.name) || file.size > 10 * 1024 * 1024)
        throw new Error("Selecione um XLSX de até 10 MB.");
      const result = parseStaffXlsx(new Uint8Array(await file.arrayBuffer()));
      setBook(result);
      setSheet(0);
      setColumns(Array.from({ length: result.sheets[0].columns }, (_, i) => i));
      setName(file.name.replace(/\.xlsx$/i, ""));
      setStart(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4 rounded-2xl border border-gray-800 p-5">
      <h3 className="text-lg font-bold">Converter XLSX para CSV</h3>
      <p className="text-sm text-gray-400">
        Escolha a aba e as colunas. A conversão acontece neste navegador; a
        planilha não é enviada ao servidor. Fórmulas usam o valor salvo no
        arquivo. Datas são exportadas no formato ISO; códigos com máscara de
        zeros preservam os zeros.
      </p>
      <label className="block text-sm">
        Arquivo XLSX
        <input
          disabled={busy}
          type="file"
          accept=".xlsx"
          onChange={(e) => {
            void load(e.target.files?.[0]);
            e.target.value = "";
          }}
          className="mt-2 block max-w-full"
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
          <div className="grid gap-4 sm:grid-cols-3">
            <label>
              Aba
              <select
                aria-label="Aba da planilha"
                value={sheet}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  setSheet(i);
                  setColumns(
                    Array.from(
                      { length: book!.sheets[i].columns },
                      (_, c) => c,
                    ),
                  );
                }}
                className="block w-full rounded-lg bg-black p-2"
              >
                {book!.sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Primeira linha exportada
              <input
                aria-label="Primeira linha exportada"
                type="number"
                min={1}
                max={Math.max(1, current.rows.length)}
                value={start}
                onChange={(e) => setStart(Number(e.target.value))}
                className="block w-full rounded-lg bg-black p-2"
              />
            </label>
            <label>
              Separador
              <select
                aria-label="Separador CSV"
                value={separator}
                onChange={(e) => setSeparator(e.target.value)}
                className="block w-full rounded-lg bg-black p-2"
              >
                <option value=";">Ponto e vírgula</option>
                <option value=",">Vírgula</option>
                <option value={"\t"}>Tabulação</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() =>
                setColumns(Array.from({ length: current.columns }, (_, i) => i))
              }
            >
              Selecionar todas
            </button>
            <button onClick={() => setColumns([])}>Limpar seleção</button>
            <span className="text-gray-400">
              {current.rows.length} linhas · {columns.length} colunas
              selecionadas
            </span>
          </div>
          <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
            {Array.from({ length: current.columns }, (_, i) => (
              <label
                key={i}
                className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-800 p-2"
              >
                <input
                  type="checkbox"
                  checked={columns.includes(i)}
                  onChange={(e) =>
                    setColumns((old) =>
                      e.target.checked
                        ? [...old, i].sort((a, b) => a - b)
                        : old.filter((c) => c !== i),
                    )
                  }
                />
                <span className="truncate">
                  {excelColumn(i)} · {current.rows[0]?.[i] || "Sem cabeçalho"}
                </span>
              </label>
            ))}
          </div>
          <button
            disabled={!columns.length}
            className="rounded-xl bg-pink-500 px-5 py-3 font-bold disabled:opacity-40"
            onClick={() => {
              try {
                if (start < 1 || start > current.rows.length)
                  throw new Error("Linha inicial inválida.");
                downloadPersonalization(
                  new Blob(
                    [
                      selectedColumnsCsv(
                        current.rows,
                        columns,
                        separator,
                        start - 1,
                      ),
                    ],
                    { type: "text/csv;charset=utf-8" },
                  ),
                  `${name}-${current.name}.csv`,
                );
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Baixar CSV selecionado
          </button>
        </>
      )}
    </section>
  );
}
