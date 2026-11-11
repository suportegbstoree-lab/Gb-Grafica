import React from "react";
import EditorModal from "./EditorModal";

export default function StaffPdfImportTable({
  name,
  headers,
  rows,
  barcodeColumn,
  nameColumn,
  onRevise,
  onDownload,
  onClose,
}: {
  name: string;
  headers: string[];
  rows: { index: number; cells: string[] }[];
  barcodeColumn: number;
  nameColumn: number;
  onRevise: (
    index: number,
    cells: string[] | null,
    pastedColumn?: number,
  ) => Promise<void>;
  onDownload: () => void;
  onClose: () => void;
}) {
  const [page, setPage] = React.useState(0);
  const [columnPage, setColumnPage] = React.useState(0);
  const [editing, setEditing] = React.useState<{
    index: number;
    cells: string[];
  }>();
  const [removing, setRemoving] = React.useState<number>();
  const [notice, setNotice] = React.useState("");
  const [applying, setApplying] = React.useState(false);
  const applyingRef = React.useRef(false);
  const counts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const { cells } of rows) {
      const code = cells[barcodeColumn]?.trim();
      if (code) map.set(code, (map.get(code) || 0) + 1);
    }
    return map;
  }, [rows, barcodeColumn]);
  const repeated = rows.filter(
    ({ cells }) => (counts.get(cells[barcodeColumn]?.trim()) || 0) > 1,
  ).length;
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const currentPage = Math.min(page, pages - 1);
  const columnPages = Math.max(1, Math.ceil(headers.length / 16));
  const columns = headers.slice(columnPage * 16, (columnPage + 1) * 16);
  const button =
    "rounded-lg border border-gray-700 px-3 py-2 text-sm disabled:opacity-40";
  async function copy(value: string, header: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`Valor de ${header} copiado.`);
    } catch {
      setNotice("O navegador bloqueou a cópia da célula.");
    }
  }
  async function apply(
    index: number,
    cells: string[] | null,
    pasteName = false,
  ) {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    setNotice("");
    try {
      if (pasteName && cells) {
        let text: string;
        try {
          text = (await navigator.clipboard.readText())
            .trim()
            .replace(/\r\n?/g, "\n");
        } catch {
          throw new Error(
            "O navegador bloqueou a leitura da área de transferência. Permita o acesso ou use Editar linha.",
          );
        }
        if (!text) throw new Error("A área de transferência está vazia.");
        if (text.length > 500 || /[\x00-\x08\x0b-\x1f\x7f]/.test(text))
          throw new Error(
            "O nome copiado precisa ter até 500 caracteres de texto.",
          );
        cells = [...cells];
        cells[nameColumn] = text;
      }
      await onRevise(index, cells, pasteName ? nameColumn : undefined);
      setEditing(undefined);
      setRemoving(undefined);
      if (!cells)
        setPage(
          Math.min(
            currentPage,
            Math.max(0, Math.ceil((rows.length - 1) / 50) - 1),
          ),
        );
      setNotice(
        pasteName
          ? "Nome colado e salvo."
          : cells
            ? "Linha atualizada."
            : "Linha excluída.",
      );
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  }
  return (
    <EditorModal
      wide
      title="Planilha dos pedidos importados"
      busy={applying}
      onClose={onClose}
      closeLabel="Fechar planilha importada"
      doneLabel="Fechar"
      footerText=""
      footerActions={
        <button
          type="button"
          className={button}
          disabled={applying || !!editing || removing !== undefined}
          onClick={() => {
            try {
              onDownload();
            } catch (error) {
              setNotice((error as Error).message);
            }
          }}
        >
          Baixar CSV revisado
        </button>
      }
    >
      <p className="break-words text-sm">{name}</p>
      <p className="my-3 text-sm text-gray-300">
        {rows.length} registro(s) · {repeated} com código repetido.
        {repeated > 0 &&
          " Os destaques identificam entregas com mais de um item."}
      </p>
      <p role="status" className="mb-3 text-sm text-gray-300">
        {notice}
      </p>
      <div className="max-h-[55vh] overflow-auto rounded-lg border border-gray-700">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-[#17191f]">
            <tr>
              <th scope="col" className="p-2">
                Linha
              </th>
              {columns.map((header, index) => (
                <th scope="col" key={index} className="min-w-36 p-2">
                  {header}
                </th>
              ))}
              <th scope="col" className="p-2">
                Entrega
              </th>
              <th scope="col" className="p-2">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {rows
              .slice(currentPage * 50, (currentPage + 1) * 50)
              .map(({ index, cells }) => {
                const count = counts.get(cells[barcodeColumn]?.trim()) || 0;
                const draft = editing?.index === index ? editing : undefined;
                return (
                  <tr
                    key={index}
                    className={`border-t border-gray-800 ${count > 1 ? "bg-pink-500/15" : ""}`}
                  >
                    <th scope="row" className="p-2 font-normal">
                      {index + 1}
                    </th>
                    {columns.map((header, column) => {
                      const position = columnPage * 16 + column;
                      const value = cells[position] ?? "";
                      return (
                        <td
                          key={column}
                          className="max-w-sm whitespace-pre-wrap break-words p-2"
                        >
                          {draft ? (
                            <textarea
                              rows={2}
                              disabled={applying}
                              aria-label={`${header}, linha ${index + 1}`}
                              className="w-full rounded-lg border border-gray-700 bg-black p-2"
                              value={draft.cells[position] ?? ""}
                              onChange={(e) => {
                                const next = draft.cells.slice();
                                next[position] = e.target.value;
                                setEditing({ index, cells: next });
                              }}
                            />
                          ) : position === nameColumn ? (
                            value.trim() ? (
                              value
                            ) : (
                              <button
                                type="button"
                                title="Colar nome da área de transferência"
                                aria-label={`Colar nome na linha ${index + 1}`}
                                disabled={
                                  applying ||
                                  !!editing ||
                                  removing !== undefined
                                }
                                className="cursor-pointer text-amber-300 hover:underline disabled:opacity-40"
                                onClick={() => void apply(index, cells, true)}
                              >
                                Em branco
                              </button>
                            )
                          ) : value ? (
                            <button
                              type="button"
                              title={`Copiar ${header}`}
                              disabled={applying}
                              className="max-w-full cursor-copy whitespace-pre-wrap break-words text-left hover:underline"
                              onClick={() => void copy(value, header)}
                            >
                              {value}
                            </button>
                          ) : (
                            <span className="text-amber-300">Em branco</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="p-2">
                      {count > 1 ? (
                        <span className="font-semibold text-pink-300">
                          Código repetido · {count} itens
                        </span>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className="min-w-32 space-y-2 p-2">
                      {draft ? (
                        <>
                          <button
                            type="button"
                            className={button}
                            disabled={applying}
                            onClick={() => void apply(index, draft.cells)}
                          >
                            Salvar linha
                          </button>
                          <button
                            type="button"
                            className={button}
                            disabled={applying}
                            onClick={() => setEditing(undefined)}
                          >
                            Cancelar
                          </button>
                        </>
                      ) : removing === index ? (
                        <>
                          <button
                            type="button"
                            className={button}
                            disabled={applying}
                            onClick={() => void apply(index, null)}
                          >
                            Confirmar exclusão
                          </button>
                          <button
                            type="button"
                            className={button}
                            disabled={applying}
                            onClick={() => setRemoving(undefined)}
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={button}
                            disabled={
                              applying || !!editing || removing !== undefined
                            }
                            onClick={() => {
                              setNotice("");
                              setEditing({ index, cells: cells.slice() });
                            }}
                          >
                            Editar linha
                          </button>
                          <button
                            type="button"
                            className={button}
                            disabled={
                              applying || !!editing || removing !== undefined
                            }
                            onClick={() => {
                              setNotice("");
                              setRemoving(index);
                            }}
                          >
                            Excluir linha
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={button}
          disabled={
            applying || !currentPage || !!editing || removing !== undefined
          }
          onClick={() => setPage(currentPage - 1)}
        >
          Linhas anteriores
        </button>
        <span className="text-sm">
          Página {currentPage + 1} de {pages}
        </span>
        <button
          type="button"
          className={button}
          disabled={
            applying ||
            currentPage + 1 >= pages ||
            !!editing ||
            removing !== undefined
          }
          onClick={() => setPage(currentPage + 1)}
        >
          Próximas linhas
        </button>
        {columnPages > 1 && (
          <>
            <button
              type="button"
              className={button}
              disabled={applying || !columnPage}
              onClick={() => setColumnPage(columnPage - 1)}
            >
              Colunas anteriores
            </button>
            <span className="text-sm">
              Colunas {columnPage * 16 + 1} a{" "}
              {Math.min(headers.length, (columnPage + 1) * 16)}
            </span>
            <button
              type="button"
              className={button}
              disabled={applying || columnPage + 1 >= columnPages}
              onClick={() => setColumnPage(columnPage + 1)}
            >
              Próximas colunas
            </button>
          </>
        )}
      </div>
    </EditorModal>
  );
}
