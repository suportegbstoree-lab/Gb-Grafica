import React from "react";
import EditorModal from "./EditorModal";
import { firstInitial, selectedInitial } from "../lib/decorativeInitial";
import {
  productPdfOrder,
  type ProductPdfBinding,
  type ProductPdfOrder,
} from "../lib/productCustomization";
import { decodePersonalizationSource } from "../services/personalizationModelService";
import {
  drawProductPdfPage,
  productPdfPageLabel,
  productPdfPreview,
} from "../services/productPdfPreview";
import { prepareStaffPdfFonts } from "../services/staffPdfRender";
import type { PersonalizationDocument } from "../services/personalizationExport";

function usePreviewImage(source?: Blob | string) {
  const [result, setResult] = React.useState<{
    source: Blob | string;
    image?: Awaited<ReturnType<typeof decodePersonalizationSource>>;
    error?: string;
  }>();
  React.useEffect(() => {
    if (!source) return;
    let current = true;
    const pending = decodePersonalizationSource(source);
    void pending.then(
      (image) => {
        if (current) setResult({ source, image });
      },
      (error: Error) => {
        if (current) setResult({ source, error: error.message });
      },
    );
    return () => {
      current = false;
      void pending.then(
        (image) => image.dispose(),
        () => undefined,
      );
    };
  }, [source]);
  return result?.source === source ? result : undefined;
}

function LivePdfPage({
  binding,
  index,
  recipe,
  image,
  fontsReady,
}: {
  binding: ProductPdfBinding;
  index: number;
  recipe?: ProductPdfOrder;
  image?: Blob | string;
  fontsReady: boolean;
}) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const base = usePreviewImage(binding.pdf.pages[index]);
  const extra = usePreviewImage(index === 0 ? image : undefined);
  const initial =
    index === 0
      ? selectedInitial(binding.pdf, recipe?.job.lines[0]?.text || "")
      : undefined;
  const letter = usePreviewImage(initial?.url);
  const [drawError, setDrawError] = React.useState("");
  const sizePercent = initial?.sizePercent;
  React.useLayoutEffect(() => {
    if (!canvas.current || !base?.image || !recipe) return;
    try {
      drawProductPdfPage(
        canvas.current,
        base.image,
        index,
        binding.pdf.pages.length,
        recipe,
        extra?.image,
        letter?.image && sizePercent
          ? { image: letter.image, sizePercent }
          : undefined,
        1280,
        fontsReady,
      );
      setDrawError("");
    } catch (error) {
      setDrawError((error as Error).message);
    }
  }, [
    base,
    binding.pdf.pages.length,
    index,
    recipe,
    extra,
    letter,
    sizePercent,
    fontsReady,
  ]);

  const error = base?.error || extra?.error || letter?.error || drawError;
  const label = productPdfPageLabel(index);
  return (
    <figure>
      <figcaption className="mb-2 text-xs">{label}</figcaption>
      <canvas
        ref={canvas}
        role="img"
        aria-label={
          index === 0
            ? "Prévia da capa personalizada"
            : `Prévia da ${label.toLowerCase()}`
        }
        onContextMenu={(event) => event.preventDefault()}
        hidden={!base?.image}
        className="mx-auto max-h-[55dvh] max-w-full rounded-lg bg-white object-contain"
      />
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {!base && (
        <p role="status" className="text-xs text-gray-400">
          Carregando {label.toLowerCase()}…
        </p>
      )}
    </figure>
  );
}

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
  const [text, setText] = React.useState(initialText);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [fontState, setFontState] = React.useState<{
    binding: ProductPdfBinding;
    error?: string;
  }>();
  const { recipe, validationError } = React.useMemo(() => {
    try {
      return {
        recipe: productPdfOrder(binding, text, textEnabled && !!text.trim()),
        validationError: "",
      };
    } catch (reason) {
      return { recipe: undefined, validationError: (reason as Error).message };
    }
  }, [binding, text, textEnabled]);

  React.useEffect(() => {
    if (!textEnabled) return;
    let current = true;
    const pending = Promise.resolve().then(() => {
      const empty = productPdfOrder(binding, "", false);
      return prepareStaffPdfFonts(empty.job.lines, empty.fonts);
    });
    void pending.then(
      () => {
        if (current) setFontState({ binding });
      },
      (reason: Error) => {
        if (current) setFontState({ binding, error: reason.message });
      },
    );
    return () => {
      current = false;
      void pending.then(
        (release) => release(),
        () => undefined,
      );
    };
  }, [binding, textEnabled]);

  const fontError =
    fontState?.binding === binding ? fontState.error : undefined;
  const pageCount = binding.pdf.pages.length;
  const initialLetter =
    textEnabled && binding.pdf.alphabet ? firstInitial(text) : undefined;
  const visiblePages =
    pageCount > 2
      ? [Math.min(page, pageCount - 1)]
      : binding.pdf.pages.map((_, i) => i);
  const confirm = (
    <button
      type="button"
      disabled={busy || !recipe || !!fontError || (textEnabled && !text.trim())}
      className="rounded-lg bg-pink-600 px-5 py-3 font-bold disabled:opacity-40"
      onClick={async () => {
        setBusy(true);
        setError("");
        try {
          const preview = await productPdfPreview(
            binding,
            text,
            textEnabled,
            image,
          );
          await onSave(textEnabled ? text.trim() : "", preview);
        } catch (reason) {
          setError((reason as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Salvando…" : "Confirmar personalização"}
    </button>
  );
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
              disabled={busy}
              onChange={(event) => {
                setError("");
                setText(event.target.value);
              }}
              className="mt-2 w-full rounded-lg border border-gray-600 bg-black p-3"
            />
          </label>
        )}
        <p className="text-xs text-gray-400">
          A posição, a fonte, o tamanho e a cor seguem o modelo da loja. O PDF
          preserva as {pageCount} páginas originais.
        </p>
        {initialLetter && !selectedInitial(binding.pdf, text) && (
          <p role="status" className="text-xs text-gray-400">
            A letra {initialLetter} não está cadastrada no alfabeto desta base.
          </p>
        )}
        {pageCount > 2 && (
          <label className="block text-sm">
            Página
            <select
              aria-label="Página da prévia"
              value={visiblePages[0]}
              onChange={(event) => setPage(Number(event.target.value))}
              className="ml-3 rounded border border-gray-600 bg-black p-2"
            >
              {binding.pdf.pages.map((_, i) => (
                <option key={i} value={i}>
                  {productPdfPageLabel(i)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className={pageCount === 2 ? "grid gap-4 sm:grid-cols-2" : ""}>
          {visiblePages.map((index) => (
            <div key={index}>
              <LivePdfPage
                binding={binding}
                index={index}
                recipe={recipe}
                image={image}
                fontsReady={
                  !textEnabled || (fontState?.binding === binding && !fontError)
                }
              />
            </div>
          ))}
        </div>
        {(validationError || fontError || error) && (
          <p role="alert" className="text-sm text-red-300">
            {validationError || fontError || error}
          </p>
        )}
      </div>
    </EditorModal>
  );
}
