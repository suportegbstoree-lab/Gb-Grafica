import React from "react";
import { PDFDocument } from "pdf-lib";
import type { PersonalizationFont } from "../lib/textCustomization";
import {
  matchPdfLayout,
  newPdfLine,
  normalizeStaffPdfJob,
  layoutFont,
  type StaffPdfJob,
  type StaffPdfLine,
  type StaffPdfBase,
} from "../lib/staffPdf";
import {
  staffPdfApi,
  type StaffPdfApi,
  type StaffPdfLibrary,
} from "../services/staffPdfService";
import { exportStaffPdf } from "../services/staffPdfRender";
import StaffPdfTextEditor from "./StaffPdfTextEditor";
import StaffPdfPreview from "./StaffPdfPreview";
import StaffPdfLibraryEditor from "./StaffPdfLibraryEditor";
import StaffSpreadsheetCsv from "./StaffSpreadsheetCsv";
import ConfirmDialog from "./ConfirmDialog";
import { useStaffPdfInitial } from "./useStaffPdfInitial";
import { beginWorkTask, workApi, type WorkApi } from "../services/workService";
interface QueueItem {
  id: string;
  requestId: string;
  job: StaffPdfJob;
  base: StaffPdfBase;
  original: Blob;
  fitMargin: number;
  status: "queued" | "processing" | "ready" | "error";
  error?: string;
  reference?: string;
}
const input =
  "mt-1 block w-full min-w-0 rounded-lg border border-gray-700 bg-black p-3";
