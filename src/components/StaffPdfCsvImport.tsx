import React from "react";
import { staffTrackingBarcode } from "../lib/staffPdfBarcode";
import type { StaffPdfLibrary } from "../services/staffPdfService";
import {
  defaultStaffPdfCsvColumns,
  expandStaffPdfQuantities,
  readStaffPdfCsv,
  resolveStaffPdfCsvModel,
  staffPdfNameColumn,
  staffPdfQuantityColumn,
} from "../lib/staffPdfCsv";
import { excelColumn, selectedColumnsCsv } from "../lib/spreadsheetCsv";
import { downloadPersonalization } from "../services/personalizationExport";
import { layoutFont } from "../lib/staffPdf";
import type { PersonalizationFont } from "../lib/textCustomization";
import StaffPdfImportTable from "./StaffPdfImportTable";
import StaffSpreadsheetCsv, { type StaffWorkbookDraft } from "./StaffSpreadsheetCsv";
import StaffSpreadsheetPicker from "./StaffSpreadsheetPicker";
import { useStaffPdfDraft } from "../services/staffPdfLocalState";

export interface StaffPdfCsvOrder {
  baseId: string;
  layoutId: string;
  text: string;
  barcode: string;
  csvRow: {
    sourceId: string;
    index: number;
    textColumn?: number;
    textWarnings?: { blank: string; filled: string };
  };
  csvWarning: string;
}
export interface StaffPdfCsvImportHandle {
  updateText(row: StaffPdfCsvOrder["csvRow"], text: string): void;
}
export interface StaffPdfCsvNamePaste {
  column: number;
  text: string;
  mappedTextColumn: number;
  textWarnings: (
    column: number,
  ) => NonNullable<StaffPdfCsvOrder["csvRow"]["textWarnings"]>;
}
const input = "min-w-0 w-full rounded-lg border border-gray-700 bg-black p-2";
interface CsvDraft {
  source?: {
    id: string;
    name: string;
    rows: (string[] | null)[];
    width: number;
    separator: string;
    quantityColumn?: number;
    ignoredColumns?: number[];
    workbookId?: string;
  };
  hasHeader: boolean;
  columns: ReturnType<typeof defaultStaffPdfCsvColumns>;
  overrides: Record<number, { baseId: string; layoutId: string }>;
  codes: Record<number, string>;
  added: number[];
}
const emptyDraft: CsvDraft = {
  hasHeader: true,
  columns: { text: -1, template: -1, reference: -1 },
  overrides: {},
  codes: {},
  added: [],
};

function blankWarning(fields: string[]) {
  const shown = fields.slice(0, 8).map((header) => header.slice(0, 80));
  return (
    shown.join(", ") +
    (fields.length > shown.length
      ? ` e mais ${fields.length - shown.length} coluna(s)`
      : "")
  );
}

