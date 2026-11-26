import React from "react";
import type { LabelArchiveApi, LabelArchiveHeader } from "../lib/staffLabelImport";
import { labelPdfFile } from "../services/staffLabelArchive";
import EditorModal from "./EditorModal";

const button =
  "rounded-lg border border-gray-700 px-3 py-2 text-sm hover:border-pink-400 focus-visible:outline-pink-400 disabled:opacity-50";

export default function StaffLabelViewer({
  api,
  header,
  numbers,
  printOnOpen,
  kind,
  onClose,
}: {
  api: LabelArchiveApi;
  header: LabelArchiveHeader;
  numbers: number[];
  printOnOpen: boolean;
  kind?: "active" | "excluded";
  onClose: () => void;
}) {
  const [url, setUrl] = React.useState("");
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [attempt, setAttempt] = React.useState(0);
  const frame = React.useRef<HTMLIFrameElement>(null);
  const printed = React.useRef(false);
  React.useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setUrl("");
    setError("");
    setNotice("");
    printed.current = false;
    void labelPdfFile(
      api,
      { id: header.id, revision: header.revision },
      numbers,
      controller.signal,
      kind,
    )
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = (error as { message?: unknown })?.message;
        setError(
          typeof message === "string" && message.trim()
            ? message
            : "Não foi possível carregar as etiquetas. Tente novamente.",
        );
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, header.id, header.revision, numbers, kind, attempt]);

  function print() {
    try {
      const target = frame.current?.contentWindow;
      if (!target) throw new Error("Visualizador indisponível.");
      target.focus();
      target.print();
    } catch {
      setNotice("Use o botão de impressão na barra do visualizador de PDF.");
    }
  }
  const title =
    kind === "excluded"
      ? "PDF de etiquetas excluídas"
      : kind === "active"
        ? "PDF completo sem os excluídos"
        : numbers.length === 1
          ? "Visualizar etiqueta · Página " + numbers[0]
          : "Visualizar etiquetas do arquivo";
  return (
    <EditorModal
      wide
      title={title}
      onClose={onClose}
      closeLabel="Fechar PDF das etiquetas"
      doneLabel="Fechar visualização"
      footerText={header.name + " · " + numbers.length + " etiqueta(s)"}
      footerActions={
        <button type="button" className={button} disabled={!url} onClick={print}>
          Imprimir
        </button>
      }
    >
      {!url && !error && (
        <p role="status" className="py-8 text-sm text-gray-300">
          Carregando etiquetas…
        </p>
      )}
      {error && (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
          <button type="button" className={button} onClick={() => setAttempt((old) => old + 1)}>
            Tentar novamente
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="mb-2 text-sm text-gray-300">
          {notice}
        </p>
      )}
      {url && (
        <iframe
          ref={frame}
          title="PDF das etiquetas"
          src={url}
          className="h-[65vh] w-full rounded-lg bg-white"
          onLoad={() => {
            if (printOnOpen && !printed.current) {
              printed.current = true;
              print();
            }
          }}
        />
      )}
    </EditorModal>
  );
}
