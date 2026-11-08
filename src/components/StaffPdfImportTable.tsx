import React from "react";
import EditorModal from "./EditorModal";

export default function StaffPdfImportTable({
  name,
  headers,
  rows,
  barcodeColumn,
  onClose,
}: {
  name: string;
  headers: string[];
  rows: readonly (readonly string[])[];
  barcodeColumn: number;
  onClose: () => void;
}) {
  const [page, setPage] = React.useState(0);
  const [columnPage, setColumnPage] = React.useState(0);
  const counts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const code = row[barcodeColumn]?.trim();
      if (code) map.set(code, (map.get(code) || 0) + 1);
    }
    return map;
  }, [rows, barcodeColumn]);
  const repeated = rows.filter(
    (row) => (counts.get(row[barcodeColumn]?.trim()) || 0) > 1,
  ).length;
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const columnPages = Math.max(1, Math.ceil(headers.length / 16));
  const columns = headers.slice(columnPage * 16, (columnPage + 1) * 16);
  const button =
    "rounded-lg border border-gray-700 px-3 py-2 text-sm disabled:opacity-40";
  return (
    <EditorModal
      wide
      title="Planilha dos pedidos importados"
      onClose={onClose}
      closeLabel="Fechar planilha importada"
      doneLabel="Fechar"
      footerText=""
    >
      <p className="break-words text-sm">{name}</p>
      <p className="my-3 text-sm text-gray-300">
        {rows.length} registro(s) · {repeated} com código repetido.
        {repeated > 0 &&
          " Os destaques identificam entregas com mais de um item."}
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
            </tr>
          </thead>
          <tbody>
            {rows.slice(page * 50, (page + 1) * 50).map((row, index) => {
              const count = counts.get(row[barcodeColumn]?.trim()) || 0;
              return (
                <tr
                  key={page * 50 + index}
                  className={`border-t border-gray-800 ${count > 1 ? "bg-pink-500/15" : ""}`}
                >
                  <th scope="row" className="p-2 font-normal">
                    {page * 50 + index + 1}
                  </th>
                  {columns.map((_, column) => (
                    <td
                      key={column}
                      className="max-w-sm whitespace-pre-wrap break-words p-2"
                    >
                      {row[columnPage * 16 + column] || ""}
                    </td>
                  ))}
                  <td className="p-2">
                    {count > 1 ? (
                      <span className="font-semibold text-pink-300">
                        Código repetido · {count} itens
                      </span>
                    ) : (
                      ""
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
          disabled={!page}
          onClick={() => setPage(page - 1)}
        >
          Linhas anteriores
        </button>
        <span className="text-sm">
          Página {page + 1} de {pages}
        </span>
        <button
          type="button"
          className={button}
          disabled={page + 1 >= pages}
          onClick={() => setPage(page + 1)}
        >
          Próximas linhas
        </button>
        {columnPages > 1 && (
          <>
            <button
              type="button"
              className={button}
              disabled={!columnPage}
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
              disabled={columnPage + 1 >= columnPages}
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