export default function StaffPdfCsvImport({
  ref,
  data,
  fonts,
  busy,
  visible,
  fallback,
  onAdd,
  onReviewQueue,
  onReviseRow,
  reviewRequest,
  storageOwner,
  queuedRows,
}: {
  ref?: React.Ref<StaffPdfCsvImportHandle>;
  data: StaffPdfLibrary;
  fonts: PersonalizationFont[];
  busy: boolean;
  visible: boolean;
  fallback: { baseId: string; layoutId: string };
  onAdd: (orders: StaffPdfCsvOrder[]) => Promise<void>;
  onReviewQueue: () => void;
  onReviseRow: (
    row: StaffPdfCsvOrder["csvRow"],
    replacement?: StaffPdfCsvOrder,
    pastedName?: StaffPdfCsvNamePaste,
  ) => Promise<boolean>;
  reviewRequest: number;
  storageOwner?: string;
  queuedRows: ReadonlySet<string>;
}) {
  const csv = useStaffPdfDraft(storageOwner, "csv", emptyDraft);
  const workbook = useStaffPdfDraft<StaffWorkbookDraft | null>(storageOwner, "workbook", null);
  const { source, hasHeader, columns, overrides, codes } = csv.value;
  const [table, setTable] = React.useState(false),
    [page, setPage] = React.useState(0),
    [message, setMessage] = React.useState(""),
    [error, setError] = React.useState(""),
    [reading, setReading] = React.useState(false);
  const lastReview = React.useRef(0);
  React.useEffect(() => {
    if (reviewRequest !== lastReview.current && source) {
      lastReview.current = reviewRequest;
      setTable(true);
    }
  }, [reviewRequest, source]);
  const block = busy || reading || !csv.ready || !workbook.ready;
  const resolveModel = React.useMemo(() => {
    const models = new Map<string, ReturnType<typeof resolveStaffPdfCsvModel>>();
    return (name: string) => {
      if (!models.has(name)) {
        models.set(name, resolveStaffPdfCsvModel(name, data.bases, data.layouts));
      }
      return models.get(name);
    };
  }, [data.bases, data.layouts, source?.id]);
  React.useImperativeHandle(
    ref,
    () => ({
      updateText({ sourceId, index, textColumn }, text) {
        if (textColumn === undefined) return;
        void csv.save((current) => {
          const source = current.source;
          const row = source?.rows[index];
          if (source?.id !== sourceId || !row || textColumn >= source.width)
            return current;
          const cells = [...row];
          cells[textColumn] = text;
          const rows = [...source.rows];
          rows[index] = cells;
          return { ...current, source: { ...source, rows } };
        });
      },
    }),
    [],
  );
  async function useCsv(input: string, name: string, separator?: string, workbookId?: string) {
    const parsed = readStaffPdfCsv(input, separator);
    const [header, ...records] = parsed.rows;
    const columns = defaultStaffPdfCsvColumns(header);
    const nameColumn = staffPdfNameColumn(header);
    const quantityColumn = staffPdfQuantityColumn(header);
    const rows = [header, ...expandStaffPdfQuantities(records, quantityColumn)];
    if (nameColumn >= 0)
      for (const cells of rows.slice(1)) cells[nameColumn] = "";
    const source = {
      id: crypto.randomUUID(),
      name,
      rows,
      width: Math.max(...rows.map((row) => row.length)),
      separator: parsed.separator,
      quantityColumn,
      workbookId,
    };
    await csv.save(() => ({
      ...emptyDraft, source, columns,
      hasHeader: quantityColumn >= 0 || Object.values(columns).some((value) => value >= 0),
    }));
    setPage(0);
    setMessage("");
    setError("");
  }
  const headerIndex = source?.rows.findIndex((row) => row !== null) ?? -1;
  const quantityColumn = hasHeader ? source?.quantityColumn ?? -1 : -1;
  const headers = source
    ? Array.from(
        { length: source.width },
        (_, index) =>
          (hasHeader && source.rows[headerIndex]?.[index]?.trim()) ||
          `Coluna ${excelColumn(index)}`,
      )
    : [];
  React.useEffect(() => {
    if (!source?.ignoredColumns || !hasHeader) return;
    void csv.save((current) => {
      if (current.source?.id !== source.id || !current.source.ignoredColumns) return current;
      const { ignoredColumns, ...restored } = current.source;
      const header = restored.rows[headerIndex] || [];
      const model = header.findIndex((cell) => cell.trim().toLowerCase() === "modelo");
      // Older XLSX drafts kept their SKU in modelo while af_clean was blank.
      if (restored.workbookId && model >= 0 && ignoredColumns.length) {
        restored.rows = restored.rows.map((row, index) => {
          if (!row || index === headerIndex || !row[model]) return row;
          const cells = [...row];
          for (const column of ignoredColumns) cells[column] ||= row[model];
          return cells;
        });
      }
      return { ...current, source: restored };
    });
  }, [source, hasHeader, headerIndex]);
  const imported =
    source?.rows.flatMap((row, index) =>
      row && !(hasHeader && index === headerIndex) ? [{ row, index }] : [],
    ) ?? [];
  const added = new Set(csv.value.added);
  const pending = imported.filter(({ index }) =>
    !added.has(index) && !queuedRows.has(`${source?.id}:${index}`),
  );
  const transferred = imported.length > 0 && pending.length === 0;
  const handedOffWorkbook = !busy && transferred && source?.workbookId;
  React.useEffect(() => {
    if (handedOffWorkbook && workbook.value?.id === handedOffWorkbook) {
      void workbook.save((current) => current?.id === handedOffWorkbook ? null : current);
    }
  }, [handedOffWorkbook, workbook.value?.id]);
  const barcodeIndex =
    (hasHeader
      ? source?.rows[headerIndex]?.findIndex((header) =>
          /^(barcode|rastreio|numero.?de.?rastreio|n[oº°]?.?de.?rastreio|tracking)$/i.test(
            header
              .normalize("NFD")
              .replace(/\p{M}/gu, "")
              .trim()
              .replace(/[ _]+/g, ""),
          ),
        )
      : -1) ?? -1;
  const getBarcode = (row: string[], index: number) =>
    (codes[index] ?? row[barcodeIndex] ?? "").trim();
  const lastPage = Math.max(0, Math.ceil(pending.length / 50) - 1);
  const pageIndex = Math.min(page, lastPage);
  function rowWarnings(row: string[], barcode: string, textColumn: number) {
    const missingFields = (blankText: boolean) =>
      headers.filter(
        (_, column) =>
          column === textColumn
            ? blankText
            : !(column === barcodeIndex ? barcode : row[column]?.trim()),
      );
    return {
      blank: blankWarning(missingFields(true)),
      filled: blankWarning(missingFields(false)),
    };
  }
  function inspectRow(
    row: string[],
    index: number,
    barcode: string,
    override?: { baseId: string; layoutId: string },
  ) {
    const text = (row[columns.text] || "").replace(/\r\n?/g, "\n").trim();
    const template = row[columns.template]?.trim() || "";
    const model =
      override ??
      (template
        ? resolveModel(template)
        : fallback);
    const base = data.bases.find((base) => base.id === model?.baseId);
    const mold = data.layouts.find((mold) => mold.id === model?.layoutId);
    const reference = row[columns.reference]?.trim() || String(index + 1);
    const textWarnings = rowWarnings(row, barcode, columns.text);
    return {
      index,
      template,
      reference,
      baseId: base?.id || "",
      layoutId: mold?.id || "",
      text,
      barcode,
      csvRow: {
        sourceId: source!.id,
        index,
        textColumn: columns.text,
        textWarnings,
      },
      csvWarning: textWarnings[text ? "filled" : "blank"],
      missingFont:
        mold?.layout.font_name && !layoutFont(mold.layout, fonts)
          ? mold.layout.font_name
          : "",
      issue:
        columns.text < 0
          ? "Escolha a coluna de texto."
          : text.length > 500
            ? "O texto excede 500 caracteres."
            : !base || !mold
              ? "Confira a base e o molde."
              : barcode && !staffTrackingBarcode(barcode)
                ? "Informe um número de rastreio válido."
                : "",
    };
  }
  const preview = pending
    .slice(pageIndex * 50, (pageIndex + 1) * 50)
    .map(({ row, index }) =>
      inspectRow(row, index, getBarcode(row, index), overrides[index]),
    );
  async function addOrders() {
    setError("");
    const orders = pending
      .map(({ row, index }) => inspectRow(row, index, getBarcode(row, index), overrides[index]))
      .filter((row) => !row.issue);
    if (!orders.length) {
      setError("Revise os pedidos pendentes antes de adicionar à fila.");
      return;
    }
    try {
      await onAdd(orders);
      await csv.save((current) => ({
        ...current,
        added: [...new Set([...current.added, ...orders.map((row) => row.index)])],
      }));
      setMessage(`${orders.length} pedido(s) adicionado(s) à fila principal.`);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function reviseRow(
    index: number,
    cells: string[] | null,
    pastedColumn?: number,
  ) {
    if (!source || block) throw new Error("Aguarde a operação atual.");
    const sameModel =
      cells &&
      cells[columns.template] === source.rows[index]?.[columns.template];
    const barcode =
      cells?.[barcodeIndex < 0 ? source.width : barcodeIndex]?.trim() || "";
    const pastedName =
      cells && pastedColumn !== undefined
        ? {
            column: pastedColumn,
            text: cells[pastedColumn],
            mappedTextColumn: columns.text,
            textWarnings: (column: number) =>
              rowWarnings(cells, barcode, column),
          }
        : undefined;
    const order =
      cells && !pastedName
        ? inspectRow(
            cells,
            index,
            barcode,
            sameModel ? overrides[index] : undefined,
          )
        : undefined;
    const updated = await onReviseRow(
      { sourceId: source.id, index },
      order && !order.issue ? order : undefined,
      pastedName,
    );
    await csv.save((current) => {
      if (current.source?.id !== source.id) return current;
      const rows = current.source.rows.map((row, i) => {
        if (i !== index) return row;
        if (pastedName && row) {
          const next = [...row];
          next[pastedName.column] = pastedName.text;
          return next;
        }
        return cells?.slice(0, source.width) ?? null;
      });
      const overrides = { ...current.overrides };
      const codes = { ...current.codes };
      if (!pastedName) {
        if (!sameModel) delete overrides[index];
        delete codes[index];
        if (cells && barcodeIndex < 0) codes[index] = cells[source.width] ?? "";
      }
      const added = new Set(current.added);
      if (updated) added.add(index);
      else added.delete(index);
      return { ...current, source: { ...current.source, rows }, overrides, codes, added: [...added] };
    });
    setMessage(
      cells
        ? updated
          ? "Linha e pedido na fila atualizados."
          : "Linha corrigida. Confira o pedido na lista de pendentes."
        : "Linha excluída da importação.",
    );
  }
  function downloadReviewed() {
    if (!source) return;
    const includeBarcode =
      barcodeIndex < 0 &&
      imported.some(({ row, index }) => getBarcode(row, index));
    const width = source.width + (includeBarcode ? 1 : 0);
    if (width * imported.length > 10 * 1024 * 1024)
      throw new Error(
        "O CSV revisado excede o limite de colunas e linhas para exportar.",
      );
    const rows = source.rows.flatMap((row, index) => {
      if (!row) return [];
      const cells = row.slice();
      if (hasHeader && index === headerIndex) {
        if (includeBarcode) cells[source.width] = "barcode";
      } else {
        if (barcodeIndex >= 0 || includeBarcode) {
          cells[barcodeIndex < 0 ? source.width : barcodeIndex] = getBarcode(
            row,
            index,
          );
        }
      }
      return [cells];
    });
    const csv = selectedColumnsCsv(
      rows,
      Array.from({ length: width }, (_, index) => index),
      source.separator,
    );
    downloadPersonalization(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `${source.name.replace(/\.csv$/i, "")}-revisado.csv`,
    );
  }
  return (
    <section className="space-y-4">
      <StaffSpreadsheetCsv onUseCsv={useCsv} layouts={data.layouts}
        draft={workbook.value} save={workbook.save} disabled={block} />
      <section className="space-y-4 rounded-2xl border border-gray-800 p-5">
        <div>
          <h3 className="text-lg font-bold">Importar pedidos do CSV</h3>
          <p className="text-sm text-gray-400">
            Cada registro usa o texto e o modelo da planilha para montar um
            pedido na fila principal.
          </p>
        </div>
        <StaffSpreadsheetPicker format="CSV" disabled={block} onFile={async (file) => {
          setReading(true);
          setError("");
          try {
            if (file.size > 10 * 1024 * 1024)
              throw new Error("Envie um CSV de até 10 MB.");
            await useCsv(await file.text(), file.name);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setReading(false);
          }
        }} />
        {(error || csv.error || workbook.error) && (
          <p role="alert" className="text-red-300">
            {error || csv.error || workbook.error}
          </p>
        )}
        {message && (
          <p role="status" className="text-green-300">
            {message}
          </p>
        )}
        {source && (
          <fieldset disabled={block} className="min-w-0 space-y-4">
            <legend className="mb-2 break-all text-sm font-bold">
              {source.name}
            </legend>
            <button
              type="button"
              className="rounded-lg border border-gray-700 px-3 py-2 text-sm"
              onClick={() => setTable(true)}
            >
              Visualizar planilha importada
            </button>
            {transferred ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>Planilha enviada à fila para revisão.</span>
                <button type="button" className="rounded-lg border border-gray-700 px-4 py-2"
                  onClick={onReviewQueue}>Revisar fila principal</button>
              </div>
            ) : <>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => {
                  const checked = e.target.checked;
                  void csv.save((current) => ({
                    ...current, hasHeader: checked,
                    columns: checked
                      ? defaultStaffPdfCsvColumns(source.rows[headerIndex] || [])
                      : current.columns,
                  }));
                }}
              />
              A primeira linha é o cabeçalho
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["text", "template", "reference"] as const).map((field) => (
                <label key={field} className="text-sm">
                  {
                    {
                      text: "Coluna do texto",
                      template: "Coluna do modelo",
                      reference: "Coluna da referência",
                    }[field]
                  }
                  <select
                    className={input}
                    value={columns[field]}
                    onChange={(e) => {
                      const column = Number(e.target.value);
                      void csv.save((current) => ({
                        ...current, columns: { ...current.columns, [field]: column },
                      }));
                    }}
                  >
                    <option value={-1}>
                      {field === "template"
                        ? "Usar base e molde do pedido aberto"
                        : "Selecione a coluna"}
                    </option>
                    {headers.map((header, index) => (
                      <option key={index} value={index}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-400">
              Quando a coluna do modelo estiver vazia, é usada a base
              selecionada em Edição e fila. Confira as associações antes de
              adicionar.
            </p>
            {!!preview.length && (
              <div className="max-h-[30rem] overflow-auto rounded-lg border border-gray-800">
                <table className="w-full min-w-[44rem] table-fixed text-left text-sm">
                  <thead className="sticky top-0 bg-gray-950">
                    <tr>
                      <th className="w-28 p-2">Registro</th>
                      <th className="p-2">Texto</th>
                      <th className="p-2">Base</th>
                      <th className="p-2">Molde</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr
                        key={row.index}
                        className="border-t border-gray-800 align-top"
                      >
                        <td className="break-words p-2">
                          #{row.index + 1}
                          <br />
                          {row.reference}
                        </td>
                        <td className="whitespace-pre-wrap break-words p-2">
                          {row.text || "—"}
                          <label className="mt-2 block text-xs">
                            Rastreio
                            <input
                              className={input}
                              maxLength={80}
                              value={codes[row.index] ?? row.barcode}
                              aria-label={`Rastreio do registro ${row.index + 1}`}
                              onChange={(e) => {
                                const code = e.target.value;
                                void csv.save((current) => ({
                                  ...current, codes: { ...current.codes, [row.index]: code },
                                }));
                              }}
                            />
                          </label>
                          {row.issue && (
                            <p className="text-xs text-amber-300">
                              {row.issue}
                            </p>
                          )}
                          {row.csvWarning && (
                            <p className="text-xs text-amber-300">
                              Campos em branco: {row.csvWarning}.
                            </p>
                          )}
                          {row.missingFont && (
                            <p className="text-xs text-amber-300">
                              Fonte {row.missingFont} não encontrada. Será usada
                              a fonte padrão do sistema.
                            </p>
                          )}
                        </td>
                        <td className="p-2">
                          <select
                            className={input}
                            aria-label={`Base do registro ${row.index + 1}`}
                            value={row.baseId}
                            onChange={(e) => {
                              const id = e.target.value;
                              const base = data.bases.find(
                                (item) => item.id === id,
                              );
                              const layout =
                                base &&
                                resolveStaffPdfCsvModel(
                                  base.name,
                                  [base],
                                  data.layouts,
                                );
                              void csv.save((current) => ({ ...current, overrides: {
                                ...current.overrides,
                                [row.index]: {
                                  baseId: id,
                                  layoutId: layout?.layoutId || "",
                                },
                              } }));
                            }}
                          >
                            <option value="">
                              {row.template || "Selecione a base"}
                            </option>
                            {data.bases.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2">
                          <select
                            className={input}
                            aria-label={`Molde do registro ${row.index + 1}`}
                            value={row.layoutId}
                            onChange={(e) => {
                              const layoutId = e.target.value;
                              void csv.save((current) => ({ ...current, overrides: {
                                ...current.overrides,
                                [row.index]: {
                                  baseId: row.baseId,
                                  layoutId,
                                },
                              } }));
                            }}
                          >
                            <option value="">Selecione o molde</option>
                            {data.layouts.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>{pending.length} pendente(s)</span>
              {lastPage > 0 && (
                <>
                  <button
                    type="button"
                    disabled={!pageIndex}
                    onClick={() => setPage(pageIndex - 1)}
                  >
                    Anteriores
                  </button>
                  <span>
                    {pageIndex + 1} de {lastPage + 1}
                  </span>
                  <button
                    type="button"
                    disabled={pageIndex === lastPage}
                    onClick={() => setPage(pageIndex + 1)}
                  >
                    Próximos
                  </button>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!pending.length}
                className="rounded-lg bg-pink-600 px-4 py-2 font-bold disabled:opacity-40"
                onClick={() => void addOrders()}
              >
                Enviar todos os pedidos válidos à fila
              </button>
              <button
                type="button"
                className="rounded-lg border border-gray-700 px-4 py-2"
                onClick={onReviewQueue}
              >
                Revisar fila principal
              </button>
            </div>
            </>}
          </fieldset>
        )}
      </section>
      {visible && table && source && (
        <StaffPdfImportTable
          name={source.name}
          onClose={() => setTable(false)}
          headers={barcodeIndex < 0 ? [...headers, "Rastreio"] : headers}
          barcodeColumn={barcodeIndex < 0 ? headers.length : barcodeIndex}
          quantityColumn={quantityColumn}
          nameColumn={staffPdfNameColumn(headers)}
          onRevise={reviseRow}
          onDownload={downloadReviewed}
          rows={imported.map(({ row, index }) => {
            const cells = [...row];
            cells[barcodeIndex < 0 ? headers.length : barcodeIndex] =
              getBarcode(row, index);
            return { index, cells };
          })}
        />
      )}
    </section>
  );
}
