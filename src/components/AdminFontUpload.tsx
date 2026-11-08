import React from "react";
import UploadInput from "./UploadInput";
import {
  planFontUploads,
  runFontUploads,
  type FontUploadRow,
} from "../lib/fontUploadQueue";
import {
  MAX_PERSONALIZATION_FONTS,
  type PersonalizationFont,
} from "../lib/textCustomization";
import type { UploadedAdminAsset } from "../services/adminAssetService";

export default function AdminFontUpload({
  fonts,
  disabled,
  upload,
  remove,
  onAdded,
  onBusy,
}: {
  fonts: PersonalizationFont[];
  disabled: boolean;
  upload: (
    id: string,
    file: File,
    progress?: (percent: number) => void,
  ) => Promise<UploadedAdminAsset>;
  remove: (path: string) => Promise<void>;
  onAdded: (font: PersonalizationFont) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [rows, setRows] = React.useState<FontUploadRow[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const alive = React.useRef(true),
    running = React.useRef(false),
    stop = React.useRef(false);
  const added = React.useRef(onAdded);
  added.current = onAdded;
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop.current = true;
    };
  }, []);
  React.useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  async function send(batch: FontUploadRow[], retryErrors = false) {
    if (running.current) return;
    running.current = true;
    stop.current = false;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await runFontUploads(batch, {
        retryErrors,
        stopped: () => stop.current || !alive.current,
        changed: () => {
          if (alive.current) setRows([...batch]);
        },
        upload: async (row, progress) => {
          const asset = await upload(row.font.id, row.file, progress);
          try {
            if (!alive.current) throw new Error("Envio interrompido.");
            added.current({ ...row.font, arquivoUrl: asset.url });
          } catch (e) {
            try {
              await remove(asset.path);
            } catch {
              throw new Error(
                `${(e as Error).message} O arquivo enviado não pôde ser removido do Storage.`,
              );
            }
            throw e;
          }
        },
      });
    } finally {
      running.current = false;
      if (alive.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  const ready = rows.filter((row) => row.status === "ready").length;
  const failed = rows.filter((row) => row.status === "error").length;
  const pending = rows.filter((row) => row.status === "pending").length;
  const button =
    "rounded-lg border border-gray-700 px-4 py-2 text-xs font-bold disabled:opacity-40";
  return (
    <section aria-label="Envio de fontes" className="space-y-3">
      <p className="text-xs text-gray-400">
        {fonts.length} de {MAX_PERSONALIZATION_FONTS} fontes cadastradas. Até
        500 arquivos por seleção, com 3 envios simultâneos. Salve as fontes após
        concluir.
      </p>
      <label className="flex w-fit cursor-pointer rounded-lg bg-purple-500 px-5 py-3 text-xs font-bold text-white">
        Enviar fonte WOFF2, TTF ou OTF
        <UploadInput
          multiple
          originalPdf
          maxFiles={MAX_PERSONALIZATION_FONTS}
          type="file"
          accept=".woff2,.ttf,.otf,font/woff2,font/ttf,font/otf,application/font-woff2,application/x-font-ttf,application/x-font-otf"
          disabled={disabled || busy || Boolean(pending || failed)}
          className="sr-only"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            const files: File[] = [...(event.currentTarget.files || [])];
            event.currentTarget.value = "";
            if (!files.length || running.current) return;
            try {
              const batch = planFontUploads(files, fonts);
              setRows(batch);
              void send(batch);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {rows.length > 0 && (
        <>
          <p role="status" className="text-sm">
            {ready} enviada(s) · {failed} com falha · {pending} pendente(s)
          </p>
          <div className="max-h-56 overflow-auto rounded-lg border border-gray-800">
            <ul className="divide-y divide-gray-800">
              {rows.map((row) => (
                <li key={row.font.id} className="p-3 text-xs">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="break-all">{row.file.name}</span>
                    <span>
                      {row.status === "ready"
                        ? "Enviada"
                        : row.status === "error"
                          ? "Falhou"
                          : row.status === "uploading"
                            ? `Enviando ${row.progress}%`
                            : "Pendente"}
                    </span>
                  </div>
                  {row.status === "uploading" && (
                    <progress
                      aria-label={`Progresso de ${row.file.name}`}
                      max={100}
                      value={row.progress}
                      className="mt-2 w-full"
                    />
                  )}
                  {row.error && (
                    <p role="alert" className="mt-1 text-red-300">
                      {row.error}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            {busy ? (
              <button
                type="button"
                className={button}
                onClick={() => {
                  stop.current = true;
                }}
              >
                Pausar após os arquivos atuais
              </button>
            ) : (
              <>
                {pending > 0 && (
                  <button
                    type="button"
                    className={button}
                    onClick={() => void send(rows)}
                  >
                    Continuar pendentes
                  </button>
                )}
                {failed > 0 && (
                  <button
                    type="button"
                    className={button}
                    onClick={() => void send(rows, true)}
                  >
                    Tentar novamente as falhas
                  </button>
                )}
                <button
                  type="button"
                  className={button}
                  onClick={() => {
                    setRows([]);
                    setError("");
                  }}
                >
                  {pending || failed
                    ? "Descartar pendentes e falhas"
                    : "Limpar resultados"}
                </button>
              </>
            )}
          </div>
          <p className="text-xs text-gray-400">
            As fontes enviadas permanecem no cadastro ao pausar ou tentar
            novamente. Os resultados desta fila ficam disponíveis enquanto este
            editor estiver aberto.
          </p>
        </>
      )}
    </section>
  );
}
