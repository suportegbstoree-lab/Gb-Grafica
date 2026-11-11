import { uploadBatch } from "../lib/uploadBatch";
import React from "react";
import type { ProductPdfTemplate } from "../lib/pdfTemplate";
import {
  readAlphabetFiles,
  type DecorativeAlphabet,
} from "../lib/decorativeInitial";
import { matchesArtworkSignature } from "../lib/artwork";
import type { UploadedCatalogImage } from "../services/catalogImageService";

export default function PdfTemplatesEditor({
  templates,
  onChange,
  upload,
  remove,
  onUploaded,
  onBusy,
}: {
  templates: ProductPdfTemplate[];
  onChange: (templates: ProductPdfTemplate[]) => void;
  upload: (file: File) => Promise<UploadedCatalogImage>;
  remove: (path: string) => Promise<unknown>;
  onUploaded: (images: UploadedCatalogImage[]) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [progress, setProgress] = React.useState({ completed: 0, total: 0 });
  const [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState("");
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function importFolder(template: ProductPdfTemplate, files: File[]) {
    if (!files.length || busy) return;
    setBusy(true);
    onBusy(true);
    setError("");
    setProgress({ completed: 0, total: files.length });
    const uploaded: UploadedCatalogImage[] = [];
    try {
      const parsed = readAlphabetFiles(files, template.name);
      // Validate the whole folder before starting any network write.
      for (const { file } of parsed.letters) {
        if (
          !matchesArtworkSignature(
            "image/png",
            new Uint8Array(await file.slice(0, 16).arrayBuffer()),
          )
        )
          throw new Error(`“${file.name}” não contém um PNG válido.`);
        const header = new DataView(await file.slice(0, 33).arrayBuffer());
        if (
          header.byteLength < 33 ||
          header.getUint32(12) !== 0x49484452 ||
          header.getUint32(16) === 0 ||
          header.getUint32(20) === 0 ||
          header.getUint32(16) > 16384 ||
          header.getUint32(20) > 16384 ||
          header.getUint32(16) * header.getUint32(20) > 64_000_000
        )
          throw new Error(
            `“${file.name}” excede as dimensões permitidas ou não possui cabeçalho PNG válido.`,
          );
        const bitmap = await createImageBitmap(file);
        try {
          if (
            bitmap.width > 16384 ||
            bitmap.height > 16384 ||
            bitmap.width * bitmap.height > 64_000_000
          )
            throw new Error(`“${file.name}” excede as dimensões permitidas.`);
        } finally {
          bitmap.close();
        }
      }
      const alphabet: DecorativeAlphabet = {
        folderName: parsed.folderName,
        sizePercent: template.alphabet?.sizePercent || 60,
        letters: {},
      };
      const results = await uploadBatch(
        parsed.letters,
        ({ letter, file }) =>
          upload(new File([file], `${letter}.png`, { type: "image/png" })),
        {
          rollback: (image) => remove(image.path),
          active: () => alive.current,
          progress: (completed, total) => {
            if (alive.current) setProgress({ completed, total });
          },
        },
      );
      uploaded.push(...results);
      parsed.letters.forEach(({ letter }, index) => {
        const image = results[index];
        alphabet.letters[letter] = { path: image.path, url: image.url };
      });
      onUploaded(uploaded);
      onChange(
        templates.map((item) =>
          item.id === template.id ? { ...item, alphabet } : item,
        ),
      );
    } catch (reason) {
      await Promise.allSettled(uploaded.map((image) => remove(image.path)));
      if (alive.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "Não foi possível importar o alfabeto.",
        );
    } finally {
      if (alive.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  return (
    <section aria-label="Modelos PDF e iniciais" className="space-y-3">
      {templates.map((template) => (
        <fieldset
          key={template.id}
          disabled={busy}
          className="space-y-3 rounded-xl border border-gray-700 p-4 text-sm"
        >
          <legend className="max-w-full break-words px-2">
            PDF: {template.name}
          </legend>
          <p className="text-xs text-gray-400">
            {template.pages.length} página(s). A inicial aparece somente na
            capa. Importe a pasta com o mesmo nome do PDF, contendo A.png até
            Z.png.
          </p>
          <label className="inline-flex cursor-pointer rounded-lg border border-gray-600 px-3 py-2 text-xs font-bold">
            {busy
              ? `Enviando letras: ${progress.completed} de ${progress.total}`
              : "Selecionar pasta de letras"}
            <input
              type="file"
              multiple
              accept="image/png"
              aria-label={`Pasta de letras de ${template.name}`}
              ref={(input) => {
                input?.setAttribute("webkitdirectory", "");
              }}
              className="sr-only"
              onChange={(event) => {
                const files = [...(event.target.files || [])];
                event.target.value = "";
                void importFolder(template, files);
              }}
            />
          </label>
          {template.alphabet && (
            <>
              <p className="text-xs">
                Pasta: {template.alphabet.folderName} · Letras:{" "}
                {Object.keys(template.alphabet.letters).sort().join(", ")}
              </p>
              <p className="text-xs text-gray-400">
                Ajuste o tamanho da inicial em Gerar PDF → Bases e moldes.
              </p>
              <button
                type="button"
                className="mr-4 text-xs text-red-400 underline"
                onClick={() =>
                  onChange(
                    templates.map((item) => {
                      if (item.id !== template.id) return item;
                      const { alphabet, ...rest } = item;
                      return rest;
                    }),
                  )
                }
              >
                Remover alfabeto
              </button>
            </>
          )}
          <button
            type="button"
            className="text-xs text-red-400 underline"
            onClick={() =>
              onChange(templates.filter((item) => item.id !== template.id))
            }
          >
            Desvincular PDF
          </button>
        </fieldset>
      ))}
      {busy && (
        <p role="status" className="text-xs text-gray-400">
          {progress.completed} de {progress.total} arquivos concluídos. Os PNGs
          são enviados na resolução original, sem conversão ou perda de
          qualidade.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
