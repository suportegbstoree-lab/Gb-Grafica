import React from "react";
import { Upload } from "lucide-react";
import EditorModal from "./EditorModal";
import {
  normalizePdfCategory,
  pdfCategoryKey,
  UNCATEGORIZED_PDFS,
} from "../lib/staffPdfCategory";
import { staffPdfSourceName, type StaffPdfBase } from "../lib/staffPdf";
import type { StaffPdfApi } from "../services/staffPdfService";
import {
  isFolderMetadata,
  pdfBaseName,
  readAlphabetFiles,
} from "../lib/decorativeInitial";

interface ImportFiles {
  file: File;
  category: string;
  alphabet?: File[];
}
interface UploadRow extends ImportFiles {
  requestId: string;
  selected: boolean;
  replacement?: StaffPdfBase;
  storedBaseId?: string;
  status: "pending" | "ready" | "error";
  error?: string;
}
const field =
  "mt-1 block w-full rounded-lg border border-gray-700 bg-black p-2";
const button =
  "rounded-lg border border-gray-700 px-3 py-2 text-sm disabled:opacity-40";

export default function StaffPdfBaseImport({
  api,
  bases,
  disabled,
  onBusy,
  onImported,
}: {
  api: StaffPdfApi;
  bases: StaffPdfBase[];
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onImported: () => Promise<void>;
}) {
  const [rows, setRows] = React.useState<UploadRow[]>();
  const [single, setSingle] = React.useState<File>();
  const [category, setCategory] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [progress, setProgress] = React.useState("");
  const alive = React.useRef(true),
    running = React.useRef(false),
    stop = React.useRef(false);
  const wake = React.useRef<() => void>();
  const categories = [
    ...new Set(
      bases
        .filter((base) => base.source === "internal")
        .map((base) => base.category || UNCATEGORIZED_PDFS),
    ),
  ].sort((a, b) => a.localeCompare(b));
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop.current = true;
      wake.current?.();
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
  const key = (name: string, group: string) =>
    JSON.stringify([
      pdfCategoryKey(group),
      name.normalize("NFC").toLocaleLowerCase("pt-BR"),
    ]);
  function plan(files: ImportFiles[]) {
    const seen = new Set<string>();
    const next = files.map(({ file, category, alphabet }): UploadRow => {
      const normalized = normalizePdfCategory(category);
      const canonical =
        categories.find(
          (name) => pdfCategoryKey(name) === pdfCategoryKey(normalized),
        ) || normalized;
      const identity = key(file.name, canonical);
      const replacement = bases.find(
        (base) =>
          base.source === "internal" &&
          key(staffPdfSourceName(base), base.category || UNCATEGORIZED_PDFS) === identity,
      );
      const selected = !seen.has(identity) && !replacement;
      seen.add(identity);
      return {
        file,
        category: canonical,
        alphabet,
        requestId: crypto.randomUUID(),
        selected,
        replacement,
        status: "pending",
      };
    });
    setRows(next);
    setSingle(undefined);
    setError("");
    setProgress("");
  }
  function chooseSingle(file?: File) {
    if (!file || busy) return;
    if (!/\.pdf$/i.test(file.name)) {
      setError("Selecione um PDF.");
      return;
    }
    setSingle(file);
    setCategory("");
    setError("");
  }
  function chooseFolder(files: File[]) {
    try {
      const contents = files.filter((file) => !isFolderMetadata(file));
      const pdfs = contents.filter((file) => /\.pdf$/i.test(file.name));
      if (!pdfs.length) throw new Error("A pasta não possui PDFs.");
      if (pdfs.length > 500) throw new Error("Importe até 500 PDFs por vez.");
      const byFolder = new Map<string, File[]>();
      for (const file of contents) {
        const folder = file.webkitRelativePath
          .split("/")
          .slice(0, -1)
          .map((part) => part.normalize("NFC").trim())
          .join("/");
        const group = byFolder.get(folder);
        if (group) group.push(file);
        else byFolder.set(folder, [file]);
      }
      plan(
        pdfs.map((file) => {
          const relative = file.webkitRelativePath.split("/");
          if (relative.length < 2)
            throw new Error("Selecione a pasta pelo botão de importar pasta.");
          const folder = [...relative.slice(0, -1), pdfBaseName(file.name)]
            .map((part) => part.normalize("NFC").trim())
            .join("/");
          const alphabet = byFolder.get(folder);
          return {
            file,
            category: relative[0],
            alphabet: alphabet?.some((item) => /\.png$/i.test(item.name))
              ? alphabet
              : undefined,
          };
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const pending = (rows || []).filter(
    (row) => row.selected && row.status !== "ready",
  );
  const identities = pending.map((row) => key(row.file.name, row.category));
  const repeatedNames = new Set(identities).size !== identities.length;

  async function send() {
    if (running.current || !pending.length || repeatedNames) return;
    running.current = true;
    stop.current = false;
    setBusy(true);
    onBusy(true);
    setError("");
    let count = 0;
    let failures = 0;
    try {
      for (const row of pending) {
        if (!alive.current || stop.current) break;
        const attempted = count + failures;
        if (attempted && attempted % 20 === 0) {
          setProgress("Aguardando para continuar a importação.");
          await new Promise<void>((resolve) => {
            const timer = window.setTimeout(resolve, 61000);
            wake.current = () => {
              window.clearTimeout(timer);
              resolve();
            };
          });
          wake.current = undefined;
          if (!alive.current || stop.current) break;
        }
        setProgress(
          `Enviando ${row.file.name} · ${attempted + 1} de ${pending.length}`,
        );
        let storedBaseId = row.storedBaseId;
        try {
          if (row.alphabet) readAlphabetFiles(row.alphabet, row.file.name);
          storedBaseId ??= await api.uploadBase(
            row.file,
            row.requestId,
            row.replacement,
            row.category,
          );
          if (row.alphabet) {
            setProgress(`Vinculando as letras de ${row.file.name}…`);
            await api.uploadAlphabet(
              {
                id: storedBaseId,
                name: row.replacement ? staffPdfSourceName(row.replacement) : row.file.name,
              },
              row.alphabet,
            );
          }
          count++;
          if (alive.current)
            setRows((old) =>
              old?.map((item) =>
                item === row
                  ? { ...item, status: "ready", error: undefined }
                  : item,
              ),
            );
        } catch (e) {
          failures++;
          if (alive.current)
            setRows((old) =>
              old?.map((item) =>
                item === row
                  ? {
                      ...item,
                      status: "error",
                      storedBaseId,
                      requestId: crypto.randomUUID(),
                      error: (e as Error).message,
                    }
                  : item,
              ),
            );
        }
      }
      if (alive.current)
        setProgress(
          `${count} PDF(s) enviado(s).${failures ? ` ${failures} com erro.` : ""}${stop.current ? " Importação pausada." : ""}`,
        );
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      try {
        await onImported();
      } catch (e) {
        if (alive.current) setError((e as Error).message);
      }
      running.current = false;
      if (alive.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  return (
    <div className="space-y-3">
      <label
        className="mt-4 inline-flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-dashed border-gray-600 px-4 py-3 text-sm has-[:disabled]:opacity-50"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (disabled || busy) return;
          if (e.dataTransfer.files.length !== 1) {
            setError("Use Importar pasta de PDFs para enviar uma pasta.");
            return;
          }
          chooseSingle(e.dataTransfer.files[0]);
        }}
      >
        <Upload size={16} aria-hidden="true" />
        <span className="font-medium">Selecionar base PDF</span>
        <span className="text-xs text-gray-400">ou arraste aqui</span>
        <input
          disabled={disabled || busy}
          type="file"
          aria-label="Selecionar base PDF"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => {
            chooseSingle(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      <label className={`${button} inline-block cursor-pointer`}>
        Importar pasta de PDFs
        <input
          disabled={disabled || busy}
          type="file"
          multiple
          className="sr-only"
          ref={(element) => element?.setAttribute("webkitdirectory", "")}
          onChange={(e) => {
            chooseFolder(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
      </label>
      <p className="text-xs text-gray-400">
        Se a pasta de letras estiver ao lado do PDF com o mesmo nome, ela será
        importada junto com a base.
      </p>
      {error && !rows && !single && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {single && (
        <EditorModal
          title="Categoria do PDF"
          onClose={() => setSingle(undefined)}
          closeLabel="Fechar categoria do PDF"
          doneLabel="Cancelar"
          footerText=""
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                plan([{ file: single, category }]);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <p className="mb-3 break-words text-sm">{single.name}</p>
            <label className="block text-sm">
              Categoria
              <input
                className={field}
                list="staff-pdf-import-categories"
                maxLength={100}
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Escolha ou escreva uma categoria"
              />
              <datalist id="staff-pdf-import-categories">
                {categories.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
            {error && (
              <p role="alert" className="mt-3 text-red-300">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="mt-3 rounded-lg bg-pink-600 px-4 py-2"
            >
              Continuar
            </button>
          </form>
        </EditorModal>
      )}
      {rows && (
        <EditorModal
          wide
          title="Importar bases PDF"
          busy={busy}
          onClose={() => {
            setRows(undefined);
            setError("");
          }}
          closeLabel="Fechar importação de bases"
          doneLabel="Concluir"
          footerText=""
        >
          <div className="max-h-[55vh] overflow-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">Enviar</th>
                  <th className="p-2">Arquivo</th>
                  <th className="p-2">Categoria</th>
                  <th className="p-2">Situação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-t border-gray-800">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        disabled={busy || row.status === "ready"}
                        checked={row.selected}
                        aria-label={
                          row.replacement
                            ? `Substituir ${row.file.name}`
                            : `Enviar ${row.file.name}`
                        }
                        onChange={(e) =>
                          setRows((old) =>
                            old?.map((item, i) =>
                              i === index
                                ? { ...item, selected: e.target.checked }
                                : item,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="break-words p-2">
                      {row.file.name}
                      {row.alphabet && (
                        <span className="block text-xs text-gray-400">
                          Pasta de letras encontrada
                        </span>
                      )}
                    </td>
                    <td className="p-2">{row.category}</td>
                    <td className="p-2">
                      {row.status === "ready"
                        ? "Enviado"
                        : row.error ||
                          (row.replacement
                            ? "Já existe. Marque para substituir."
                            : "Novo PDF")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {repeatedNames && (
            <p role="alert" className="mt-3 text-amber-300">
              Há arquivos com o mesmo nome na mesma categoria. Selecione um de
              cada nome.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-red-300">
              {error}
            </p>
          )}
          {progress && (
            <p role="status" className="mt-3 text-sm">
              {progress}
            </p>
          )}
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={busy || !pending.length || repeatedNames}
              className={button}
              onClick={() => void send()}
            >
              Enviar {pending.length} PDF(s)
            </button>
            {busy && (
              <button
                type="button"
                className={button}
                onClick={() => {
                  stop.current = true;
                  wake.current?.();
                }}
              >
                Parar após este arquivo
              </button>
            )}
          </div>
        </EditorModal>
      )}
    </div>
  );
}