export default function StaffPdfWorkspace({
  fonts,
  canManage = false,
  canGenerate = true,
  api = staffPdfApi,
  onGenerated,
  timingApi = workApi,
}: {
  fonts: PersonalizationFont[];
  canManage?: boolean;
  canGenerate?: boolean;
  api?: StaffPdfApi;
  onGenerated: () => Promise<void>;
  timingApi?: WorkApi;
}) {
  const [data, setData] = React.useState<StaffPdfLibrary>({
      bases: [],
      layouts: [],
      truncated: false,
    }),
    [tab, setTab] = React.useState(canGenerate ? "edit" : "library"),
    [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState(""),
    [message, setMessage] = React.useState(""),
    [query, setQuery] = React.useState("");
  const [baseId, setBaseId] = React.useState(""),
    [layoutId, setLayoutId] = React.useState(""),
    [loaded, setLoaded] = React.useState<{
      base: StaffPdfBase;
      original: Blob;
    } | null>(null),
    [lines, setLines] = React.useState<StaffPdfLine[]>([]),
    [editor, setEditor] = React.useState(false),
    [queue, setQueue] = React.useState<QueueItem[]>([]),
    [editingId, setEditingId] = React.useState<string | null>(null),
    [removeId, setRemoveId] = React.useState<string | null>(null);
  const alive = React.useRef(true),
    running = React.useRef(false),
    revision = React.useRef(0);
  React.useEffect(() => {
    if (loaded) return beginWorkTask("document", "", timingApi);
  }, [Boolean(loaded), timingApi]);
  const reload = React.useCallback(async () => {
    const result = await api.list();
    if (alive.current) setData(result);
  }, [api]);
  React.useEffect(() => {
    alive.current = true;
    void reload().catch((e) => {
      if (alive.current) setError(e.message);
    });
    return () => {
      alive.current = false;
      revision.current++;
    };
  }, [reload]);
  React.useEffect(() => {
    if (!queue.some((q) => q.status !== "ready")) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [queue]);
  const mold = data.layouts.find((t) => t.id === layoutId);
  const { initial, initialError } = useStaffPdfInitial(
    api,
    loaded?.base.id || "",
    lines.map((l) => l.text).join(" "),
    mold?.layout.imagem_full_page,
  );
  async function choose(id: string) {
    const version = ++revision.current;
    setBaseId(id);
    setLoaded(null);
    setLines([]);
    setEditingId(null);
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (!id) return;
      const b = data.bases.find((b) => b.id === id);
      if (!b) throw new Error("Base não encontrada.");
      const original = await api.baseFile(id),
        pdf = await PDFDocument.load(await original.arrayBuffer(), {
          updateMetadata: false,
        }),
        base = { ...b, pageCount: pdf.getPageCount() },
        layout = matchPdfLayout(base.name, base.pageCount, data.layouts);
      if (alive.current && version === revision.current) {
        setLoaded({ base, original });
        setLayoutId(layout?.id || "");
        setLines(layout ? [newPdfLine(layout.layout, fonts)] : []);
      }
    } catch (e) {
      if (version === revision.current) setError((e as Error).message);
    } finally {
      if (alive.current && version === revision.current) setBusy(false);
    }
  }
  async function process() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    let successes = 0;
    try {
      const current = await api.list();
      if (alive.current) setData(current);
      for (const item of queue.filter(
        (q) => q.status === "queued" || q.status === "error",
      )) {
        if (!alive.current) break;
        setQueue((old) =>
          old.map((q) =>
            q.id === item.id
              ? { ...q, status: "processing", error: undefined }
              : q,
          ),
        );
        try {
          const b = current.bases.find((b) => b.id === item.job.baseId),
            t = current.layouts.find((t) => t.id === item.job.layoutId);
          if (
            !b ||
            b.revision !== item.job.baseRevision ||
            !t ||
            t.revision !== item.job.layoutRevision
          )
            throw new Error(
              "A base ou o molde mudou. Edite este item novamente.",
            );
          const initial = await api.initial(
            item.job.baseId,
            item.job.lines.map((l) => l.text).join(" "),
          );
          if (initial && t.layout.imagem_full_page) initial.sizePercent = 100;
          const blob = await exportStaffPdf(
              item.original,
              item.job,
              fonts,
              item.fitMargin,
              initial,
            ),
            doc = await api.generate(item.job, blob, item.requestId);
          successes++;
          if (alive.current)
            setQueue((old) =>
              old.map((q) =>
                q.id === item.id
                  ? { ...q, status: "ready", reference: doc.reference }
                  : q,
              ),
            );
        } catch (e) {
          if (alive.current)
            setQueue((old) =>
              old.map((q) =>
                q.id === item.id
                  ? { ...q, status: "error", error: (e as Error).message }
                  : q,
              ),
            );
        }
      }
      if (alive.current) {
        await onGenerated();
        setMessage(
          `${successes} documento(s) concluído(s). Os arquivos estão em Documentos salvos.`,
        );
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function add() {
    try {
      if (!loaded || !mold) throw new Error("Escolha uma base e um molde.");
      const job = normalizeStaffPdfJob(
        {
          schemaVersion: 1,
          baseId: loaded.base.id,
          baseRevision: loaded.base.revision,
          layoutId: mold.id,
          layoutRevision: mold.revision,
          lines,
        },
        fonts,
      );
      if (!editingId && queue.length >= 50)
        throw new Error(
          "Processe ou remova itens antes de adicionar mais de 50.",
        );
      const item: QueueItem = {
        id: editingId || crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        job: structuredClone(job),
        base: { ...loaded.base },
        original: loaded.original,
        fitMargin: mold.layout.fit_margin,
        status: "queued",
      };
      setQueue((old) =>
        editingId
          ? old.map((q) => (q.id === editingId ? item : q))
          : [...old, item],
      );
      setLines([newPdfLine(mold.layout, fonts)]);
      setEditingId(null);
      setMessage("Arquivo adicionado à fila para revisão.");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="space-y-5 rounded-2xl border border-gray-800 p-4 sm:p-6">
      <div>
        <h3 className="text-xl font-bold">Oficina de PDFs da equipe</h3>
        <p className="mt-2 text-sm text-gray-400">
          Biblioteca independente de produtos, moldes do programa original e
          geração em lote.
        </p>
      </div>
      <nav
        aria-label="Ferramentas PDF da equipe"
        className="flex flex-wrap gap-2"
      >
        {canGenerate && (
          <button
            disabled={busy}
            onClick={() => setTab("edit")}
            aria-pressed={tab === "edit"}
            className="rounded-lg border border-gray-700 px-4 py-2"
          >
            Edição e fila
          </button>
        )}
        {canManage && (
          <button
            disabled={busy}
            onClick={() => setTab("library")}
            aria-pressed={tab === "library"}
            className="rounded-lg border border-gray-700 px-4 py-2"
          >
            Bases e moldes
          </button>
        )}
        {canGenerate && (
          <button
            disabled={busy}
            onClick={() => setTab("csv")}
            aria-pressed={tab === "csv"}
            className="rounded-lg border border-gray-700 px-4 py-2"
          >
            XLSX para CSV
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => void reload().catch((e) => setError(e.message))}
          className="ml-auto rounded-lg border border-gray-700 px-4 py-2"
        >
          Atualizar biblioteca
        </button>
      </nav>
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
      {data.truncated && (
        <p className="text-amber-300">
          A biblioteca excede os limites da listagem. Refine o cadastro antes de
          adicionar mais itens.
        </p>
      )}
      {tab === "library" && canManage && (
        <StaffPdfLibraryEditor
          data={data}
          api={api}
          fonts={fonts}
          reload={reload}
        />
      )}
      {tab === "csv" && canGenerate && <StaffSpreadsheetCsv />}
      {tab === "edit" && canGenerate && (
        <>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              Buscar base
              <input
                aria-label="Buscar base PDF"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={input}
              />
            </label>
            <label>
              Base PDF
              <select
                aria-label="Base PDF da equipe"
                disabled={busy}
                value={baseId}
                onChange={(e) => void choose(e.target.value)}
                className={input}
              >
                <option value="">Selecione o PDF</option>
                {data.bases
                  .filter(
                    (b) =>
                      b.name
                        .toLocaleLowerCase()
                        .includes(query.toLocaleLowerCase()) || b.id === baseId,
                  )
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ·{" "}
                      {b.source === "internal" ? "Interno" : "Produto"}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Template de edição
              <select
                aria-label="Template de edição da equipe"
                disabled={busy || !loaded}
                value={layoutId}
                onChange={(e) => {
                  const id = e.target.value,
                    t = data.layouts.find((t) => t.id === id);
                  setLayoutId(id);
                  setLines(t ? [newPdfLine(t.layout, fonts)] : []);
                  setEditingId(null);
                }}
                className={input}
              >
                <option value="">Selecione o molde</option>
                {data.layouts.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {busy && <p role="status">Processando...</p>}
          {loaded && !mold && (
            <p
              role="alert"
              className="rounded-lg bg-amber-950 p-3 text-sm text-amber-200"
            >
              Este PDF não possui um molde associado. Escolha um template
              existente ou peça a alguém com permissão de moldes para criar um
              antes de prosseguir.
            </p>
          )}
          {mold && mold.layout.font_name && !layoutFont(mold.layout, fonts) && (
            <p role="status" className="text-sm text-amber-200">
              A fonte “{mold.layout.font_name}” não está cadastrada ou ativa.
              Escolha uma fonte no editor, ou peça seu cadastro antes de gerar.
            </p>
          )}
          {loaded && mold && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-400">
                  {loaded.base.pageCount} páginas · Molde: {mold.name}
                </p>
                <button
                  disabled={busy}
                  onClick={() => setEditor(true)}
                  className="rounded-xl bg-purple-600 px-5 py-3"
                >
                  Editar texto e geometria
                </button>
              </div>
              <ul className="space-y-1 text-sm">
                {lines.map((l, i) => (
                  <li key={l.id} className="break-words">
                    Linha {i + 1}: {l.text || "Ainda sem texto"}
                  </li>
                ))}
              </ul>
              <StaffPdfPreview
                original={loaded.original}
                pageCount={loaded.base.pageCount}
                lines={lines}
                fonts={fonts}
                fitMargin={mold.layout.fit_margin}
                initial={initial}
              />
              {initialError && (
                <p role="alert" className="text-red-300">
                  {initialError}
                </p>
              )}
              <button
                disabled={busy || !lines.some((l) => l.text.trim())}
                className="w-full rounded-xl bg-pink-500 px-5 py-3 font-bold disabled:opacity-40"
                onClick={add}
              >
                {editingId ? "Atualizar item da fila" : "Adicionar à fila"}
              </button>
            </>
          )}
          <section className="space-y-3 border-t border-gray-800 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-lg font-bold">
                Fila principal · {queue.length}
              </h4>
              <button
                disabled={
                  busy ||
                  !queue.some(
                    (q) => q.status === "queued" || q.status === "error",
                  )
                }
                onClick={() => void process()}
                className="rounded-xl bg-pink-500 px-5 py-3 font-bold disabled:opacity-40"
              >
                Processar fila
              </button>
            </div>
            <p className="text-xs text-gray-400">
              A fila fica nesta sessão. Revise antes de processar. Fechar ou
              recarregar a página descarta os itens ainda não gerados.
            </p>
            {!queue.length && (
              <p className="text-sm text-gray-400">Nenhum arquivo na fila.</p>
            )}
            {queue.map((item) => (
              <article
                key={item.id}
                className="space-y-2 rounded-xl border border-gray-800 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h5 className="break-words font-bold">{item.base.name}</h5>
                  <span className="text-xs text-gray-400">
                    {
                      {
                        queued: "Na fila",
                        processing: "Processando",
                        ready: "Concluído",
                        error: "Precisa de ajuste",
                      }[item.status]
                    }
                  </span>
                </div>
                <p className="break-words text-sm">
                  {item.job.lines.map((l) => l.text).join(" / ")}
                </p>
                {item.error && (
                  <p role="alert" className="text-sm text-red-300">
                    {item.error}
                  </p>
                )}
                {item.reference && (
                  <p className="text-sm text-green-300">{item.reference}</p>
                )}
                <div className="flex gap-4">
                  <button
                    disabled={busy || item.status === "ready"}
                    onClick={() => {
                      const current = data.bases.find(
                          (b) => b.id === item.job.baseId,
                        ),
                        layout = data.layouts.find(
                          (t) => t.id === item.job.layoutId,
                        );
                      if (!current || !layout) {
                        setError(
                          "A base ou o molde foi excluído. Remova este item e escolha outra base.",
                        );
                        return;
                      }
                      setBaseId(current.id);
                      setLayoutId(layout.id);
                      setLoaded({
                        base: { ...current, pageCount: item.base.pageCount },
                        original: item.original,
                      });
                      setLines(structuredClone(item.job.lines));
                      setEditingId(item.id);
                      setMessage(
                        "Revise a edição e clique em Atualizar item da fila.",
                      );
                      setError("");
                    }}
                    className="text-sm disabled:opacity-40"
                  >
                    Editar item da fila
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setRemoveId(item.id)}
                    className="text-sm text-red-300 disabled:opacity-40"
                  >
                    Excluir da fila
                  </button>
                </div>
              </article>
            ))}
          </section>
        </>
      )}
      {editor && loaded && mold && (
        <StaffPdfTextEditor
          api={api}
          baseId={loaded.base.id}
          original={loaded.original}
          pageCount={loaded.base.pageCount}
          layout={mold.layout}
          fonts={fonts}
          initialLines={lines}
          onClose={() => setEditor(false)}
          onSave={(value) => {
            setLines(value);
            setEditor(false);
          }}
        />
      )}
      {removeId && (
        <ConfirmDialog
          title="Excluir item da fila?"
          message="O item sairá apenas da fila. A base PDF e os documentos já gerados serão preservados."
          confirmLabel="Excluir da fila"
          onCancel={() => setRemoveId(null)}
          onConfirm={() => {
            setQueue((old) => old.filter((q) => q.id !== removeId));
            if (editingId === removeId) setEditingId(null);
            setRemoveId(null);
          }}
        />
      )}
    </section>
  );
}
