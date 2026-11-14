import React from "react";
import { Download, Printer, TextCursorInput } from "lucide-react";
import { STAFF_PDF_BATCH_NAME_MAX } from "../lib/staffPdfBatch";
import { staffPdfOutputName } from "../lib/staffPdf";
import type {
  StaffPdfBatchApi,
  StaffPdfBatchItemView,
  StaffPdfBatchView,
} from "../lib/staffPdfBatch";
import { renderStaffPdfRecipe } from "../services/staffPdfBatchService";
import { downloadPersonalization } from "../services/personalizationExport";

const button =
  "rounded-lg border border-gray-700 px-3 py-2 text-sm disabled:opacity-40";
const iconButton = "inline-flex rounded-md p-2 text-gray-500 hover:text-[#ff4d79] disabled:opacity-40";
const searchable = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export default function StaffPdfBatches({
  api,
  revision,
}: {
  api: StaffPdfBatchApi;
  revision: number;
}) {
  const [batches, setBatches] = React.useState<StaffPdfBatchView[]>([]);
  const [items, setItems] = React.useState<
    Record<string, StaffPdfBatchItemView[]>
  >({});
  const [renaming, setRenaming] = React.useState<{ id: string; name: string }>();
  const [busy, setBusy] = React.useState(false);
  const [queries, setQueries] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState("");
  const [preview, setPreview] = React.useState<{ name: string; url: string }>();
  const alive = React.useRef(true),
    running = React.useRef(false);
  const reload = React.useCallback(async () => {
    const value = await api.list();
    if (alive.current) {
      setBatches(value.batches);
      setItems({});
      setQueries({});
    }
  }, [api]);
  React.useEffect(() => {
    alive.current = true;
    void reload().catch((e) => {
      if (alive.current) setError(e.message);
    });
    return () => {
      alive.current = false;
    };
  }, [reload, revision]);
  React.useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  async function run(fn: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function loadItems(id: string) {
    const value = await api.items(id);
    if (alive.current) setItems((old) => ({ ...old, [id]: value.items }));
    return value.items;
  }
  async function file(batchId: string, itemId: string) {
    const recipe = await api.recipe(batchId, itemId);
    const blob = await renderStaffPdfRecipe(recipe);
    if (recipe.item.status !== "ready") await api.complete(batchId, itemId);
    return { blob, name: `${recipe.item.outputName}.pdf` };
  }
  const visibleItems = Object.fromEntries(
    Object.entries<StaffPdfBatchItemView[]>(items).map(([id, rows]) => {
      const query = searchable(queries[id]?.trim() || "");
      return [
        id,
        rows.filter((item) =>
          searchable(`${item.outputName}.pdf`).includes(query),
        ),
      ];
    }),
  );
  return (
    <details className="rounded-2xl border border-gray-800 p-4">
      <summary className="cursor-pointer font-bold">
        Lotes anteriores · {batches.length}
      </summary>
      <div className="mt-4 space-y-3">
        <p className="text-sm text-gray-400">
          Os lotes ficam disponíveis por três dias para baixar e reimprimir.
        </p>
        <button
          className={button}
          disabled={busy}
          onClick={() => void run(reload)}
        >
          Atualizar lotes
        </button>
        {error && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}
        {batches.map((batch) => (
          <details
            key={batch.id}
            className="rounded-xl border border-gray-800 p-3"
            onToggle={(e) => {
              if (e.currentTarget.open && !items[batch.id])
                void run(async () => {
                  await loadItems(batch.id);
                });
            }}
          >
            <summary className="cursor-pointer text-sm">
              {batch.name || batch.reference} ·{" "}
              {new Date(batch.createdAt).toLocaleString("pt-BR")} ·{" "}
              {batch.count} arquivo(s)
            </summary>
            <p className="my-3 text-xs text-gray-400">
              Disponível até {new Date(batch.expiresAt).toLocaleString("pt-BR")}
            </p>
            {renaming?.id === batch.id ? (
              <form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const updated = await api.rename(batch.id, renaming.name);
                  if (!alive.current) return;
                  setBatches((current) => current.map((entry) => entry.id === batch.id ? updated : entry));
                  setRenaming(undefined);
                });
              }}>
                <label className="text-sm">
                  Novo nome do lote
                  <input className="mt-1 block rounded-lg border border-gray-700 bg-black p-2" maxLength={STAFF_PDF_BATCH_NAME_MAX}
                    disabled={busy} value={renaming.name}
                    onChange={(event) => setRenaming({ id: batch.id, name: event.target.value })} />
                </label>
                <button type="submit" className={button} disabled={busy}>Salvar nome</button>
                <button type="button" className={button} disabled={busy} onClick={() => setRenaming(undefined)}>Cancelar</button>
              </form>
            ) : (
              <button type="button" className={`${iconButton} mr-2`} disabled={busy}
                aria-label="Renomear lote" title="Renomear lote"
                onClick={() => setRenaming({ id: batch.id, name: batch.name || "" })}>
                <TextCursorInput size={16} aria-hidden="true" />
              </button>
            )}
            <button
              type="button" className={iconButton} aria-label="Baixar lote" title="Baixar lote"
              disabled={busy || !batch.count}
              onClick={() =>
                void run(async () => {
                  const rows = await loadItems(batch.id);
                  const files: Record<string, Uint8Array> = {};
                  let total = 0;
                  for (const item of rows) {
                    if (!alive.current) return;
                    const { blob, name } = await file(batch.id, item.id);
                    total += blob.size;
                    if (total > 200 * 1024 * 1024)
                      throw new Error(
                        "Este lote excede 200 MB. Baixe os PDFs individualmente.",
                      );
                    let filename = name;
                    let duplicate = 2;
                    while (Object.hasOwn(files, filename)) {
                      filename = `${name.replace(/\.pdf$/i, "")} (${duplicate++}).pdf`;
                    }
                    files[filename] = new Uint8Array(await blob.arrayBuffer());
                  }
                  const { zipSync } = await import("fflate");
                  downloadPersonalization(
                    new Blob([new Uint8Array(zipSync(files, { level: 0 }))], {
                      type: "application/zip",
                    }),
                    `${staffPdfOutputName(batch.name || "") || batch.reference}.zip`,
                  );
                })
              }
            >
              <Download size={16} aria-hidden="true" />
            </button>
            {items[batch.id] && (
              <label className="mt-3 block max-w-md text-sm">
                Buscar arquivo no lote
                <input
                  type="search"
                  aria-label={`Buscar arquivo em ${batch.name || batch.reference}`}
                  value={queries[batch.id] || ""}
                  onChange={(event) =>
                    setQueries({ ...queries, [batch.id]: event.target.value })
                  }
                  className="mt-1 block w-full rounded-lg border border-gray-700 bg-black p-2"
                  placeholder="Nome do arquivo"
                />
              </label>
            )}
            {queries[batch.id]?.trim() &&
              visibleItems[batch.id]?.length === 0 && (
                <p role="status" className="mt-3 text-sm text-gray-400">
                  Nenhum arquivo encontrado neste lote.
                </p>
              )}
            <ul className="mt-3 space-y-2">
              {(visibleItems[batch.id] || []).map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-2 border-t border-gray-800 pt-2"
                >
                  <span className="min-w-0 flex-1 break-words text-sm">
                    {item.outputName}.pdf
                  </span>
                  <button
                    type="button" className={iconButton} aria-label="Baixar" title="Baixar"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const value = await file(batch.id, item.id);
                        downloadPersonalization(value.blob, value.name);
                      })
                    }
                  >
                    <Download size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button" className={iconButton} aria-label="Reimprimir" title="Reimprimir"
                    disabled={busy}
                    onClick={() => {
                      const popup = window.open("about:blank", "_blank");
                      if (popup) popup.opener = null;
                      void run(async () => {
                        try {
                          const value = await file(batch.id, item.id);
                          const url = URL.createObjectURL(value.blob);
                          if (popup) {
                            popup.location.replace(url);
                            window.setTimeout(
                              () => URL.revokeObjectURL(url),
                              120000,
                            );
                          } else setPreview({ name: value.name, url });
                        } catch (error) {
                          popup?.close();
                          throw error;
                        }
                      });
                    }}
                  >
                    <Printer size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ))}
        {preview && (
          <div className="space-y-2">
            <button className={button} onClick={() => setPreview(undefined)}>
              Fechar prévia
            </button>
            <iframe
              title={preview.name}
              src={preview.url}
              className="h-[70vh] w-full bg-white"
            />
          </div>
        )}
      </div>
    </details>
  );
}
