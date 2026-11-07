import React from "react";
import type {
  StaffPdfBatchApi,
  StaffPdfBatchItemView,
  StaffPdfBatchView,
} from "../lib/staffPdfBatch";
import { renderStaffPdfRecipe } from "../services/staffPdfBatchService";
import { downloadPersonalization } from "../services/personalizationExport";

const button =
  "rounded-lg border border-gray-700 px-3 py-2 text-sm disabled:opacity-40";
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
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [preview, setPreview] = React.useState<{ name: string; url: string }>();
  const alive = React.useRef(true),
    running = React.useRef(false);
  const reload = React.useCallback(async () => {
    const value = await api.list();
    if (alive.current) {
      setBatches(value.batches);
      setItems({});
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
              {batch.reference} ·{" "}
              {new Date(batch.createdAt).toLocaleString("pt-BR")} ·{" "}
              {batch.count} arquivo(s)
            </summary>
            <p className="my-3 text-xs text-gray-400">
              Disponível até {new Date(batch.expiresAt).toLocaleString("pt-BR")}
            </p>
            <button
              className={button}
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
                    `${batch.reference}.zip`,
                  );
                })
              }
            >
              Baixar lote
            </button>
            <ul className="mt-3 space-y-2">
              {(items[batch.id] || []).map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-2 border-t border-gray-800 pt-2"
                >
                  <span className="min-w-0 flex-1 break-words text-sm">
                    {item.outputName}.pdf
                  </span>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const value = await file(batch.id, item.id);
                        downloadPersonalization(value.blob, value.name);
                      })
                    }
                  >
                    Baixar
                  </button>
                  <button
                    className={button}
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
                    Reimprimir
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
