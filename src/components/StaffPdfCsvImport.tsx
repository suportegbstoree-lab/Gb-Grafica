import React from "react";
import { staffTrackingBarcode } from "../lib/staffPdfBarcode";
import type { StaffPdfLibrary } from "../services/staffPdfService";
import {
  defaultStaffPdfCsvColumns,
  parseStaffPdfCsv,
  resolveStaffPdfCsvModel,
} from "../lib/staffPdfCsv";
import { excelColumn } from "../lib/spreadsheetCsv";
import { layoutFont } from "../lib/staffPdf";
import type { PersonalizationFont } from "../lib/textCustomization";
import StaffSpreadsheetCsv from "./StaffSpreadsheetCsv";

export interface StaffPdfCsvOrder {
  baseId: string;
  layoutId: string;
  text: string;
  barcode: string;
}
const input = "min-w-0 w-full rounded-lg border border-gray-700 bg-black p-2";

export default function StaffPdfCsvImport({
  data,
  fonts,
  available,
  busy,
  fallback,
  onAdd,
  onReviewQueue,
}: {
  data: StaffPdfLibrary;
  fonts: PersonalizationFont[];
  available: number;
  busy: boolean;
  fallback: { baseId: string; layoutId: string };
  onAdd: (orders: StaffPdfCsvOrder[]) => Promise<void>;
  onReviewQueue: () => void;
}) {
  const [source, setSource] = React.useState<{
      name: string;
      rows: string[][];
    }>(),
    [hasHeader, setHasHeader] = React.useState(true),
    [columns, setColumns] = React.useState({
      text: -1,
      template: -1,
      reference: -1,
    }),
    [overrides, setOverrides] = React.useState<
      Record<number, { baseId: string; layoutId: string }>
    >({}),
    [codes, setCodes] = React.useState<Record<number, string>>({}),
    [added, setAdded] = React.useState(new Set<number>()),
    [page, setPage] = React.useState(0),
    [message, setMessage] = React.useState(""),
    [error, setError] = React.useState(""),
    [reading, setReading] = React.useState(false);
  const block = busy || reading;
  function useCsv(csv: string, name: string, separator?: string) {
    const rows = parseStaffPdfCsv(csv, separator);
    const columns = defaultStaffPdfCsvColumns(rows[0]);
    const header = Object.values(columns).some((value) => value >= 0);
    setSource({ name, rows });
    setHasHeader(header);
    setColumns(columns);
    setAdded(new Set());
    setCodes({});
    setOverrides({});
    setPage(0);
    setMessage("");
    setError("");
  }
  const headers = source
    ? Array.from(
        { length: Math.max(...source.rows.map((row) => row.length)) },
        (_, index) =>
          hasHeader && source.rows[0][index]
            ? source.rows[0][index]
            : `Coluna ${excelColumn(index)}`,
      )
    : [];
  const pending =
    source?.rows
      .map((row, index) => ({ row, index }))
      .filter(
        ({ index }) => !(hasHeader && index === 0) && !added.has(index),
      ) ?? [];
  const lastPage = Math.max(0, Math.ceil(pending.length / 50) - 1);
  const pageIndex = Math.min(page, lastPage);
  const preview = pending
    .slice(pageIndex * 50, (pageIndex + 1) * 50)
    .map(({ row, index }) => {
      const text = (row[columns.text] || "").replace(/\r\n?/g, "\n").trim();
      const template = row[columns.template]?.trim() || "";
      const model =
        overrides[index] ??
        (template
          ? resolveStaffPdfCsvModel(template, data.bases, data.layouts)
          : fallback);
      const base = data.bases.find((base) => base.id === model?.baseId);
      const mold = data.layouts.find((mold) => mold.id === model?.layoutId);
      const reference = row[columns.reference]?.trim() || String(index + 1);
      const barcodeIndex =
        source?.rows[0].findIndex((header) =>
          /^(barcode|rastreio|numero.?de.?rastreio|n[oº°]?.?de.?rastreio|tracking)$/i.test(
            header
              .normalize("NFD")
              .replace(/\p{M}/gu, "")
              .trim()
              .replace(/[ _]+/g, ""),
          ),
        ) ?? -1;
      const barcode = (codes[index] ?? row[barcodeIndex] ?? "")
        .trim()
        .toUpperCase();
      return {
        index,
        template,
        reference,
        baseId: base?.id || "",
        layoutId: mold?.id || "",
        text,
        barcode,
        missingFont:
          mold?.layout.font_name && !layoutFont(mold.layout, fonts)
            ? mold.layout.font_name
            : "",
        issue: !text
          ? "Escolha a coluna de texto ou preencha o valor na planilha."
          : text.length > 500
            ? "O texto excede 500 caracteres."
            : !base || !mold
              ? "Confira a base e o molde."
              : !staffTrackingBarcode(barcode)
                ? "Informe um número de rastreio válido."
                : "",
      };
    });
  const ready = preview.filter((row) => !row.issue).slice(0, available);
  return (
    <section className="space-y-4">
      <StaffSpreadsheetCsv onUseCsv={useCsv} layouts={data.layouts} />
      <section className="space-y-4 rounded-2xl border border-gray-800 p-5">
        <div>
          <h3 className="text-lg font-bold">Importar pedidos do CSV</h3>
          <p className="text-sm text-gray-400">
            Cada registro usa o texto e o modelo da planilha para montar um
            pedido na fila principal.
          </p>
        </div>
        <label className="block text-sm">
          Arquivo CSV
          <input
            className="mt-2 block max-w-full"
            disabled={block}
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (!file) return;
              setReading(true);
              setError("");
              try {
                if (file.size > 10 * 1024 * 1024)
                  throw new Error("Envie um CSV de até 10 MB.");
                useCsv(await file.text(), file.name);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setReading(false);
              }
            }}
          />
        </label>
        {error && (
          <p role="alert" className="text-red-300">
            {error}
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
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => {
                  setHasHeader(e.target.checked);
                  if (e.target.checked)
                    setColumns(defaultStaffPdfCsvColumns(source.rows[0]));
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
                    onChange={(e) =>
                      setColumns({
                        ...columns,
                        [field]: Number(e.target.value),
                      })
                    }
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
                              maxLength={15}
                              value={codes[row.index] ?? row.barcode}
                              aria-label={`Rastreio do registro ${row.index + 1}`}
                              onChange={(e) =>
                                setCodes({
                                  ...codes,
                                  [row.index]: e.target.value.toUpperCase(),
                                })
                              }
                            />
                          </label>
                          {row.issue && (
                            <p className="text-xs text-amber-300">
                              {row.issue}
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
                              setOverrides({
                                ...overrides,
                                [row.index]: {
                                  baseId: id,
                                  layoutId: layout?.layoutId || "",
                                },
                              });
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
                            onChange={(e) =>
                              setOverrides({
                                ...overrides,
                                [row.index]: {
                                  baseId: row.baseId,
                                  layoutId: e.target.value,
                                },
                              })
                            }
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
              <span>
                {pending.length} pendente(s) · {available} vaga(s) na fila
              </span>
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
                disabled={!ready.length}
                className="rounded-lg bg-pink-600 px-4 py-2 font-bold disabled:opacity-40"
                onClick={async () => {
                  setError("");
                  try {
                    await onAdd(ready);
                    setAdded(
                      (old) =>
                        new Set([...old, ...ready.map((row) => row.index)]),
                    );
                    setMessage(
                      `${ready.length} pedido(s) adicionado(s) à fila principal.`,
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Adicionar {ready.length} pedido(s) da página à fila
              </button>
              <button
                type="button"
                className="rounded-lg border border-gray-700 px-4 py-2"
                onClick={onReviewQueue}
              >
                Revisar fila principal
              </button>
            </div>
          </fieldset>
        )}
      </section>
    </section>
  );
}
