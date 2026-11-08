import { slugifyDocumentId } from "./commerce.js";
import { adminFontUploadType, adminFontFormat } from "./adminAsset.js";
import {
  MAX_PERSONALIZATION_FONTS,
  type PersonalizationFont,
} from "./textCustomization.js";

export const FONT_UPLOAD_CONCURRENCY = 3;
export interface FontUploadRow {
  file: File;
  font: PersonalizationFont;
  status: "pending" | "uploading" | "ready" | "error";
  progress: number;
  error?: string;
}

export function planFontUploads(
  files: File[],
  existing: PersonalizationFont[],
): FontUploadRow[] {
  if (
    !files.length ||
    files.length > MAX_PERSONALIZATION_FONTS ||
    existing.length + files.length > MAX_PERSONALIZATION_FONTS
  )
    throw new Error(
      `Selecione até ${MAX_PERSONALIZATION_FONTS} arquivos, respeitando o total de ${MAX_PERSONALIZATION_FONTS} fontes cadastradas.`,
    );
  const ids = new Set(existing.map((font) => font.id));
  const names = new Set(
    existing.map((font) => font.nome.trim().toLocaleLowerCase("pt-BR")),
  );
  return files.map((file) => {
    const stem =
      file.name
        .replace(/\.(woff2|ttf|otf)$/i, "")
        .replace(/[-_]+/g, " ")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 70) || "Fonte";
    let nome = stem,
      suffix = 2;
    while (names.has(nome.toLocaleLowerCase("pt-BR")))
      nome = `${stem} (${suffix++})`;
    names.add(nome.toLocaleLowerCase("pt-BR"));
    const base = slugifyDocumentId(nome).slice(0, 48) || "fonte";
    let id = base;
    suffix = 2;
    while (ids.has(id)) id = `${base}-${suffix++}`;
    ids.add(id);
    const format = adminFontFormat(
      adminFontUploadType(file.name, file.type) || "",
    );
    return {
      file,
      font: {
        id,
        nome,
        cssFamily: `GBFont_${id.replaceAll("-", "_")}`,
        ...(format ? { arquivoFormato: format } : {}),
        ativo: false,
      },
      status: "pending",
      progress: 0,
    };
  });
}

/** Mutates only each row's state. Successful rows are never scheduled again. */
export async function runFontUploads(
  rows: FontUploadRow[],
  options: {
    retryErrors: boolean;
    stopped: () => boolean;
    upload: (
      row: FontUploadRow,
      progress: (percent: number) => void,
    ) => Promise<void>;
    changed: () => void;
  },
) {
  const pending = rows.filter(
    (row) => row.status === (options.retryErrors ? "error" : "pending"),
  );
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(FONT_UPLOAD_CONCURRENCY, pending.length) },
      async () => {
        while (!options.stopped()) {
          const row = pending[next++];
          if (!row) return;
          row.status = "uploading";
          row.progress = 0;
          row.error = undefined;
          options.changed();
          try {
            await options.upload(row, (progress) => {
              row.progress = Math.max(0, Math.min(99, Math.round(progress)));
              options.changed();
            });
            row.status = "ready";
            row.progress = 100;
          } catch (error) {
            row.status = "error";
            row.error =
              error instanceof Error
                ? error.message
                : "Não foi possível enviar esta fonte.";
          }
          options.changed();
        }
      },
    ),
  );
}
