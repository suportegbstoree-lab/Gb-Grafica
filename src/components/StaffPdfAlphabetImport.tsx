import React from "react";
import {
  planStaffPdfAlphabetImport,
  type StaffPdfAlphabetFolder,
} from "../lib/staffPdfAlphabetImport";
import type { StaffPdfApi, StaffPdfLibrary } from "../services/staffPdfService";
import EditorModal from "./EditorModal";

type Row = StaffPdfAlphabetFolder & {
  status?: "ready" | "failed";
  error?: string;
};

export default function StaffPdfAlphabetImport({
  api,
  data,
  disabled,
  onBusy,
  onImported,
}: {
  api: StaffPdfApi;
  data: StaffPdfLibrary;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onImported: () => Promise<void>;
}) {
  const [rows, setRows] = React.useState<Row[]>();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [progress, setProgress] = React.useState({
    completed: 0,
    total: 0,
    detail: "",
  });
  const running = React.useRef(false);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const pending =
    rows?.filter((row) => row.base && !row.issue && row.status !== "ready") ??
    [];

  async function send() {
    if (running.current || !pending.length) return;
    running.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    let imported = 0;
    try {
      for (const [index, row] of pending.entries()) {
        if (!alive.current) return;
        const report = (detail: string) => {
          if (alive.current)
            setProgress({ completed: index, total: pending.length, detail });
        };
        report(row.path);
        let outcome: Pick<Row, "status" | "error">;
        try {
          await api.uploadAlphabet(
            row.base!,
            row.files,
            (completed, total) =>
              report(`${row.path} · ${completed}/${total} letras`),
            row.mold,
          );
          imported++;
          outcome = { status: "ready", error: undefined };
        } catch (reason) {
          outcome = { status: "failed", error: (reason as Error).message };
        }
        if (alive.current)
          setRows((old) =>
            old?.map((item) =>
              item.path === row.path ? { ...item, ...outcome } : item,
            ),
          );
      }
      if (!alive.current) return;
      setProgress({
        completed: pending.length,
        total: pending.length,
        detail: "",
      });
      if (imported) await onImported();
    } catch (reason) {
      if (alive.current) setError((reason as Error).message);
    } finally {
      running.current = false;
      if (alive.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  }

  return (
    <>
      <label className="inline-flex cursor-pointer rounded-lg border border-gray-700 px-3 py-2 text-sm">
        Importar pastas de letras
        <input
          type="file"
          multiple
          accept="image/png"
          ref={(input) => input?.setAttribute("webkitdirectory", "")}
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            const input: HTMLInputElement = event.currentTarget;
            const files = Array.from(input.files ?? []);
            input.value = "";
            if (!files.length) return;
            const planned = planStaffPdfAlphabetImport(
              files,
              data.bases,
              data.layouts,
            );
            setRows(planned.length ? planned : undefined);
            setError(
              planned.length
                ? ""
                : "A pasta selecionada não contém letras PNG.",
            );
            setProgress({ completed: 0, total: 0, detail: "" });
          }}
        />
      </label>
      {!rows && error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {rows && (
        <EditorModal
          title="Importar alfabetos em lote"
          onClose={() => {
            setRows(undefined);
            setError("");
          }}
          closeLabel="Fechar importação de alfabetos"
          doneLabel="Concluir"
          footerText=""
          busy={busy}
          footerActions={
            <button
              type="button"
              disabled={busy || !pending.length}
              onClick={() => void send()}
              className="rounded-lg bg-pink-600 px-4 py-2 text-sm font-bold disabled:opacity-40"
            >
              Importar {pending.length} pasta(s)
            </button>
          }
        >
          <p className="mb-3 text-sm text-gray-300">
            Confira os vínculos encontrados para as pastas selecionadas.
          </p>
          {!!progress.total && (
            <div role="status" className="mb-3 space-y-1 text-sm">
              <p>
                {progress.completed} de {progress.total} pasta(s) processada(s)
              </p>
              <progress
                aria-label="Progresso da importação de alfabetos"
                className="w-full accent-pink-500"
                value={progress.completed}
                max={progress.total}
              />
              {progress.detail && (
                <p className="break-words">{progress.detail}</p>
              )}
            </div>
          )}
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.path}
                className="break-words rounded-lg border border-gray-800 p-3 text-sm"
              >
                <p className="font-medium">{row.path}</p>
                {row.base && (
                  <p className="text-gray-300">
                    {row.base.name}
                    {row.base.category ? ` · ${row.base.category}` : ""}
                  </p>
                )}
                {row.mold && (
                  <p className="text-xs text-gray-400">Molde {row.mold.name}</p>
                )}
                {row.status === "ready" && (
                  <p className="text-green-300">Vinculada</p>
                )}
                {(row.issue || row.error) && (
                  <p className="text-red-300">{row.issue || row.error}</p>
                )}
                {!row.issue && !row.status && row.base?.initialFolderName && (
                  <p className="text-amber-300">Substitui a pasta vinculada.</p>
                )}
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-300">
              {error}
            </p>
          )}
        </EditorModal>
      )}
    </>
  );
}
