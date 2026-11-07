import React from "react";
import { Search } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import type { PersonalizationFont } from "../lib/textCustomization";
import {
  matchPdfLayout,
  newPdfLine,
  normalizeStaffPdfJob,
  layoutFont,
  fixedStaffPdfMain,
  staffPdfFont,
  STAFF_PDF_SYSTEM_FONT,
  staffPdfOutputName,
  STAFF_PDF_MAX_LINES,
  STAFF_PDF_DPI,
  STAFF_PDF_MAX_PAGES,
  type PdfTextLayout,
  type StaffPdfLayoutView,
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
import { downloadPersonalization } from "../services/personalizationExport";
import StaffPdfTextEditor from "./StaffPdfTextEditor";
import StaffPdfPicker from "./StaffPdfPicker";
import StaffPdfPreview from "./StaffPdfPreview";
import StaffPdfLibraryEditor from "./StaffPdfLibraryEditor";
import StaffPdfCsvImport, { type StaffPdfCsvOrder } from "./StaffPdfCsvImport";
import ConfirmDialog from "./ConfirmDialog";
import EditorModal from "./EditorModal";
import { useStaffPdfInitial } from "./useStaffPdfInitial";
import { beginWorkTask, workApi, type WorkApi } from "../services/workService";
const QUEUE_LIMIT = 50;
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
    [picker, setPicker] = React.useState<"base" | "layout">(),
    [autoTemplate, setAutoTemplate] = React.useState(true);
  const [baseId, setBaseId] = React.useState(""),
    [layoutId, setLayoutId] = React.useState(""),
    [loaded, setLoaded] = React.useState<{
      base: StaffPdfBase;
      original: Blob;
    } | null>(null),
    [lines, setLines] = React.useState<StaffPdfLine[]>([]),
    [mainFormatting, setMainFormatting] = React.useState(false),
    [selected, setSelected] = React.useState<string>(),
    [outputName, setOutputName] = React.useState(""),
    [processing, setProcessing] = React.useState(false),
    [stopRequested, setStopRequested] = React.useState(false),
    [csvOpened, setCsvOpened] = React.useState(false),
    [queue, setQueue] = React.useState<QueueItem[]>([]),
    [editingId, setEditingId] = React.useState<string | null>(null),
    [removeId, setRemoveId] = React.useState<string | null>(null);
  const alive = React.useRef(true),
    running = React.useRef(false),
    stop = React.useRef(false),
    wakeProcessing = React.useRef<() => void>(),
    attempts = React.useRef<number[]>([]),
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
      wakeProcessing.current?.();
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
  const baseName = loaded?.base.name;
  const compatibleMolds = data.layouts.filter(
    (item) =>
      !item.layout.base_pdf_name ||
      item.layout.base_pdf_name.toLowerCase() === baseName?.toLowerCase() ||
      item.id === layoutId,
  );
  React.useEffect(() => {
    if (mold)
      setLines(([main, ...extras]) =>
        main?.kind === "main"
          ? [fixedStaffPdfMain(mold.layout, main), ...extras]
          : main
            ? [main, ...extras]
            : [],
      );
  }, [mold?.revision]);
  const { initial, initialError } = useStaffPdfInitial(
    api,
    loaded?.base.id || "",
    lines[0]?.text || "",
    mold?.layout.imagem_full_page,
  );
  const mainFrom = (mold: StaffPdfLayoutView) =>
    fixedStaffPdfMain(mold.layout, newPdfLine(mold.layout, fonts));
  function loadLines(next: StaffPdfLine[]) {
    setMainFormatting(false);
    setLines(next);
    setSelected(next[0]?.id);
  }
  async function readBase(base: StaffPdfBase) {
    const original = await api.baseFile(base.id);
    const pdf = await PDFDocument.load(await original.arrayBuffer(), {
      updateMetadata: false,
    });
    const pages = pdf.getPages().map((page) => {
      const crop = page.getCropBox();
      return Math.abs(page.getRotation().angle) % 180 === 90
        ? { width: crop.height, height: crop.width }
        : { width: crop.width, height: crop.height };
    });
    if (!pages.length || pages.length > STAFF_PDF_MAX_PAGES)
      throw new Error("Quantidade de páginas não suportada.");
    return {
      base: { ...base, pageCount: pages.length, pages },
      original,
    };
  }
  function queueItem(
    source: NonNullable<typeof loaded>,
    layout: StaffPdfLayoutView,
    textLines: StaffPdfLine[],
    name: string,
    id = crypto.randomUUID(),
  ): QueueItem {
    const filename = staffPdfOutputName(name);
    const job = normalizeStaffPdfJob(
      {
        schemaVersion: 1,
        baseId: source.base.id,
        baseRevision: source.base.revision,
        layoutId: layout.id,
        layoutRevision: layout.revision,
        lines: textLines
          .filter((line) => line.kind === "main" || line.text.trim())
          .map((line) =>
            line.kind === "main"
              ? fixedStaffPdfMain(layout.layout, line)
              : line,
          ),
        ...(filename ? { outputName: filename } : {}),
      },
      fonts,
    );
    return {
      id,
      requestId: crypto.randomUUID(),
      job,
      base: source.base,
      original: source.original,
      fitMargin: layout.layout.fit_margin,
      status: "queued",
    };
  }
  async function importOrders(orders: StaffPdfCsvOrder[]) {
    if (running.current || orders.length > QUEUE_LIMIT - queue.length)
      throw new Error("Confira as vagas na fila antes de importar.");
    running.current = true;
    setBusy(true);
    try {
      const library = await api.list();
      if (alive.current) setData(library);
      const sources = new Map<string, NonNullable<typeof loaded>>();
      const items: QueueItem[] = [];
      for (const order of orders) {
        if (!alive.current) return;
        const base = library.bases.find((b) => b.id === order.baseId);
        const layout = library.layouts.find((t) => t.id === order.layoutId);
        if (!base || !layout)
          throw new Error(
            "Uma base ou um molde foi removido. Revise a importação.",
          );

        let source = sources.get(base.id);
        if (!source) {
          source =
            loaded?.base.id === base.id &&
            loaded.base.revision === base.revision
              ? loaded
              : await readBase(base);
          sources.set(base.id, source);
        }
        const line = mainFrom(layout);
        line.text = order.text;

        items.push(queueItem(source, layout, [line], order.outputName));
      }
      if (alive.current) {
        setQueue((old) => [...old, ...items]);
        setMessage(
          `${items.length} pedido(s) importado(s). Revise antes de processar.`,
        );
        setError("");
      }
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function saveQueue() {
    const items = queue
      .filter((item) => item.status !== "ready")
      .map(({ requestId, job }) => ({ requestId, job }));
    downloadPersonalization(
      new Blob([JSON.stringify({ schemaVersion: 1, items }, null, 2)], {
        type: "application/json",
      }),
      "fila-pdfs.json",
    );
  }
  async function loadQueue(file: File) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Envie um JSON de fila de até 5 MB.");
      const value = JSON.parse(await file.text());
      if (
        value?.schemaVersion !== 1 ||
        !Array.isArray(value.items) ||
        value.items.length > QUEUE_LIMIT
      )
        throw new Error("Selecione um JSON de fila salvo na oficina.");
      const seen = new Set(queue.map((item) => item.requestId));
      const incoming = [];
      for (const item of value.items) {
        const id = item?.requestId;
        if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
          throw new Error("Identificador de pedido inválido no JSON.");
        if (seen.has(id)) continue;
        seen.add(id);
        incoming.push({
          requestId: id,
          job: normalizeStaffPdfJob(item.job, fonts),
        });
      }
      if (incoming.length > QUEUE_LIMIT - queue.length)
        throw new Error("O JSON possui mais pedidos do que vagas na fila.");
      const library = await api.list();
      if (alive.current) setData(library);
      const sources = new Map<string, NonNullable<typeof loaded>>();
      const items: QueueItem[] = [];
      for (const { requestId, job } of incoming) {
        if (!alive.current) return;
        const base = library.bases.find((b) => b.id === job.baseId);
        const layout = library.layouts.find((t) => t.id === job.layoutId);
        if (!base || !layout)
          throw new Error(
            "Um pedido do JSON aponta para uma base ou um molde que foi excluído.",
          );
        let source = sources.get(base.id);
        if (!source) {
          source = await readBase(base);
          sources.set(base.id, source);
        }
        const stale =
          base.revision !== job.baseRevision ||
          layout.revision !== job.layoutRevision;
        items.push({
          id: crypto.randomUUID(),
          requestId,
          job,
          base: source.base,
          original: source.original,
          fitMargin: layout.layout.fit_margin,
          status: stale ? "error" : "queued",
          ...(stale
            ? {
                error:
                  "A base ou o molde mudou. Abra este item e revise a edição.",
              }
            : {}),
        });
      }
      if (alive.current) {
        setQueue((old) => [...old, ...items]);
        setMessage(`${items.length} pedido(s) recuperado(s) do JSON da fila.`);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function choose(id: string, item?: QueueItem) {
    const version = ++revision.current;
    setBaseId(id);
    setLoaded(null);
    loadLines([]);
    setEditingId(null);
    setOutputName("");
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (!id) return;
      const b = data.bases.find((b) => b.id === id);
      if (!b) throw new Error("Base não encontrada.");
      const previousLayout =
        item && data.layouts.find((t) => t.id === item.job.layoutId);
      const source =
        item && b.revision === item.base.revision
          ? { base: item.base, original: item.original }
          : await readBase(b);
      const layout =
        previousLayout ||
        (autoTemplate
          ? matchPdfLayout(
              source.base.name,
              source.base.pageCount,
              data.layouts,
            )
          : undefined);
      if (alive.current && version === revision.current) {
        setLoaded(source);
        setLayoutId(layout?.id || "");
        loadLines(
          layout
            ? item
              ? item.job.lines.map((line, index) => {
                  const restored = staffPdfFont(line.fontId, fonts)
                    ? line
                    : { ...line, fontId: STAFF_PDF_SYSTEM_FONT.id };
                  return index
                    ? { ...restored, kind: "extra" as const }
                    : fixedStaffPdfMain(layout.layout, restored);
                })
              : [mainFrom(layout)]
            : item
              ? structuredClone(item.job.lines)
              : [],
        );
        if (item) {
          setEditingId(item.id);
          setOutputName(item.job.outputName || "");
          setMessage(
            previousLayout
              ? "Revise a edição e clique em Atualizar item da fila."
              : "O molde anterior foi excluído. Confira o molde antes de atualizar este pedido.",
          );
        }
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
    stop.current = false;
    setStopRequested(false);
    setProcessing(true);
    setBusy(true);
    setError("");
    let successes = 0;
    try {
      const current = await api.list();
      if (alive.current) setData(current);
      for (const item of queue.filter(
        (q) => q.status === "queued" || q.status === "error",
      )) {
        if (!alive.current || stop.current) break;
        attempts.current = attempts.current.filter(
          (time) => Date.now() - time < 61000,
        );
        if (attempts.current.length >= 20) {
          setMessage("Aguardando o limite de geração para continuar a fila.");
          await new Promise<void>((resolve) => {
            const timer = window.setTimeout(
              resolve,
              61000 - (Date.now() - attempts.current[0]),
            );
            wakeProcessing.current = () => {
              window.clearTimeout(timer);
              resolve();
            };
          });
          wakeProcessing.current = undefined;
          if (!alive.current || stop.current) break;
          attempts.current.shift();
          setMessage("");
        }
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
            item.job.lines[0]?.text || "",
          );
          if (initial && t.layout.imagem_full_page) initial.sizePercent = 100;
          const blob = await exportStaffPdf(
            item.original,
            item.job,
            fonts,
            item.fitMargin,
            initial,
          );
          attempts.current.push(Date.now());
          const doc = await api.generate(item.job, blob, item.requestId);
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
          `${successes} documento(s) concluído(s). ${stop.current ? "A fila foi pausada. " : ""}Veja os arquivos em Documentos salvos.`,
        );
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      running.current = false;
      if (alive.current) {
        setBusy(false);
        setProcessing(false);
      }
    }
  }
  function add() {
    try {
      if (!loaded || !mold) throw new Error("Escolha uma base e um molde.");
      if (!editingId && queue.length >= QUEUE_LIMIT)
        throw new Error(
          "Remova itens da fila antes de adicionar novos pedidos.",
        );
      const item = queueItem(
        loaded,
        mold,
        lines,
        outputName,
        editingId ?? undefined,
      );
      setQueue((old) =>
        editingId
          ? old.map((q) => (q.id === editingId ? item : q))
          : [...old, item],
      );
      loadLines([mainFrom(mold)]);
      setOutputName("");
      setEditingId(null);
      setMessage(
        editingId
          ? "Pedido atualizado na fila."
          : "Arquivo adicionado à fila para revisão.",
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const move = React.useCallback(
    (id: string, x: number, y: number, orientation: PdfTextLayout) =>
      setLines((old) =>
        old.map((line) =>
          line.id === id && line.kind === "extra"
            ? { ...line, [orientation]: { ...line[orientation], x, y } }
            : line,
        ),
      ),
    [],
  );
  function updateMain(patch: Partial<StaffPdfLine>) {
    setLines(([main, ...extras]) =>
      main ? [{ ...main, ...patch }, ...extras] : [],
    );
  }
  function addLine() {
    if (!mold || !loaded) return;
    const line = newPdfLine(mold.layout, fonts, lines.length);
    line.kind = "extra";
    line.text = `Texto ${lines.length + 1}`;
    const dimensions = loaded.base.pages;
    for (const [orientation, index] of [
      ["portrait", 0],
      ["landscape", 2],
    ] as const) {
      const page = dimensions[index];
      if (!page) continue;
      const width = Math.ceil(
        ((orientation === "portrait" ? page.width : page.height) *
          STAFF_PDF_DPI) /
          72,
      );
      const height = Math.ceil(
        ((orientation === "portrait" ? page.height : page.width) *
          STAFF_PDF_DPI) /
          72,
      );
      const box = line[orientation];
      box.width = Math.min(box.width, width);
      box.height = Math.min(box.height, height);
      box.x = Math.round((width - box.width) / 2);
      box.y = Math.round((height - box.height) / 2);
    }
    setLines((old) => [...old, line]);
    setSelected(line.id);
  }
  function chooseLayout(id: string) {
    const layout = data.layouts.find((item) => item.id === id);
    setLayoutId(id);
    if (layout)
      loadLines([
        { ...mainFrom(layout), text: lines[0]?.text || "" },
        ...lines.slice(1),
      ]);
  }
  function updateLine(id: string, patch: Partial<StaffPdfLine>) {
    setLines((old) =>
      old.map((line) => {
        if (line.id !== id) return line;
        return mold && line.kind === "main"
          ? fixedStaffPdfMain(mold.layout, { ...line, ...patch })
          : { ...line, ...patch };
      }),
    );
  }
  const main = lines[0];
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
            onClick={() => {
              setCsvOpened(true);
              setTab("csv");
            }}
            aria-pressed={tab === "csv"}
            className="rounded-lg border border-gray-700 px-4 py-2"
          >
            Planilha e CSV
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
      {csvOpened && canGenerate && (
        <div hidden={tab !== "csv"}>
          <StaffPdfCsvImport
            data={data}
            fonts={fonts}
            busy={busy}
            available={QUEUE_LIMIT - queue.length}
            fallback={{ baseId: loaded?.base.id || "", layoutId }}
            onAdd={importOrders}
            onReviewQueue={() => setTab("edit")}
          />
        </div>
      )}
      {tab === "edit" && canGenerate && (
        <>
          <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(17rem,1fr)_minmax(0,2fr)]">
            <div className="min-w-0 space-y-4 rounded-xl border border-gray-800 p-4 lg:max-h-[75vh] lg:overflow-y-auto">
              <h4 className="text-base font-bold">Configuração do pedido</h4>
              <label className="block text-sm">
                Nome do arquivo final (opcional)
                <input
                  disabled={busy}
                  className={input}
                  maxLength={124}
                  value={outputName}
                  placeholder={loaded?.base.name}
                  onChange={(e) => setOutputName(e.target.value)}
                />
              </label>
              <div className="grid min-w-0 gap-3 text-sm">
                <div className="flex items-end gap-2">
                  <label className="min-w-0 flex-1">
                    Base PDF
                    <select
                      aria-label="Base PDF da equipe"
                      disabled={busy}
                      value={baseId}
                      onChange={(e) => void choose(e.target.value)}
                      className={input}
                    >
                      <option value="">Selecione o PDF</option>
                      {data.bases.map((base) => (
                        <option key={base.id} value={base.id}>
                          {base.name} ·{" "}
                          {base.source === "internal" ? "Interno" : "Produto"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    aria-label="Buscar base PDF"
                    title="Buscar base PDF"
                    disabled={busy}
                    className="rounded-lg border border-gray-700 p-3 disabled:opacity-40"
                    onClick={() => setPicker("base")}
                  >
                    <Search aria-hidden="true" size={20} />
                  </button>
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={autoTemplate}
                    disabled={busy}
                    onChange={(e) => setAutoTemplate(e.target.checked)}
                  />
                  Selecionar molde pelo nome da base
                </label>
                <div className="flex items-end gap-2">
                  <label className="min-w-0 flex-1">
                    Molde PDF
                    <select
                      aria-label="Molde PDF da equipe"
                      disabled={busy || !loaded}
                      value={layoutId}
                      onChange={(e) => chooseLayout(e.target.value)}
                      className={input}
                    >
                      <option value="">Selecione o molde</option>
                      {compatibleMolds.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    aria-label="Buscar molde PDF"
                    title="Buscar molde PDF"
                    disabled={busy || !loaded}
                    className="rounded-lg border border-gray-700 p-3 disabled:opacity-40"
                    onClick={() => setPicker("layout")}
                  >
                    <Search aria-hidden="true" size={20} />
                  </button>
                </div>
              </div>
              {loaded && !mold && (
                <p
                  role="alert"
                  className="rounded-lg bg-amber-950 p-3 text-sm text-amber-200"
                >
                  Este PDF não possui um molde associado. Escolha um template
                  existente ou peça a alguém com permissão de moldes para criar
                  um antes de prosseguir.
                </p>
              )}
              {mold &&
                mold.layout.font_name &&
                !layoutFont(mold.layout, fonts) && (
                  <p role="status" className="text-sm text-amber-200">
                    Fonte {mold.layout.font_name} não encontrada, por favor
                    cadastre a fonte nas configurações de fontes para que o
                    sistema possa utilizá-la.
                    {main?.fontId === STAFF_PDF_SYSTEM_FONT.id &&
                      " Usando a fonte padrão do sistema."}
                  </p>
                )}
              {main && mold && (
                <div className="space-y-3 text-sm">
                  <label className="block">
                    Texto principal
                    <textarea
                      disabled={busy}
                      value={main.text}
                      maxLength={500}
                      rows={2}
                      onChange={(e) => updateMain({ text: e.target.value })}
                      className={input}
                    />
                  </label>
                  <button
                    disabled={busy || lines.length >= STAFF_PDF_MAX_LINES}
                    type="button"
                    className="rounded-lg bg-purple-600 px-3 py-2 disabled:opacity-40"
                    onClick={addLine}
                  >
                    Adicionar linha de texto
                  </button>
                  {lines.length > 1 && (
                    <ul className="space-y-1">
                      {lines.slice(1).map((line, index) => (
                        <li key={line.id} className="flex min-w-0 gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            className="min-w-0 flex-1 truncate rounded border border-gray-700 p-2 text-left"
                            onClick={() => {
                              setSelected(line.id);
                            }}
                          >
                            {line.text || `Linha ${index + 2}`}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="px-2 text-red-300"
                            aria-label={`Remover linha ${index + 2}`}
                            onClick={() => {
                              setLines((old) =>
                                old.filter((l) => l.id !== line.id),
                              );
                              if (selected === line.id) setSelected(main.id);
                            }}
                          >
                            Remover
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <button
                type="button"
                disabled={busy}
                className="rounded-lg border border-gray-700 px-3 py-2 text-sm"
                onClick={() => {
                  setCsvOpened(true);
                  setTab("csv");
                }}
              >
                Importar CSV ou XLSX
              </button>
              <section className="space-y-3 border-t border-gray-800 pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h4 className="text-lg font-bold">
                    Fila principal · {queue.length}
                  </h4>
                  {queue.some((q) => q.status === "ready") && (
                    <button
                      type="button"
                      className="text-xs text-gray-300"
                      disabled={busy}
                      onClick={() =>
                        setQueue((old) =>
                          old.filter((q) => q.status !== "ready"),
                        )
                      }
                    >
                      Limpar concluídos
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400">
                  A fila fica nesta sessão. Revise antes de processar. Fechar ou
                  recarregar a página descarta os itens ainda não gerados.
                </p>
                {!queue.length && (
                  <p className="text-sm text-gray-400">
                    Nenhum arquivo na fila.
                  </p>
                )}
                {queue.map((item) => (
                  <article
                    key={item.id}
                    className="space-y-2 rounded-xl border border-gray-800 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h5 className="break-words font-bold">
                        {item.job.outputName || item.base.name}
                      </h5>
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
                        onClick={() => void choose(item.job.baseId, item)}
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
            </div>
            <div className="min-w-0 space-y-3 rounded-xl border border-gray-800 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-base font-bold">Prévia do PDF</h4>
                {loaded && mold && main && lines.length === 1 && (
                  <button
                    type="button"
                    disabled={busy}
                    aria-expanded={mainFormatting}
                    onClick={() => setMainFormatting(!mainFormatting)}
                    className="rounded-lg border border-gray-700 px-3 py-2 text-sm"
                  >
                    Fonte e tamanho
                  </button>
                )}
              </div>
              {mold && lines.length > 1 && (
                <StaffPdfTextEditor
                  lines={lines}
                  selected={selected}
                  fonts={fonts}
                  disabled={busy}
                  onSelect={setSelected}
                  onChange={updateLine}
                />
              )}
              {loaded ? (
                <StaffPdfPreview
                  original={loaded.original}
                  pageCount={loaded.base.pageCount}
                  lines={lines}
                  fonts={fonts}
                  selected={selected}
                  onSelect={busy ? undefined : setSelected}
                  onMove={busy ? undefined : move}
                  onEdit={
                    busy || !mold
                      ? undefined
                      : (id) => {
                          setSelected(id);
                          if (lines.length === 1) setMainFormatting(true);
                        }
                  }
                  fitMargin={mold?.layout.fit_margin}
                  initial={initial}
                />
              ) : (
                <p className="grid min-h-56 place-items-center text-sm text-gray-400">
                  Escolha uma base para abrir a prévia.
                </p>
              )}
              {initialError && (
                <p role="alert" className="text-red-300">
                  {initialError}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-gray-800 pt-3">
            <button
              type="button"
              disabled={busy || !queue.some((item) => item.status !== "ready")}
              className="rounded-xl border border-gray-700 px-4 py-2 disabled:opacity-40"
              onClick={saveQueue}
            >
              Salvar fila em JSON
            </button>
            <label className="cursor-pointer rounded-xl border border-gray-700 px-4 py-2 focus-within:ring-2 focus-within:ring-pink-400">
              Carregar fila JSON
              <input
                type="file"
                accept=".json,application/json"
                disabled={busy}
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void loadQueue(file);
                }}
              />
            </label>
            <button
              type="button"
              disabled={
                busy || !mold || !lines.some((line) => line.text.trim())
              }
              className="rounded-xl bg-pink-600 px-4 py-2 font-bold disabled:opacity-40"
              onClick={add}
            >
              {editingId ? "Atualizar item da fila" : "Adicionar à fila"}
            </button>
            {editingId && (
              <button
                type="button"
                disabled={busy}
                className="rounded-xl border border-gray-700 px-4 py-2"
                onClick={() => {
                  setEditingId(null);
                  setOutputName("");
                  loadLines(mold ? [mainFrom(mold)] : []);
                }}
              >
                Cancelar revisão
              </button>
            )}
            <button
              type="button"
              disabled={
                busy ||
                !queue.some(
                  (item) => item.status === "queued" || item.status === "error",
                )
              }
              className="rounded-xl bg-purple-600 px-4 py-2 font-bold disabled:opacity-40"
              onClick={() => void process()}
            >
              Processar fila
            </button>
            {processing && (
              <button
                type="button"
                disabled={stopRequested}
                className="rounded-xl border border-gray-700 px-4 py-2"
                onClick={() => {
                  stop.current = true;
                  wakeProcessing.current?.();
                  setStopRequested(true);
                }}
              >
                {stopRequested
                  ? "Parando após o pedido atual…"
                  : "Parar após este pedido"}
              </button>
            )}
          </div>
        </>
      )}
      {mainFormatting && mold && lines.length === 1 && (
        <EditorModal
          title="Fonte e tamanho do texto principal"
          onClose={() => setMainFormatting(false)}
          closeLabel="Fechar formatação principal"
          doneLabel="Concluir"
          footerText=""
        >
          <StaffPdfTextEditor
            lines={lines}
            selected={selected}
            fonts={fonts}
            disabled={busy}
            onSelect={setSelected}
            onChange={updateLine}
          />
        </EditorModal>
      )}
      {picker && (
        <StaffPdfPicker
          title={picker === "base" ? "Buscar base PDF" : "Buscar molde PDF"}
          options={
            picker === "base"
              ? data.bases.map((base) => ({
                  id: base.id,
                  name: `${base.name} · ${base.source === "internal" ? "Interno" : "Produto"}`,
                }))
              : compatibleMolds
          }
          selected={picker === "base" ? baseId : layoutId}
          onClose={() => setPicker(undefined)}
          onChoose={(id) =>
            picker === "base" ? void choose(id) : chooseLayout(id)
          }
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
