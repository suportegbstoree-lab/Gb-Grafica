import React from "react";
import EditorModal from "./EditorModal";
import ConfirmDialog from "./ConfirmDialog";
import StaffPdfPreview from "./StaffPdfPreview";
import {
  defaultPdfLayout,
  normalizePdfLayout,
  parsePdfLayoutMap,
  newPdfLine,
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
  const [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState(""),
    [message, setMessage] = React.useState(""),
    [query, setQuery] = React.useState(""),
    [replace, setReplace] = React.useState<{
      file: File;
      base: StaffPdfBase;
    }>();
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
  async function upload(file: File, replacement?: StaffPdfBase) {
    await api.uploadBase(file, crypto.randomUUID(), replacement);
    setReplace(undefined);
    await reload();
    setMessage(
      replacement
        ? "Base substituída."
        : "Base cadastrada. Crie ou associe um molde antes de editar.",
    );
  }
  function selectPdf(file?: File) {
    if (!file || running.current || replace) return;
    if (!/\.pdf$/i.test(file.name)) {
      setError("Selecione um PDF.");
      return;
    }
    const key = (name: string) => name.normalize("NFC").trim().toLowerCase();
    const existing = data.bases.filter(
      (item) => item.source === "internal" && key(item.name) === key(file.name),
    );
    const base =
      existing.find((item) => item.name === file.name) ??
      (existing.length === 1 ? existing[0] : undefined);
    if (base) {
      setError("");
      setReplace({ file, base });
    } else if (existing.length)
      setError(
        "Há mais de uma base com este nome. Use o nome exato da base a substituir.",
      );
    else void run(() => upload(file));
  }
  function importTemplates(file?: File) {
    if (!file || replace) return;
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
    if (running.current || replace) return;
    if (event.dataTransfer.files.length !== 1) {
      setError("Arraste um arquivo de cada vez.");
      return;
    }
    receive(event.dataTransfer.files[0]);
  }
  const open = (row?: StaffPdfLayoutView) => {
    setEditing(
      row ? structuredClone(row) : { name: "", layout: defaultPdfLayout() },
    );
    const linked =
      row?.layout.base_pdf_name &&
      data.bases.find((item) => item.name === row.layout.base_pdf_name);
    setBaseId(linked ? linked.id : "");
    setOriginal(null);
    setError("");
    if (linked)
      void run(async () => setOriginal(await api.baseFile(linked.id)));
  };
  const patch = (value: Partial<StaffPdfLayout>) =>
    setEditing((old) =>
      old ? { ...old, layout: { ...old.layout, ...value } } : old,
    );
  const base = data.bases.find((b) => b.id === baseId);
  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-gray-800 p-5">
        <h3 className="font-bold">Bases PDF exclusivas da equipe</h3>
        <p className="mt-2 text-sm text-gray-400">
          Cadastrar aqui não cria um produto nem publica o arquivo na loja. PDFs
          de 1 a 16 páginas mantêm suas páginas originais.
        </p>
        <label
          className="mt-4 block rounded-lg border border-dashed border-gray-600 p-3 text-sm"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => drop(e, selectPdf)}
        >
          Enviar base PDF ou soltar aqui
          <input
            disabled={busy}
            type="file"
            accept="application/pdf,.pdf"
            className="mt-2 block max-w-full"
            onChange={(e) => {
              selectPdf(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
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
          {data.bases
            .filter((b) => b.source === "internal")
            .map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 p-3"
              >
                <span className="min-w-0 break-words">
                  {b.name} · {b.pageCount} páginas
                </span>
                <label className="cursor-pointer rounded-lg border border-gray-700 p-2 text-sm">
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
                      if (files.length)
                        void run(async () => {
                          await api.uploadAlphabet(b, files);
                          await reload();
                          setMessage("Pasta de letras associada à base.");
                        });
                    }}
                  />
                </label>
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
      </div>
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
                Use o nome do PDF sem .pdf, ou o padrão legado Nome_template e
                Nome_template__4p. Nomes diferentes podem ser associados
                manualmente na edição.
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
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
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
              {original && base ? (
                <StaffPdfPreview
                  original={original}
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
      {replace && (
        <ConfirmDialog
          title="Substituir base PDF?"
          message={
            error ||
            `A base “${replace.base.name}” já existe. Os itens que usam a versão anterior precisarão ser revisados na fila.`
          }
          confirmLabel="Substituir PDF"
          busy={busy}
          onCancel={() => setReplace(undefined)}
          onConfirm={() => void run(() => upload(replace.file, replace.base))}
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
