import React from "react";
import EditorModal from "./EditorModal";
import ConfirmDialog from "./ConfirmDialog";
import StaffPdfBaseImport from "./StaffPdfBaseImport";
import StaffPdfPicker from "./StaffPdfPicker";
import { UNCATEGORIZED_PDFS } from "../lib/staffPdfCategory";
import { alphabetFolderName } from "../lib/decorativeInitial";
import StaffPdfPreview from "./StaffPdfPreview";
import { useStaffPdfInitial } from "./useStaffPdfInitial";
import {
  baseForPdfLayout,
  staffPdfInitialSize,
  defaultPdfLayout,
  normalizePdfLayout,
  parsePdfLayoutMap,
  newPdfLine,
  matchPdfLayout,
  type StaffPdfBase,
  type StaffPdfLayout,
  type StaffPdfLayoutView,
} from "../lib/staffPdf";
import type { PersonalizationFont } from "../lib/textCustomization";
import type { StaffPdfApi, StaffPdfLibrary } from "../services/staffPdfService";
import { downloadPersonalization } from "../services/personalizationExport";
const input =
  "mt-1 block w-full min-w-0 rounded-lg border border-gray-700 bg-black p-2";
export default function StaffPdfLibraryEditor({
  data,
  api,
  fonts,
  reload,
}: {
  data: StaffPdfLibrary;
  api: StaffPdfApi;
  fonts: PersonalizationFont[];
  reload: () => Promise<void>;
}) {
  const [operationBusy, setBusy] = React.useState(false),
    [error, setError] = React.useState(""),
    [message, setMessage] = React.useState(""),
    [query, setQuery] = React.useState(""),
    [importBusy, setImportBusy] = React.useState(false),
    [catalogBaseId, setCatalogBaseId] = React.useState(""),
    [alphabetUpload, setAlphabetUpload] = React.useState<{
      id: string;
      status: "Importando..." | "Em andamento..." | "Finalizado!" | "Erro!";
      completed: number;
      total: number;
      error?: string;
    }>(),
    [editBase, setEditBase] = React.useState<StaffPdfBase>();
  const busy = operationBusy || importBusy;
  const [editing, setEditing] = React.useState<{
      name: string;
      layout: StaffPdfLayout;
      id?: string;
      revision?: string;
    } | null>(null),
    [baseId, setBaseId] = React.useState(""),
    [original, setOriginal] = React.useState<Blob | null>(null),
    [sample, setSample] = React.useState("Texto de exemplo"),
    [confirm, setConfirm] = React.useState<{
      kind: "base" | "layout";
      id: string;
      name: string;
      revision?: string;
    } | null>(null);
  const alive = React.useRef(true);
  const running = React.useRef(false);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function run(fn: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function importTemplates(file?: File) {
    if (!file) return;
    void run(async () => {
      if (!/\.json$/i.test(file.name) || file.size > 800000)
        throw new Error("Use um JSON de até 800 KB.");
      const raw = JSON.parse(await file.text());
      parsePdfLayoutMap(raw);
      if (new TextEncoder().encode(JSON.stringify(raw)).length > 240000)
        throw new Error("Divida este JSON em arquivos menores que 240 KB.");
      const result = await api.importLayouts(raw);
      await reload();
      setMessage(
        `${result.created} moldes importados; ${result.skipped} existentes preservados.`,
      );
    });
  }
  function drop(
    event: React.DragEvent<HTMLElement>,
    receive: (file: File) => void,
  ) {
    event.preventDefault();
    if (running.current) return;
    if (event.dataTransfer.files.length !== 1) {
      setError("Arraste um arquivo de cada vez.");
      return;
    }
    receive(event.dataTransfer.files[0]);
  }
  function associated(base: StaffPdfBase) {
    return data.layouts.filter((row) =>
      Boolean(matchPdfLayout(base.name, base.pageCount, [row], base.id)),
    );
  }
  function unusedName(base: StaffPdfBase) {
    const stem = base.name.replace(/\.pdf$/i, "").slice(0, 125);
    let name = `${stem}_template__${base.pageCount}p`;
    let index = 2;
    while (data.layouts.some((row) => row.name === name))
      name = `${`${stem} - ${base.category || UNCATEGORIZED_PDFS}`.slice(0, 160)} (${index++})`;
    return name;
  }
  const open = (row?: StaffPdfLayoutView, selectedBase?: StaffPdfBase) => {
    const linked = selectedBase || (row && baseForPdfLayout(row, data.bases));
    setEditing(
      row
        ? {
            ...structuredClone(row),
            layout: {
              ...row.layout,
              ...(linked
                ? { base_pdf_name: linked.name, base_id: linked.id }
                : {}),
            },
          }
        : {
            name: linked ? unusedName(linked) : "",
            layout: {
              ...defaultPdfLayout(),
              ...(linked
                ? { base_pdf_name: linked.name, base_id: linked.id }
                : {}),
            },
          },
    );
    setBaseId(linked ? linked.id : "");
    setOriginal(null);
    setError("");
    if (linked)
      void run(async () => setOriginal(await api.baseFile(linked.id)));
  };
  function edit(base: StaffPdfBase) {
    const rows = associated(base);
    if (rows.length > 1) setEditBase(base);
    else open(rows[0], base);
  }
  const patch = (value: Partial<StaffPdfLayout>) =>
    setEditing((old) =>
      old ? { ...old, layout: { ...old.layout, ...value } } : old,
    );
  const base = data.bases.find((b) => b.id === baseId);
  const catalogAlphabets = data.bases.filter(
    (item) => item.source === "catalog" && item.initialFolderName,
  );
  const catalogBase = catalogAlphabets.find(
    (item) => item.id === catalogBaseId,
  );
  const { initial, initialError } = useStaffPdfInitial(
    api,
    editing && original && base?.initialLetters?.length ? base.id : "",
    sample,
    staffPdfInitialSize(editing?.layout),
    base?.revision,
  );
  async function importAlphabet(base: StaffPdfBase, files: File[]) {
    await run(async () => {
      setAlphabetUpload({
        id: base.id,
        status: "Importando...",
        completed: 0,
        total: 0,
      });
      try {
        await api.uploadAlphabet(base, files, (completed, total) => {
          if (alive.current)
            setAlphabetUpload({
              id: base.id,
              status: "Em andamento...",
              completed,
              total,
            });
        });
        await reload();
        if (alive.current) {
          setAlphabetUpload(
            (previous) => previous && { ...previous, status: "Finalizado!" },
          );
          setMessage("Pasta de letras associada à base.");
        }
      } catch (error) {
        if (alive.current)
          setAlphabetUpload(
            (previous) =>
              previous && {
                ...previous,
                status: "Erro!",
                error: (error as Error).message,
              },
          );
        throw error;
      }
    });
  }
  function alphabetPicker(target: StaffPdfBase) {
    return (
      <>
        <label className="inline-flex cursor-pointer rounded-lg border border-gray-700 p-2 text-sm">
          Importar pasta de letras
          <input
            type="file"
            multiple
            accept="image/png"
            ref={(el) => {
              el?.setAttribute("webkitdirectory", "");
            }}
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              const files = Array.from(e.target.files || []) as File[];
              e.target.value = "";
              if (files.length) void importAlphabet(target, files);
            }}
          />
        </label>
        {alphabetUpload?.id === target.id && (
          <div role="status" className="min-w-36 text-xs text-gray-300">
            <p>{alphabetUpload.status}</p>
            {alphabetUpload.error && (
              <p className="mt-1 text-red-300">{alphabetUpload.error}</p>
            )}
            {alphabetUpload.status === "Em andamento..." && (
              <progress
                aria-label="Progresso da importação de letras"
                value={alphabetUpload.completed}
                max={alphabetUpload.total}
                className="block w-full accent-pink-500"
              />
            )}
          </div>
        )}
      </>
    );
  }
  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-gray-800 p-5">
        <h3 className="font-bold">Bases PDF exclusivas da equipe</h3>
        <p className="mt-2 text-sm text-gray-400">
          Cadastrar aqui não cria um produto nem publica o arquivo na loja. PDFs
          de 1 a 16 páginas mantêm suas páginas originais.
        </p>
        <StaffPdfBaseImport
          api={api}
          bases={data.bases}
          disabled={busy}
          onBusy={setImportBusy}
          onImported={reload}
        />
        <div className="mt-4 space-y-2">
          {data.pendingUploads?.map((b) => (
            <div
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-900 p-3"
            >
              <span className="break-words">
                {b.name} · Upload não concluído
              </span>
              <button
                disabled={busy}
                onClick={() =>
                  setConfirm({ kind: "base", id: b.id, name: b.name })
                }
              >
                Descartar envio interrompido
              </button>
            </div>
          ))}
          {[
            ...new Set(
              data.bases
                .filter((base) => base.source === "internal")
                .map((base) => base.category || UNCATEGORIZED_PDFS),
            ),
          ]
            .sort()
            .map((category) => (
              <details
                key={category}
                className="rounded-lg border border-gray-800 p-3"
              >
                <summary className="cursor-pointer font-semibold">
                  {category}
                </summary>
                <div className="mt-2 space-y-2">
                  {data.bases
                    .filter(
                      (base) =>
                        base.source === "internal" &&
                        (base.category || UNCATEGORIZED_PDFS) === category,
                    )
                    .map((b) => (
                      <div
                        key={b.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 p-3"
                      >
                        <span className="min-w-0 break-words">
                          {b.name} · {b.pageCount} páginas
                          {b.initialFolderName && (
                            <span className="block text-xs text-gray-300">
                              Pasta vinculada · {b.initialFolderName}
                            </span>
                          )}
                          {!!b.initialLetters?.length && (
                            <span className="block text-xs text-gray-400">
                              Letras cadastradas ·{" "}
                              {b.initialLetters.slice().sort().join(", ")}
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-lg border border-gray-700 p-2 text-sm"
                          onClick={() => edit(b)}
                        >
                          Editar {b.name}
                        </button>
                        {alphabetPicker(b)}
                        <button
                          disabled={busy}
                          onClick={() =>
                            setConfirm({ kind: "base", id: b.id, name: b.name })
                          }
                          className="text-sm text-red-300"
                        >
                          Excluir base
                        </button>
                      </div>
                    ))}
                </div>
              </details>
            ))}
        </div>
      </div>
      {!!catalogAlphabets.length && (
        <details className="space-y-3 rounded-2xl border border-gray-800 p-5">
          <summary className="cursor-pointer font-bold">
            Iniciais dos modelos de produtos
          </summary>
          <label className="block text-sm">
            Modelo de produto com letras
            <select
              className={input}
              disabled={busy}
              value={catalogBaseId}
              onChange={(event) => setCatalogBaseId(event.target.value)}
            >
              <option value="">Selecione um PDF</option>
              {catalogAlphabets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.productId}
                </option>
              ))}
            </select>
          </label>
          {catalogBase && (
            <form
              key={catalogBase.revision}
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const size = Number(
                  new FormData(event.currentTarget).get("initialSize"),
                );
                void run(async () => {
                  await api.saveCatalogInitialSize(catalogBase, size);
                  await reload();
                  setMessage("Tamanho da inicial salvo no modelo de produto.");
                });
              }}
            >
              <p className="text-xs text-gray-300">
                Pasta vinculada · {catalogBase.initialFolderName}
              </p>
              <label className="block max-w-xs text-sm">
                Tamanho da inicial do modelo (% da página)
                <input
                  className={input}
                  type="number"
                  name="initialSize"
                  min={5}
                  max={100}
                  step="any"
                  defaultValue={catalogBase.initialSizePercent ?? 60}
                  required
                  disabled={busy}
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg border border-gray-700 px-3 py-2 text-sm"
              >
                Salvar tamanho no modelo de produto
              </button>
            </form>
          )}
        </details>
      )}
      <div className="space-y-4 rounded-2xl border border-gray-800 p-5">
        <h3 className="font-bold">Moldes de edição · templates.json</h3>
        <p className="text-sm text-gray-400">
          Coordenadas do programa original em pixels a 300 DPI. A importação
          preserva moldes já cadastrados; altere cada um pelo editor.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            disabled={busy}
            onClick={() => open()}
            className="rounded-lg bg-purple-600 px-4 py-2"
          >
            Criar molde
          </button>
          <label
            className="cursor-pointer rounded-lg border border-dashed border-gray-600 px-4 py-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => drop(e, importTemplates)}
          >
            Importar ou soltar JSON
            <input
              disabled={busy}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                importTemplates(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <button
            disabled={busy || !data.layouts.length}
            className="rounded-lg border border-gray-700 px-4 py-2"
            onClick={() =>
              downloadPersonalization(
                new Blob(
                  [
                    JSON.stringify(
                      Object.fromEntries(
                        data.layouts.map((t) => [t.name, t.layout]),
                      ),
                      null,
                      2,
                    ),
                  ],
                  { type: "application/json" },
                ),
                "templates.json",
              )
            }
          >
            Exportar JSON
          </button>
        </div>
        <label className="block text-sm">
          Buscar molde
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={input}
          />
        </label>
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {data.layouts
            .filter((t) =>
              t.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
            )
            .map((t) => (
              <div
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 p-3"
              >
                <div className="min-w-0">
                  <p className="break-all font-medium">{t.name}</p>
                  <p className="text-xs text-gray-400">
                    {t.layout.font_name || "Fonte a definir"} ·{" "}
                    {t.layout.font_size}px · {t.layout.color}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button disabled={busy} onClick={() => open(t)}>
                    Editar molde
                  </button>
                  <button
                    disabled={busy}
                    className="text-red-300"
                    onClick={() =>
                      setConfirm({
                        kind: "layout",
                        id: t.id,
                        name: t.name,
                        revision: t.revision,
                      })
                    }
                  >
                    Excluir molde
                  </button>
                </div>
              </div>
            ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-green-300">
          {message}
        </p>
      )}
      {editing && (
        <EditorModal
          wide
          title="Editor de molde PDF"
          busy={busy}
          onClose={() => setEditing(null)}
          closeLabel="Fechar editor de molde"
          doneLabel="Voltar"
          footerText="Salvar altera o molde para novas edições. Itens já na fila precisam ser abertos novamente."
        >
          <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="min-w-0 space-y-4 lg:max-h-[67vh] lg:overflow-y-auto lg:pr-2">
              <label className="block">
                Nome do molde
                <input
                  aria-label="Nome do molde"
                  disabled={Boolean(editing.id)}
                  value={editing.name}
                  onChange={(e) =>
                    setEditing((old) => ({ ...old!, name: e.target.value }))
                  }
                  className={input}
                />
              </label>
              <p className="text-xs text-gray-400">
                Use um nome distinto para cada molde. A base e a categoria
                escolhidas ficam associadas a ele.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  Fonte padrão
                  <select
                    aria-label="Fonte padrão do molde"
                    value={editing.layout.font_name}
                    onChange={(e) => patch({ font_name: e.target.value })}
                    className={input}
                  >
                    <option value="">Definir durante a edição</option>
                    {editing.layout.font_name &&
                      !fonts.some(
                        (f) => f.nome === editing.layout.font_name,
                      ) && (
                        <option value={editing.layout.font_name}>
                          {editing.layout.font_name} · conferir cadastro
                        </option>
                      )}
                    {fonts
                      .filter((f) => f.ativo)
                      .map((f) => (
                        <option key={f.id} value={f.nome}>
                          {f.nome}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Tamanho padrão (px)
                  <input
                    type="number"
                    min={1}
                    max={4000}
                    value={editing.layout.font_size}
                    onChange={(e) =>
                      patch({ font_size: Number(e.target.value) })
                    }
                    className={input}
                  />
                </label>
                <label>
                  Cor padrão
                  <input
                    type="color"
                    value={editing.layout.color}
                    onChange={(e) => patch({ color: e.target.value })}
                    className={`${input} h-10`}
                  />
                </label>
                <label>
                  Alinhamento
                  <select
                    value={editing.layout.align}
                    onChange={(e) =>
                      patch({
                        align: e.target.value as StaffPdfLayout["align"],
                      })
                    }
                    className={input}
                  >
                    <option value="left">Esquerda</option>
                    <option value="center">Centro</option>
                    <option value="right">Direita</option>
                  </select>
                </label>
                <label>
                  Rotação do texto
                  <input
                    type="number"
                    min={-180}
                    max={180}
                    value={editing.layout.text_rotation}
                    onChange={(e) =>
                      patch({ text_rotation: Number(e.target.value) })
                    }
                    className={input}
                  />
                </label>
                <label>
                  Margem de ajuste (0 a 0,5)
                  <input
                    type="number"
                    min={0}
                    max={0.5}
                    step={0.01}
                    value={editing.layout.fit_margin}
                    onChange={(e) =>
                      patch({ fit_margin: Number(e.target.value) })
                    }
                    className={input}
                  />
                </label>
              </div>
              {(["portrait", "landscape"] as const).map((o) => (
                <fieldset
                  key={o}
                  className="rounded-xl border border-gray-700 p-3"
                >
                  <legend>
                    {o === "portrait"
                      ? "Retrato · página 1"
                      : "Paisagem · página 3 em PDFs de quatro páginas"}
                  </legend>
                  <div className="grid grid-cols-2 gap-3">
                    {(
                      [
                        "pos_x",
                        "pos_y",
                        "max_width_pixels",
                        "max_height_pixels",
                      ] as const
                    ).map((k) => {
                      const key = (
                        o === "portrait" ? k : `${k}_landscape`
                      ) as keyof StaffPdfLayout;
                      return (
                        <label key={key}>
                          {
                            {
                              pos_x: "X",
                              pos_y: "Y",
                              max_width_pixels: "Largura",
                              max_height_pixels: "Altura",
                            }[k]
                          }
                          <input
                            aria-label={`Molde ${key}`}
                            type="number"
                            min={k.startsWith("max_") ? 1 : 0}
                            max={60000}
                            value={Number(editing.layout[key])}
                            onChange={(e) =>
                              patch({ [key]: Number(e.target.value) })
                            }
                            className={input}
                          />
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.layout.imagem_full_page}
                  onChange={(e) =>
                    patch({ imagem_full_page: e.target.checked })
                  }
                />
                Inicial em página inteira (compatibilidade do molde)
              </label>
              <label className="block">
                Tamanho da inicial no molde (% da página)
                <input
                  type="number"
                  min={5}
                  max={100}
                  step="any"
                  placeholder={String(
                    editing.layout.imagem_full_page
                      ? 100
                      : (base?.initialSizePercent ?? 60),
                  )}
                  value={editing.layout.initial_size_percent ?? ""}
                  onChange={(event) =>
                    patch({
                      initial_size_percent:
                        event.target.value === ""
                          ? undefined
                          : Number(event.target.value),
                    })
                  }
                  className={input}
                />
              </label>
              {base?.initialFolderName && (
                <p className="text-xs text-gray-300">
                  Pasta vinculada · {base.initialFolderName}
                </p>
              )}
              <label className="block">
                Base para associar e testar
                <select
                  aria-label="Base para associar e testar"
                  value={baseId}
                  disabled={busy}
                  onChange={(e) => {
                    const id = e.target.value;
                    setBaseId(id);
                    patch({
                      base_pdf_name: data.bases.find((item) => item.id === id)
                        ?.name,
                      base_id: id || undefined,
                    });
                    setOriginal(null);
                    if (id)
                      void run(async () => {
                        setOriginal(await api.baseFile(id));
                      });
                  }}
                  className={input}
                >
                  <option value="">Selecione uma base</option>
                  {data.bases.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ·{" "}
                      {b.category ||
                        (b.source === "catalog"
                          ? "Produtos"
                          : UNCATEGORIZED_PDFS)}
                    </option>
                  ))}
                </select>
              </label>
              {base?.source === "internal" && (
                <div className="space-y-2 text-sm">
                  <p className="text-xs text-gray-300">
                    Pasta de letras da base “{alphabetFolderName(base.name)}”.
                    Use arquivos PNG como A.png e É.png.
                  </p>
                  {alphabetPicker(base)}
                </div>
              )}
              <label className="block">
                Texto de exemplo
                <input
                  value={sample}
                  onChange={(e) => setSample(e.target.value)}
                  className={input}
                />
              </label>
              {error && (
                <p role="alert" className="text-red-300">
                  {error}
                </p>
              )}
              <button
                disabled={busy}
                className="w-full rounded-xl bg-pink-500 p-3 font-bold disabled:opacity-40"
                onClick={() =>
                  void run(async () => {
                    const layout = normalizePdfLayout(editing.layout);
                    await api.saveLayout(
                      editing.name,
                      layout,
                      editing.revision,
                    );
                    await reload();
                    setEditing(null);
                    setMessage("Molde salvo.");
                  })
                }
              >
                Salvar molde
              </button>
            </div>
            <div className="min-w-0">
              {initialError && (
                <p role="alert" className="mb-2 text-sm text-red-300">
                  {initialError}
                </p>
              )}
              {original && base ? (
                <StaffPdfPreview
                  original={original}
                  initial={initial}
                  pageCount={base.pageCount}
                  lines={[
                    {
                      ...newPdfLine(editing.layout, fonts),
                      id: "sample",
                      text: sample,
                    },
                  ]}
                  fonts={fonts}
                  selected="sample"
                  fitMargin={editing.layout.fit_margin}
                  onMove={(_, x, y, orientation) =>
                    patch(
                      orientation === "portrait"
                        ? { pos_x: x, pos_y: y }
                        : { pos_x_landscape: x, pos_y_landscape: y },
                    )
                  }
                  onResize={(_, width, height, orientation) =>
                    patch(
                      orientation === "portrait"
                        ? { max_width_pixels: width, max_height_pixels: height }
                        : {
                            max_width_pixels_landscape: width,
                            max_height_pixels_landscape: height,
                          },
                    )
                  }
                />
              ) : (
                <p className="grid min-h-56 place-items-center rounded-xl bg-gray-950 p-3 text-sm text-gray-400">
                  Selecione um PDF para ajustar o molde sobre a página.
                </p>
              )}
            </div>
          </div>
        </EditorModal>
      )}
      {editBase && (
        <StaffPdfPicker
          title={`Escolher molde de ${editBase.name}`}
          options={[
            ...associated(editBase),
            { id: "new", name: "Criar outro molde para esta base" },
          ]}
          selected=""
          onClose={() => setEditBase(undefined)}
          onChoose={(id) => {
            open(
              data.layouts.find((row) => row.id === id),
              editBase,
            );
            setEditBase(undefined);
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={`Excluir ${confirm.kind === "base" ? "base PDF" : "molde"}?`}
          message={`“${confirm.name}” deixará de estar disponível para novas edições. Documentos já gerados permanecem disponíveis até expirarem.`}
          confirmLabel="Excluir"
          danger
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            void run(async () => {
              if (confirm.kind === "base") await api.deleteBase(confirm.id);
              else await api.deleteLayout(confirm.id, confirm.revision!);
              await reload();
              setConfirm(null);
              setMessage("Exclusão concluída.");
            })
          }
        />
      )}
    </section>
  );
}
