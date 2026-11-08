import React from "react";
import EditorModal from "./EditorModal";
import type { ProductPdfBinding } from "../lib/productCustomization";
import { productPdfPreview } from "../services/productPdfPreview";
import type { PersonalizationDocument } from "../services/personalizationExport";
export default function ProductPdfEditor({
  binding,
  textEnabled,
  initialText,
  image,
  onClose,
  onSave,
}: {
  binding: ProductPdfBinding;
  textEnabled: boolean;
  initialText: string;
  image?: Blob | string;
  onClose: () => void;
  onSave: (text: string, preview: PersonalizationDocument) => Promise<void>;
}) {
  const [text, setText] = React.useState(initialText),
    [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState(""),
    [preview, setPreview] = React.useState<PersonalizationDocument>(),
    [urls, setUrls] = React.useState<string[]>([]);
  const [page, setPage] = React.useState(0);
  const request = React.useRef(0);
  const confirm = (
    <button
      type="button"
      disabled={busy || !preview}
      className="rounded-lg bg-pink-600 px-5 py-3 font-bold disabled:opacity-40"
      onClick={() => {
        if (!preview) return;
        setBusy(true);
        void onSave(textEnabled ? text.trim() : "", preview)
          .catch((e) => setError(e.message))
          .finally(() => setBusy(false));
      }}
    >
      {busy
        ? "Salvando…"
        : preview
          ? "Confirmar personalização"
          : "Preparando prévia…"}
    </button>
  );
  React.useEffect(() => {
    const id = ++request.current;
    setPreview(undefined);
    setError("");
    const timer = setTimeout(() => {
      void productPdfPreview(binding, text, textEnabled, image)
        .then((result) => {
          if (request.current === id) setPreview(result);
        })
        .catch((e) => {
          if (request.current === id) setError(e.message);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [binding, text, textEnabled, image]);
  React.useEffect(() => {
    const next = preview?.pages.map((p) => URL.createObjectURL(p.blob)) || [];
    setUrls(next);
    return () => next.forEach(URL.revokeObjectURL);
  }, [preview]);
  return (
    <EditorModal
      title="Personalizar produto"
      busy={busy}
      onClose={onClose}
      closeLabel="Fechar personalização"
      doneLabel="Cancelar"
      footerText="Confira a prévia. A produção usa as medidas e o molde cadastrados pela equipe."
      footerActions={confirm}
    >
      <div className="space-y-5">
        {textEnabled && (
          <label className="block text-sm">
            Nome ou texto
            <textarea
              aria-label="Nome ou texto do molde"
              rows={4}
              maxLength={200}
              value={text}
              onChange={(e) => {
                setPreview(undefined);
                setText(e.target.value);
              }}
              className="mt-2 w-full rounded-lg border border-gray-600 bg-black p-3"
            />
          </label>
        )}
        <p className="text-xs text-gray-400">
          A posição, a fonte, o tamanho e a cor seguem o modelo da loja. O PDF
          preserva as {binding.pdf.pages.length} páginas originais.
        </p>
        {urls.length > 2 && (
          <label className="block text-sm">
            Página
            <select
              aria-label="Página da prévia"
              value={page}
              onChange={(e) => setPage(Number(e.target.value))}
              className="ml-3 rounded border border-gray-600 bg-black p-2"
            >
              {urls.map((_, i) => (
                <option key={i} value={i}>
                  {preview?.pages[i].label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {urls.map((url, i) =>
            urls.length > 2 && i !== page ? null : (
              <figure key={url}>
                <figcaption className="mb-2 text-xs">
                  {preview?.pages[i].label}
                </figcaption>
                <img
                  src={url}
                  draggable={false}
                  onContextMenu={(event) => event.preventDefault()}
                  alt={
                    i === 0
                      ? "Prévia da capa personalizada"
                      : "Prévia da contracapa"
                  }
                  className="max-h-[55dvh] w-full rounded-lg bg-white object-contain"
                />
              </figure>
            ),
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
      </div>
    </EditorModal>
  );
}
