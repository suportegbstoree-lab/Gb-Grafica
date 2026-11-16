import React from "react";
import {
  DEFAULT_STAFF_BARCODE_SIZE,
  normalizeStaffBarcode,
  normalizeStaffBarcodeSize,
  staffBarcodeBoxes,
  staffPdfDefaultFilename,
  STAFF_PDF_BARCODE_DEFAULT,
  STAFF_BARCODE_VERSION,
  type StaffBarcodeSize,
} from "../lib/staffPdfBarcode";
import {
  createStaffPdfAssetCache,
  loadStaffPdfArchive,
  renderStaffPdfRecipe,
  retryStaffPdfRateLimit,
} from "../services/staffPdfBatchService";
import { useStaffPdfDraft, useStaffPdfQueue } from "../services/staffPdfLocalState";
import StaffPdfBatches from "./StaffPdfBatches";
import StaffPdfQueueProgress, {
  type StaffPdfQueueProgressValue,
} from "./StaffPdfQueueProgress";
import { STAFF_PDF_BATCH_NAME_MAX, type StaffPdfRecipe } from "../lib/staffPdfBatch";
import { formatStaffPdfPersonName } from "../lib/staffPdfCsv";
import { Barcode, Edit2, Search, Trash2 } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import type { PersonalizationFont } from "../lib/textCustomization";
import {
  matchPdfLayout,
  compareStaffPdfNames,
  staffPdfInitialSize,
  staffPdfSourceName,
  newPdfLine,
  normalizeStaffPdfJob,
  layoutFont,
  fixedStaffPdfMain,
  staffPdfLayoutLines,
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
import StaffPdfCsvImport, {
  type StaffPdfCsvOrder,
  type StaffPdfCsvImportHandle,
  type StaffPdfCsvNamePaste,
} from "./StaffPdfCsvImport";
import ConfirmDialog from "./ConfirmDialog";
import EditorModal from "./EditorModal";
import { useStaffPdfInitial } from "./useStaffPdfInitial";
import { beginWorkTask, workApi, type WorkApi } from "../services/workService";
const QUEUE_PAGE_SIZE = 50;
interface QueueItem {
  id: string;
  requestId: string;
  job: StaffPdfJob;
  base: StaffPdfBase;
  original?: Blob;
  fitMargin: number;
  useBarcodeDefault?: boolean;
  batchId?: string;
  batchPlan?: { requestId: string; name?: string };
  csvRow?: StaffPdfCsvOrder["csvRow"];
  csvWarning?: string;
  status: "queued" | "processing" | "ready" | "error";
  error?: string;
  reference?: string;
}
type BarcodeEditorTarget = "default" | "draft" | QueueItem;
function sameBarcodeSize(a: StaffBarcodeSize, b: StaffBarcodeSize) {
  return a.widthMm === b.widthMm &&
    a.heightMm === b.heightMm &&
    a.horizontalScale === b.horizontalScale;
}
function barcodeOverrideOf(item: QueueItem) {
  const size = item.job.barcodeSize;
  const inherits = item.useBarcodeDefault ?? (!size || sameBarcodeSize(size, DEFAULT_STAFF_BARCODE_SIZE));
  return inherits ? undefined : size;
}
const input =
  "mt-1 block w-full min-w-0 rounded-lg border border-gray-700 bg-black p-3";
const csvRowKey = ({ sourceId, index }: StaffPdfCsvOrder["csvRow"]) =>
  `${sourceId}:${index}`;
const wasDisconnected = (error: unknown) =>
  !navigator.onLine ||
  (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) ||
  (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name));
const BATCH_RENDER_LIMIT = 4;
// A new PDF normally uses three requests and the library allows 90 per minute.
const BATCH_ATTEMPTS_PER_WINDOW = 26;
const GENERATION_WINDOW_MS = 61000;
export default function StaffPdfWorkspace({
  fonts,
  canManage = false,
  canGenerate = true,
  api = staffPdfApi,
  onGenerated,
  timingApi = workApi,
  visible = true,
  onProgress,
  storageOwner,
}: {
  fonts: PersonalizationFont[];
  canManage?: boolean;
  canGenerate?: boolean;
  api?: StaffPdfApi;
  onGenerated: () => Promise<void>;
  timingApi?: WorkApi;
  visible?: boolean;
  onProgress?: (value: StaffPdfQueueProgressValue) => void;
  storageOwner?: string;
}) {
  const { queue, current: savedQueue, update: setQueue, flush: flushQueue, ready: queueReady, error: queueError } =
    useStaffPdfQueue<QueueItem>(canGenerate ? storageOwner : undefined);
  const batchDraft = useStaffPdfDraft(canGenerate ? storageOwner : undefined, "batchName", "");
  const batchName = batchDraft.value;
  const [library, setData] = React.useState<StaffPdfLibrary>({
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
  const data = React.useMemo(
    () => ({
      ...library,
      bases: [...library.bases].sort((a, b) =>
        compareStaffPdfNames(a.name, b.name),
      ),
      layouts: [...library.layouts].sort((a, b) =>
        compareStaffPdfNames(a.name, b.name),
      ),
    }),
    [library],
  );
  const [baseId, setBaseId] = React.useState(""),
    [layoutId, setLayoutId] = React.useState(""),
    [loaded, setLoaded] = React.useState<{
      base: StaffPdfBase;
      original: Blob;
    } | null>(null),
    [lines, setLines] = React.useState<StaffPdfLine[]>([]),
    [mainFormatting, setMainFormatting] = React.useState(false),
    [selected, setSelected] = React.useState<string>(),
    [barcode, setBarcode] = React.useState(""),
    [barcodeOverride, setBarcodeOverride] = React.useState<StaffBarcodeSize>(),
    [barcodeEditor, setBarcodeEditor] = React.useState<BarcodeEditorTarget>(),
    [barcodeDraft, setBarcodeDraft] = React.useState(""),
    [barcodeSizeDraft, setBarcodeSizeDraft] = React.useState<StaffBarcodeSize>(
      STAFF_PDF_BARCODE_DEFAULT,
    ),
    [barcodeInherits, setBarcodeInherits] = React.useState(true),
    [batchRevision, setBatchRevision] = React.useState(0),
    [outputName, setOutputName] = React.useState(""),
    [processing, setProcessing] = React.useState(false),
    [progress, setProgress] = React.useState<StaffPdfQueueProgressValue>(),
    [stopRequested, setStopRequested] = React.useState(false),
    [csvReview, setCsvReview] = React.useState(0),
    [confirmBlanks, setConfirmBlanks] = React.useState(false),
    [queuePage, setQueuePage] = React.useState(0),
    [editingId, setEditingId] = React.useState<string | null>(null),
    [removeId, setRemoveId] = React.useState<string | null>(null),
    [clearQueue, setClearQueue] = React.useState(false);
  const barcodeDefault = data.barcodeDefault ?? STAFF_PDF_BARCODE_DEFAULT;
  const barcodeSize = barcodeOverride ?? barcodeDefault;
  const alive = React.useRef(true),
    running = React.useRef(false),
    stop = React.useRef(false),
    wakeProcessing = React.useRef<() => void>(),
    attempts = React.useRef<number[]>([]),
    revision = React.useRef(0);
  const lockedCsvRows = React.useRef(new Set<string>());
  const csvImport = React.useRef<StaffPdfCsvImportHandle>(null);
  const isCsvName = (row?: StaffPdfCsvOrder["csvRow"]) =>
    row && (row.textIsName === true || csvImport.current?.isNameColumn(row));
  const generationAllowed = React.useRef(canGenerate);
  generationAllowed.current = canGenerate;
  const queuedRows = React.useMemo(() => new Set(
    queue.flatMap(({ csvRow }) => csvRow ? [csvRowKey(csvRow)] : []),
  ), [queue]);
  const canResume = queue.some((item) => item.status !== "ready" &&
    (item.status === "error" || item.batchId || item.batchPlan));
  const pendingBlanks = queue.filter(
    (item) =>
      (item.status === "queued" || item.status === "error") &&
      (item.csvWarning || item.job.allowEmptyText),
  ).length;
  const editingItem = queue.find((item) => item.id === editingId);
  const lastQueuePage = Math.max(
    0,
    Math.ceil(queue.length / QUEUE_PAGE_SIZE) - 1,
  );
  const visibleQueuePage = Math.min(queuePage, lastQueuePage);
  React.useEffect(() => {
    if (visible && loaded) return beginWorkTask("document", "", timingApi);
  }, [visible, Boolean(loaded), timingApi]);
  const reload = React.useCallback(async () => {
    const result = await api.list();
    if (alive.current) setData(result);
  }, [api]);
  React.useEffect(() => {
    alive.current = true;
    void reload().catch((e) => {
      if (alive.current) setError(e.message);
    });
    const reconnect = () => void reload().catch(() => undefined);
    window.addEventListener("online", reconnect);
    return () => {
      window.removeEventListener("online", reconnect);
      alive.current = false;
      revision.current++;
      wakeProcessing.current?.();
    };
  }, [reload]);
  const mold = data.layouts.find((t) => t.id === layoutId);
  const baseName = loaded && staffPdfSourceName(loaded.base);
  const compatibleMolds = data.layouts.filter(
    (item) =>
      (item.layout.base_id
        ? item.layout.base_id === loaded?.base.id
        : !item.layout.base_pdf_name ||
          item.layout.base_pdf_name.toLowerCase() ===
            baseName?.toLowerCase()) || item.id === layoutId,
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
    staffPdfInitialSize(mold?.layout),
    loaded?.base.revision,
  );
  const linesFrom = (mold: StaffPdfLayoutView, text = "") =>
    staffPdfLayoutLines(mold.layout, fonts, text);
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
    id: string = crypto.randomUUID(),
    code = barcode,
    allowEmptyText = false,
    size?: StaffBarcodeSize,
  ): QueueItem {
    const resolvedCode = code.trim() ? normalizeStaffBarcode(code) : undefined;
    const filename =
      staffPdfOutputName(name) ||
      staffPdfDefaultFilename(
        layout.name,
        textLines[0]?.text || "",
        resolvedCode,
      );
    const job = normalizeStaffPdfJob(
      {
        schemaVersion: 1,
        ...(allowEmptyText ? { allowEmptyText: true } : {}),
        ...(resolvedCode ? {
          barcode: resolvedCode,
          barcodeVersion: STAFF_BARCODE_VERSION,
          ...(size ? { barcodeSize: size } : {}),
        } : {}),
        baseId: source.base.id,
        baseRevision: source.base.revision,
        layoutId: layout.id,
        layoutRevision: layout.revision,
        lines: textLines.map((line) =>
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
      useBarcodeDefault: !size,
      status: "queued",
    };
  }
  async function importOrders(
    orders: StaffPdfCsvOrder[],
    replacing?: QueueItem,
  ) {
    if (running.current || !queueReady) throw new Error("Aguarde a operação atual.");
    running.current = true;
    setBusy(true);
    try {
      const library = await api.list();
      if (alive.current) setData(library);
      const sources = new Map<string, NonNullable<typeof loaded>>();
      if (
        replacing?.original &&
        library.bases.some(
          (base) =>
            base.id === replacing.base.id &&
            base.revision === replacing.base.revision,
        )
      )
        sources.set(replacing.base.id, { base: replacing.base, original: replacing.original });
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
        const textLines = replacing?.job.layoutId === layout.id &&
          replacing.job.layoutRevision === layout.revision
          ? [{ ...replacing.job.lines[0], text: order.text }, ...replacing.job.lines.slice(1)]
          : linesFrom(layout, order.text);
        items.push({
          ...queueItem(
            source,
            layout,
            textLines,
            "",
            replacing?.id || crypto.randomUUID(),
            order.barcode,
            !order.text,
            replacing ? barcodeOverrideOf(replacing) : undefined,
          ),
          csvRow: order.csvRow,
          csvWarning: order.csvWarning,
        });
      }
      if (alive.current) {
        await setQueue((old) => {
          const importedRows = new Set(old.flatMap(({ csvRow }) => csvRow ? [csvRowKey(csvRow)] : []));
          return (
          replacing
            ? old.map((item) => (item.id === replacing.id ? items[0] : item))
            : [...old, ...items.filter((item) =>
                !item.csvRow || !importedRows.has(csvRowKey(item.csvRow)),
              )]
          );
        });
        setMessage(
          replacing
            ? "Pedido da fila atualizado pela planilha."
            : `${items.length} pedido(s) importado(s). Revise antes de processar.`,
        );
        setError("");
      }
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function reviseCsvRow(
    row: StaffPdfCsvOrder["csvRow"],
    replacement?: StaffPdfCsvOrder,
    pastedName?: StaffPdfCsvNamePaste,
  ) {
    const key = csvRowKey(row);
    const existing = queue.find(
      (item) => item.csvRow && csvRowKey(item.csvRow) === key,
    );
    if (running.current) throw new Error("Aguarde a operação atual.");
    if (
      existing?.batchId ||
      existing?.status === "ready" ||
      lockedCsvRows.current.has(key)
    )
      throw new Error(
        "Esta linha já pertence a um lote em processamento ou concluído.",
      );
    if (!existing) return false;
    if (pastedName) {
      const textColumn =
        existing.csvRow?.textColumn ?? pastedName.mappedTextColumn;
      const [main, ...extras] = existing.job.lines;
      const text =
        textColumn === pastedName.column ? pastedName.text : main.text;
      const textWarnings = pastedName.textWarnings(textColumn);
      const csvRow = {
        ...row,
        ...(textColumn >= 0 ? { textColumn } : {}),
        ...(textColumn === pastedName.column ? { textIsName: true } : {}),
        textWarnings,
      };
      const csvWarning = textWarnings[text.trim() ? "filled" : "blank"];
      let job = existing.job;
      if (text !== main.text) {
        const name = data.layouts.find(
          (layout) => layout.id === job.layoutId,
        )?.name;
        const code = job.barcode;
        const outputName =
          name &&
          job.outputName === staffPdfDefaultFilename(name, main.text, code)
            ? staffPdfDefaultFilename(name, text, code)
            : job.outputName;
        job = {
          ...job,
          lines: [{ ...main, text }, ...extras],
          outputName,
          allowEmptyText: undefined,
        };
      }
      await setQueue((old) =>
        old.map((item) =>
          item.id === existing.id ? { ...item, job, csvRow, csvWarning } : item,
        ),
      );
      if (editingId === existing.id) setEditingId(null);
      return true;
    }
    if (replacement) await importOrders([replacement], existing);
    else await setQueue((old) => old.filter((item) => item.id !== existing.id));
    if (editingId === existing.id) setEditingId(null);
    return !!replacement;
  }
  function saveQueue() {
    const items = queue
      .filter((item) => item.status !== "ready")
      .map(({ requestId, job, batchId, batchPlan, csvWarning, csvRow, useBarcodeDefault }) => ({
        requestId,
        job,
        ...(batchId ? { batchId } : {}),
        ...(batchPlan ? { batchPlan } : {}),
        ...(useBarcodeDefault === undefined ? {} : { useBarcodeDefault }),
        ...(csvWarning ? { csvWarning } : {}),
        ...(csvRow ? { csvRow } : {}),
      }));
    downloadPersonalization(
      new Blob([JSON.stringify({ schemaVersion: 1, items }, null, 2)], {
        type: "application/json",
      }),
      "fila-pdfs.json",
    );
  }
  async function loadQueue(file: File) {
    if (running.current || !queueReady) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      if (file.size > 50 * 1024 * 1024)
        throw new Error("Envie um JSON de fila de até 50 MB.");
      const value = JSON.parse(await file.text());
      if (value?.schemaVersion !== 1 || !Array.isArray(value.items))
        throw new Error("Selecione um JSON de fila salvo na oficina.");
      await flushQueue();
      const seen = new Set(savedQueue.current.map((item) => item.requestId));
      const seenRows = new Set(
        savedQueue.current.flatMap((item) => (item.csvRow ? [csvRowKey(item.csvRow)] : [])),
      );
      const incoming = [];
      for (const item of value.items) {
        const id = item?.requestId;
        if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
          throw new Error("Identificador de pedido inválido no JSON.");
        if (seen.has(id)) continue;
        seen.add(id);
        const csvRow = item.csvRow;
        if (csvRow !== undefined) {
          if (
            typeof csvRow?.sourceId !== "string" ||
            !/^[a-f0-9-]{36}$/.test(csvRow.sourceId) ||
            !Number.isInteger(csvRow.index) ||
            csvRow.index < 0 ||
            csvRow.index > 10000 ||
            (csvRow.textColumn !== undefined &&
              (!Number.isSafeInteger(csvRow.textColumn) ||
                csvRow.textColumn < 0)) ||
            (csvRow.textIsName !== undefined && typeof csvRow.textIsName !== "boolean") ||
            (csvRow.textWarnings !== undefined &&
              (typeof csvRow.textWarnings?.blank !== "string" ||
                typeof csvRow.textWarnings?.filled !== "string" ||
                csvRow.textWarnings.blank.length > 800 ||
                csvRow.textWarnings.filled.length > 800))
          )
            throw new Error("Linha do CSV inválida no arquivo da fila.");
          const key = csvRowKey(csvRow);
          if (seenRows.has(key)) continue;
          seenRows.add(key);
        }
        if (
          item.batchId !== undefined &&
          (typeof item.batchId !== "string" ||
            !/^[a-f0-9]{32}$/.test(item.batchId))
        )
          throw new Error("Lote inválido no arquivo da fila.");
        const plan = item.batchPlan;
        if (plan !== undefined &&
          (typeof plan?.requestId !== "string" || !/^[a-f0-9-]{36}$/.test(plan.requestId) ||
            (plan.name !== undefined && (typeof plan.name !== "string" || plan.name.length > STAFF_PDF_BATCH_NAME_MAX)))) {
          throw new Error("Identificador de retomada inválido no arquivo da fila.");
        }
        incoming.push({
          ...(item.batchId ? { batchId: item.batchId } : {}),
          ...(plan ? { batchPlan: { requestId: plan.requestId, name: plan.name } } : {}),
          useBarcodeDefault: typeof item.useBarcodeDefault === "boolean" ? item.useBarcodeDefault : undefined,
          csvWarning:
            typeof item.csvWarning === "string"
              ? item.csvWarning.slice(0, 800)
              : undefined,
          csvRow,
          requestId: id,
          job: normalizeStaffPdfJob(item.job, fonts),
        });
      }
      const library = await api.list();
      if (alive.current) setData(library);
      const sources = new Map<string, NonNullable<typeof loaded>>();
      const items: QueueItem[] = [];
      for (const { requestId, job, batchId, batchPlan, csvWarning, csvRow, useBarcodeDefault } of incoming) {
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
          ...(batchId ? { batchId } : {}),
          ...(batchPlan ? { batchPlan } : {}),
          csvWarning,
          csvRow,
          job,
          base: source.base,
          original: source.original,
          fitMargin: layout.layout.fit_margin,
          useBarcodeDefault,
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
        await setQueue((old) => [...old, ...items]);
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
    setBarcode("");
    setBarcodeOverride(undefined);
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
        item?.original && b.revision === item.base.revision
          ? { base: b, original: item.original }
          : await readBase(b);
      const layout =
        previousLayout ||
        (autoTemplate
          ? matchPdfLayout(
              staffPdfSourceName(source.base),
              source.base.pageCount,
              data.layouts,
              source.base.id,
            )
          : undefined);
      if (alive.current && version === revision.current) {
        setLoaded(source);
        setBarcode(item?.job.barcode ?? "");
        if (item) setBarcodeOverride(barcodeOverrideOf(item));
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
              : linesFrom(layout)
            : item
              ? structuredClone(item.job.lines)
              : [],
        );
        if (item) {
          setEditingId(item.id);
          const automaticName = layout && staffPdfDefaultFilename(
            layout.name,
            item.job.lines[0]?.text || "",
            item.job.barcode,
          );
          setOutputName(
            item.job.outputName === automaticName
              ? ""
              : item.job.outputName || "",
          );
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
    if (running.current || !queueReady) return;
    const pending = queue.filter((item) => item.status === "queued" || item.status === "error");
    if (!pending.length) return;
    const pendingIds = new Set(pending.map((item) => item.id));
    running.current = true;
    stop.current = false;
    setStopRequested(false);
    setProcessing(true);
    setBusy(true);
    setError("");

    const batches = api.batches;
    const inFlight = new Set<Promise<void>>();
    const completedBatches = new Set<string>();
    const assets = createStaffPdfAssetCache();
    let successes = 0;
    let failures = 0;
    let disconnected = false;
    let waitingForQuota = false;
    let persistenceError: unknown;
    const canFinish = () => alive.current && generationAllowed.current && !disconnected && !persistenceError;
    const canStart = () => canFinish() && !stop.current;
    const report = (status: StaffPdfQueueProgressValue["status"]) => {
      if (!alive.current) return;
      const value = { status, total: pending.length, completed: successes, failed: failures };
      setProgress(value);
      onProgress?.(value);
    };
    const updateProgress = () => report(waitingForQuota ? "waiting" : "processing");

    async function markReady(item: QueueItem, reference: string) {
      if (!alive.current || !generationAllowed.current) return;
      await setQueue((old) => old.map((row) =>
        row.id === item.id ? { ...row, status: "ready", reference } : row,
      ));
      successes++;
      if (item.csvRow) lockedCsvRows.current.add(csvRowKey(item.csvRow));
      updateProgress();
    }

    async function markFailed(item: QueueItem, error: unknown) {
      if (!alive.current || !generationAllowed.current) return;
      const offline = wasDisconnected(error);
      disconnected ||= offline;
      if (offline) wakeProcessing.current?.();
      const message = error instanceof Error ? error.message : String(error);
      await setQueue((old) => old.map((row) => row.id === item.id
        ? { ...row, status: offline ? "queued" : "error", error: offline ? undefined : message }
        : row));
      if (!offline) failures++;
      updateProgress();
    }

    async function renderAndSave(item: QueueItem, batchId: string, recipe: StaffPdfRecipe) {
      if (recipe.item.status !== "ready") {
        if (!recipe.uploadExists) {
          const rendered = await renderStaffPdfRecipe(recipe, assets);
          if (!canFinish()) return;
          await retryStaffPdfRateLimit(() => batches!.upload(batchId, recipe.item.id, rendered), canFinish);
        }
        if (!canFinish()) return;
        await retryStaffPdfRateLimit(() => batches!.complete(batchId, recipe.item.id), canFinish);
      }
      completedBatches.add(batchId);
      await markReady(item, recipe.item.outputName);
    }

    report("processing");
    try {
      if (!navigator.onLine) throw new TypeError("Network offline");
      if (batches) {
        const unassigned = new Set(pending.filter((item) => !item.batchId && !item.batchPlan).map((item) => item.id));
        if (unassigned.size) {
          const batchPlan = { requestId: crypto.randomUUID(), name: batchName.trim() || undefined };
          await setQueue((old) => old.map((item) =>
            unassigned.has(item.id) ? { ...item, batchPlan } : item,
          ));
        }
      }
      const current = pending.every((item) => batches && item.batchId) ? data : await api.list();
      if (alive.current) setData(current);
      const batchIds = new Map<string, string>();
      const attemptLimit = batches ? BATCH_ATTEMPTS_PER_WINDOW : 20;
      for (const item of savedQueue.current.filter((row) => pendingIds.has(row.id))) {
        if (inFlight.size >= BATCH_RENDER_LIMIT) await Promise.race(inFlight);
        if (!canStart()) break;
        if (!navigator.onLine) {
          disconnected = true;
          break;
        }
        attempts.current = attempts.current.filter((time) => Date.now() - time < GENERATION_WINDOW_MS);
        if (attempts.current.length >= attemptLimit) {
          waitingForQuota = true;
          updateProgress();
          setMessage("Aguardando o limite de geração para continuar a fila.");
          await new Promise<void>((resolve) => {
            const timer = window.setTimeout(resolve, GENERATION_WINDOW_MS - (Date.now() - attempts.current[0]));
            wakeProcessing.current = () => {
              window.clearTimeout(timer);
              resolve();
            };
          });
          wakeProcessing.current = undefined;
          waitingForQuota = false;
          if (!canStart()) break;
          attempts.current = attempts.current.filter((time) => Date.now() - time < GENERATION_WINDOW_MS);
          setMessage("");
          updateProgress();
        }
        await setQueue((old) => old.map((row) => row.id === item.id
          ? { ...row, status: "processing", error: undefined } : row));
        if (!canStart()) break;
        try {
          const b = current.bases.find((base) => base.id === item.job.baseId);
          const t = current.layouts.find((layout) => layout.id === item.job.layoutId);
          if (!(batches && item.batchId) &&
              (!b || b.revision !== item.job.baseRevision || !t || t.revision !== item.job.layoutRevision)) {
            throw new Error("A base ou o molde mudou. Edite este item novamente.");
          }
          let effectiveJob = item.job;
          if (!item.batchId && isCsvName(item.csvRow)) {
            const [main, ...extras] = effectiveJob.lines;
            const text = formatStaffPdfPersonName(main.text);
            if (text !== main.text) {
              const { outputName, barcode } = effectiveJob;
              effectiveJob = {
                ...effectiveJob,
                lines: [{ ...main, text }, ...extras],
                outputName: t && outputName === staffPdfDefaultFilename(t.name, main.text, barcode)
                  ? staffPdfDefaultFilename(t.name, text, barcode)
                  : outputName,
              };
            }
          }
          if (!item.batchId && effectiveJob.barcode && effectiveJob.barcodeVersion === STAFF_BARCODE_VERSION) {
            effectiveJob = {
              ...effectiveJob,
              barcodeSize: barcodeOverrideOf(item) ?? current.barcodeDefault ?? STAFF_PDF_BARCODE_DEFAULT,
            };
          }
          if (batches) {
            const job = item.batchId ? effectiveJob : normalizeStaffPdfJob({
              ...effectiveJob,
              outputName: effectiveJob.outputName || staffPdfDefaultFilename(
                t?.name || item.base.name, effectiveJob.lines[0]?.text || "", effectiveJob.barcode,
              ),
            }, fonts);
            let batchId = item.batchId;
            if (!batchId) {
              const plan = item.batchPlan!;
              batchId = batchIds.get(plan.requestId);
              if (!batchId) {
                batchId = (await retryStaffPdfRateLimit(() => batches.create(plan.requestId, plan.name), canFinish)).id;
                batchIds.set(plan.requestId, batchId);
              }
              if (!alive.current || !generationAllowed.current) break;
              if (item.csvRow) lockedCsvRows.current.add(csvRowKey(item.csvRow));
              await setQueue((old) => old.map((row) => row.id === item.id ? { ...row, batchId, job } : row));
            }
            if (!canStart()) break;
            attempts.current.push(Date.now());
            // Firestore assigns the final PDF order when each recipe is registered.
            const recipe = await retryStaffPdfRateLimit(() => batches.save(batchId, job, item.requestId), canFinish);
            if (!canFinish()) break;
            const task = renderAndSave(item, batchId, recipe)
              .catch((error) => markFailed(item, error))
              .catch((error) => {
                persistenceError = error;
                wakeProcessing.current?.();
              });
            inFlight.add(task);
            void task.then(() => inFlight.delete(task));
          } else {
            const initial = await api.initial(effectiveJob.baseId, effectiveJob.lines[0]?.text || "");
            if (initial) initial.sizePercent = staffPdfInitialSize(t?.layout) ?? initial.sizePercent;
            const blob = await exportStaffPdf(
              item.original ?? await api.baseFile(item.job.baseId), effectiveJob, fonts, item.fitMargin, initial,
            );
            if (!canFinish()) break;
            attempts.current.push(Date.now());
            const doc = await api.generate(effectiveJob, blob, item.requestId);
            await markReady(item, doc.reference);
          }
        } catch (error) {
          await markFailed(item, error);
        }
      }
      await Promise.all(inFlight);
      if (persistenceError) throw persistenceError;
      if (alive.current && generationAllowed.current) {
        const interrupted = (item: QueueItem) => pendingIds.has(item.id) && item.status === "processing";
        await setQueue((old) => old.some(interrupted)
          ? old.map((item) => interrupted(item) ? { ...item, status: "queued" } : item) : old);
      }
      if (batches && completedBatches.size && canStart()) {
        setMessage("Preparando o ZIP para download.");
        for (const batchId of completedBatches) {
          await loadStaffPdfArchive(batches, batchId, { active: canStart })
            .catch(() => undefined); // The download can resume archive preparation.
        }
      }
      if (alive.current) {
        setBatchRevision((old) => old + 1);
        report(disconnected || stop.current || !generationAllowed.current ? "paused" : "completed");
        await onGenerated().catch(() => undefined);
        setMessage(
          disconnected
            ? `${successes} documento(s) concluído(s). A conexão foi interrompida. Use Continuar lote quando voltar.`
            : `${successes} documento(s) concluído(s). ${stop.current ? "A fila foi pausada. " : ""}Veja os arquivos em Lotes anteriores.`,
        );
      }
    } catch (error) {
      persistenceError = error;
      await Promise.all(inFlight);
      if (wasDisconnected(error)) {
        report("paused");
        if (alive.current) setMessage("Sem conexão. Volte à fila para continuar quando a internet retornar.");
      } else {
        report("error");
        if (alive.current) setError((error as Error).message);
      }
    } finally {
      running.current = false;
      if (alive.current) {
        setBusy(false);
        setProcessing(false);
      }
    }
  }
  async function add() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      if (!loaded || !mold) throw new Error("Escolha uma base e um molde.");
      const csvRow = editingItem?.csvRow;
      const nameField = isCsvName(csvRow);
      const textLines = nameField
        ? lines.map((line, index) => index === 0 ? { ...line, text: formatStaffPdfPersonName(line.text) } : line)
        : lines;
      const item = queueItem(
        loaded,
        mold,
        textLines,
        outputName,
        editingId ?? undefined,
        barcode,
        !!(editingItem?.csvRow || editingItem?.job.allowEmptyText) &&
          !lines.some((line) => line.text.trim()),
        barcodeOverride,
      );
      if (csvRow) {
        const text = item.job.lines[0].text;
        const blank = !text.trim();
        const legacyWarning = editingItem.csvWarning;
        const csvWarning = csvRow.textWarnings
          ? csvRow.textWarnings[blank ? "blank" : "filled"]
          : blank
            ? legacyWarning
            : legacyWarning
                ?.split(", ")
                .filter((label) => label.toLowerCase() !== "nome")
                .join(", ");
        Object.assign(item, { csvRow: nameField ? { ...csvRow, textIsName: true } : csvRow, csvWarning });
      }
      await setQueue((old) =>
        editingId
          ? old.map((q) => (q.id === editingId ? item : q))
          : [...old, item],
      );
      if (item.csvRow && editingItem && item.job.lines[0].text !== editingItem.job.lines[0].text) {
        csvImport.current?.updateText(item.csvRow, item.job.lines[0].text);
      }
      loadLines(linesFrom(mold));
      setOutputName("");
      setBarcode("");
      setBarcodeOverride(undefined);
      setEditingId(null);
      setMessage(
        editingId
          ? "Pedido atualizado na fila."
          : "Arquivo adicionado à fila para revisão.",
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
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
    if (layout && id !== layoutId) {
      const oldExtraIds = new Set(mold?.layout.extra_lines?.map((line) => line.id));
      const next = linesFrom(layout, lines[0]?.text || "");
      const manual = lines.slice(1).filter((line) => !oldExtraIds.has(line.id) &&
        !next.some((definition) => definition.id === line.id));
      loadLines([
        ...next,
        ...manual.slice(0, STAFF_PDF_MAX_LINES - next.length),
      ]);
    }
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
  function openBarcodeEditor(target: BarcodeEditorTarget) {
    const item = typeof target === "object" ? target : undefined;
    const override = item ? barcodeOverrideOf(item) : target === "draft" ? barcodeOverride : undefined;
    setBarcodeDraft(item ? item.job.barcode ?? "" : barcode);
    setBarcodeSizeDraft(override ?? barcodeDefault);
    setBarcodeInherits(!override);
    setError("");
    setBarcodeEditor(target);
  }
  async function applyBarcode(resetDefault = false) {
    if (!barcodeEditor || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      if (barcodeEditor === "default") {
        const size = normalizeStaffBarcodeSize(resetDefault ? STAFF_PDF_BARCODE_DEFAULT : barcodeSizeDraft);
        const barcodeDefault = await api.saveBarcodeDefault(size);
        setData((current) => ({ ...current, barcodeDefault }));
        setMessage("Padrão de código de barras atualizado.");
      } else {
        const code = barcodeDraft.trim() ? normalizeStaffBarcode(barcodeDraft) : undefined;
        const override = code && !barcodeInherits ? normalizeStaffBarcodeSize(barcodeSizeDraft) : undefined;
        const item = typeof barcodeEditor === "object" ? barcodeEditor : undefined;
        const base = item?.base ?? loaded?.base;
        if (code) {
          for (const [index, page] of (base?.pages ?? []).entries()) {
            if (index === 0 || (base?.pageCount === 4 && index === 2))
              staffBarcodeBoxes(page.width, page.height, code, STAFF_BARCODE_VERSION, override ?? barcodeDefault);
          }
        }
        if (item) {
          const name = data.layouts.find(({ id }) => id === item.job.layoutId)?.name ?? item.base.name;
          const text = item.job.lines[0]?.text || "";
          const automaticName = staffPdfDefaultFilename(name, text, item.job.barcode);
          await setQueue((queue) => queue.map((row) =>
            row.id === item.id ? {
              ...row,
              useBarcodeDefault: !override,
              job: {
                ...row.job,
                barcode: code,
                barcodeVersion: code ? STAFF_BARCODE_VERSION : undefined,
                barcodeSize: override,
                outputName: !row.job.outputName || row.job.outputName === automaticName
                  ? staffPdfDefaultFilename(name, text, code) : row.job.outputName,
              },
            } : row,
          ));
        }
        if (!item || item.id === editingId) {
          setBarcode(code ?? "");
          setBarcodeOverride(override);
        }
      }
      setError("");
      setBarcodeEditor(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
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
            onClick={() => setTab("csv")}
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
      {(error || queueError || batchDraft.error) && (
        <p role="alert" className="text-red-300">
          {queueError || batchDraft.error || error}
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
      {progress && <StaffPdfQueueProgress value={progress} />}
      {visible && tab === "library" && canManage && (
        <StaffPdfLibraryEditor
          data={data}
          api={api}
          fonts={fonts}
          reload={reload}
        />
      )}
      {canGenerate && (
        <div hidden={tab !== "csv"}>
          <StaffPdfCsvImport
            ref={csvImport}
            data={data}
            fonts={fonts}
            busy={busy || !queueReady}
            visible={visible && tab === "csv"}
            fallback={{ baseId: loaded?.base.id || "", layoutId }}
            onAdd={importOrders}
            onReviewQueue={() => setTab("edit")}
            onReviseRow={reviseCsvRow}
            reviewRequest={csvReview}
            storageOwner={storageOwner}
            queuedRows={queuedRows}
          />
        </div>
      )}
      {visible && tab === "edit" && canGenerate && (
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
                          {base.category ||
                            (base.source === "internal"
                              ? "Sem categoria"
                              : "Produtos")}
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
                disabled={busy || !loaded}
                className="rounded-lg border border-gray-700 px-3 py-2 text-sm"
                onClick={() => openBarcodeEditor("draft")}
              >
                Editar código de barras
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded-lg border border-gray-700 px-3 py-2 text-sm"
                onClick={() => openBarcodeEditor("default")}
              >
                Editar código de barras padrão
              </button>
              {barcode && (
                <p className="break-all text-xs text-gray-400">{barcode}</p>
              )}
              <button
                type="button"
                disabled={busy}
                className="rounded-lg border border-gray-700 px-3 py-2 text-sm"
                onClick={() => setTab("csv")}
              >
                Importar CSV ou XLSX
              </button>
              <section className="space-y-3 border-t border-gray-800 pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h4 className="text-lg font-bold">
                    Fila principal · {queue.length}
                  </h4>
                  {queue.length > 0 && (
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-xs text-red-300 hover:bg-red-950 disabled:opacity-40"
                      disabled={busy}
                      onClick={() => setClearQueue(true)}
                    >
                      Excluir fila atual
                    </button>
                  )}
                  {queue.some((q) => q.status === "ready") && (
                    <button
                      type="button"
                      className="text-xs text-gray-300"
                      disabled={busy}
                      onClick={() =>
                        void setQueue((old) =>
                          old.filter((q) => q.status !== "ready"),
                        ).catch(() => undefined)
                      }
                    >
                      Limpar concluídos
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400">
                  {storageOwner
                    ? "A fila é salva neste navegador. Revise antes de processar."
                    : "Revise os arquivos antes de processar a fila."}
                </p>
                {!queueReady && !queueError && (
                  <p role="status" className="text-sm text-gray-400">Recuperando fila salva…</p>
                )}
                {queueReady && !queue.length && (
                  <p className="text-sm text-gray-400">
                    Nenhum arquivo na fila.
                  </p>
                )}
                {lastQueuePage > 0 && (
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <button
                      type="button"
                      disabled={visibleQueuePage === 0}
                      onClick={() => setQueuePage(visibleQueuePage - 1)}
                    >
                      Página anterior da fila
                    </button>
                    <span>
                      Página {visibleQueuePage + 1} de {lastQueuePage + 1}
                    </span>
                    <button
                      type="button"
                      disabled={visibleQueuePage === lastQueuePage}
                      onClick={() => setQueuePage(visibleQueuePage + 1)}
                    >
                      Próxima página da fila
                    </button>
                  </div>
                )}
                {queue
                  .slice(
                    visibleQueuePage * QUEUE_PAGE_SIZE,
                    (visibleQueuePage + 1) * QUEUE_PAGE_SIZE,
                  )
                  .map((item) => (
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
                        {item.job.lines.map((line) => line.text).filter(Boolean).join(" / ")}
                      </p>
                      {(item.csvWarning || item.job.allowEmptyText) && (
                        <p className="break-words text-xs text-amber-300">
                          Campos em branco no CSV: {item.csvWarning || "Nome"}.
                        </p>
                      )}
                      {item.error && (
                        <p role="alert" className="text-sm text-red-300">
                          {item.error}
                        </p>
                      )}
                      {item.reference && (
                        <p className="text-sm text-green-300">
                          {item.reference}
                        </p>
                      )}
                      <div className="flex gap-1">
                        <button
                          type="button"
                          aria-label="Editar código de barras"
                          title="Editar código de barras"
                          disabled={busy || Boolean(item.batchId) || item.status === "ready"}
                          onClick={() => openBarcodeEditor(item)}
                          className="rounded-md p-2 text-gray-500 hover:text-[#ff4d79] disabled:opacity-40"
                        >
                          <Barcode size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label="Editar item da fila"
                          title="Editar item da fila"
                          disabled={busy || item.status === "ready"}
                          onClick={() => void choose(item.job.baseId, item)}
                          className="rounded-md p-2 text-gray-500 hover:text-[#ff4d79] disabled:opacity-40"
                        >
                          <Edit2 size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label="Excluir da fila"
                          title="Excluir da fila"
                          disabled={busy}
                          onClick={() => setRemoveId(item.id)}
                          className="rounded-md p-2 text-gray-500 hover:text-red-500 disabled:opacity-40"
                        >
                          <Trash2 size={16} aria-hidden="true" />
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
              {loaded && mold && (lines.length > 1 || mainFormatting) && (
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
                  barcode={barcode || undefined}
                  barcodeSize={barcodeSize}
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
                busy || !queueReady ||
                !mold ||
                (!editingItem?.csvRow &&
                  !editingItem?.job.allowEmptyText &&
                  !lines.some((line) => line.text.trim()))
              }
              className="rounded-xl bg-pink-600 px-4 py-2 font-bold disabled:opacity-40"
              onClick={() => void add()}
            >
              {editingId ? "Atualizar item da fila" : "Adicionar à fila"}
            </button>
            {editingId && (
              <button
                type="button"
                disabled={busy || !batchDraft.ready}
                className="rounded-xl border border-gray-700 px-4 py-2"
                onClick={() => {
                  setEditingId(null);
                  setOutputName("");
                  loadLines(mold ? linesFrom(mold) : []);
                }}
              >
                Cancelar revisão
              </button>
            )}
            {api.batches && (
              <input
                type="text"
                aria-label="Nome do lote (opcional)"
                placeholder="Nome do lote (opcional)"
                className="h-[42px] w-full min-w-0 rounded-lg border border-gray-700 bg-black px-3 text-sm placeholder:text-gray-400 disabled:opacity-40 sm:w-52"
                value={batchName}
                disabled={busy}
                maxLength={STAFF_PDF_BATCH_NAME_MAX}
                onChange={(event) => {
                  const name = event.target.value;
                  void batchDraft.save(() => name);
                }}
              />
            )}
            <button
              type="button"
              disabled={
                busy || !queueReady ||
                !queue.some(
                  (item) => item.status === "queued" || item.status === "error",
                )
              }
              className="rounded-xl bg-purple-600 px-4 py-2 font-bold disabled:opacity-40"
              onClick={() => {
                if (pendingBlanks) setConfirmBlanks(true);
                else void process();
              }}
            >
              {canResume ? "Continuar lote" : "Processar fila"}
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
      {visible && api.batches && canGenerate && (
        <StaffPdfBatches
          api={api.batches}
          revision={batchRevision}
        />
      )}
      {visible && barcodeEditor && (
        <EditorModal
          title={barcodeEditor === "default" ? "Editar código de barras padrão" : "Código de barras do pedido"}
          onClose={() => setBarcodeEditor(undefined)}
          closeLabel="Fechar código de barras"
          doneLabel="Voltar"
          footerText=""
          busy={busy}
        >
          {barcodeEditor !== "default" && (
          <label className="block text-sm">
            Código de barras
            <input
              className={input}
              maxLength={80}
              disabled={busy}
              placeholder="Opcional"
              value={barcodeDraft}
              onChange={(e) => setBarcodeDraft(e.target.value)}
            />
          </label>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {(
              [
                ["widthMm", "Largura de referência (mm)"],
                ["heightMm", "Altura (mm)"],
                ["horizontalScale", "Escala horizontal"],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="block text-sm">
                {label}
                <input
                  type="number"
                  step="any"
                  disabled={busy}
                  className={input}
                  value={
                    Number.isFinite(barcodeSizeDraft[field])
                      ? barcodeSizeDraft[field]
                      : ""
                  }
                  onChange={(e) => {
                    setBarcodeInherits(false);
                    setBarcodeSizeDraft({
                      ...barcodeSizeDraft,
                      [field]: e.currentTarget.valueAsNumber,
                    });
                  }}
                />
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            {barcodeEditor === "default"
              ? "O padrão vale para pedidos ainda não enviados para geração, incluindo os próximos lotes."
              : barcodeInherits ? "Este pedido usa as dimensões do padrão." : "As dimensões personalizadas valem para este pedido."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy} className="rounded-lg bg-pink-600 px-4 py-2"
              onClick={() => void applyBarcode()}>
              {barcodeEditor === "default" ? "Salvar padrão" : "Aplicar código"}
            </button>
            <button type="button" disabled={busy} className="rounded-lg border border-gray-700 px-4 py-2"
              onClick={() => {
                if (barcodeEditor === "default") void applyBarcode(true);
                else {
                  setBarcodeSizeDraft(barcodeDefault);
                  setBarcodeInherits(true);
                }
              }}>
              {barcodeEditor === "default" ? "Restaurar valores originais" : "Usar dimensões do padrão"}
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-red-300">
              {error}
            </p>
          )}
        </EditorModal>
      )}
      {visible && picker && (
        <StaffPdfPicker
          title={picker === "base" ? "Buscar base PDF" : "Buscar molde PDF"}
          options={
            picker === "base"
              ? data.bases.map((base) => ({
                  id: base.id,
                  name: `${base.name} · ${base.category || (base.source === "internal" ? "Sem categoria" : "Produtos")}`,
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
      {visible && removeId && (
        <ConfirmDialog
          title="Excluir item da fila?"
          message="O item sairá apenas da fila. A base PDF e os documentos já gerados serão preservados."
          confirmLabel="Excluir da fila"
          onCancel={() => setRemoveId(null)}
          onConfirm={() => {
            void setQueue((old) => old.filter((q) => q.id !== removeId)).then(() => {
              if (editingId === removeId) setEditingId(null);
              setRemoveId(null);
            }).catch(() => setRemoveId(null));
          }}
        />
      )}
      {visible && clearQueue && (
        <ConfirmDialog
          title={`Excluir ${queue.length} ${queue.length === 1 ? "item" : "itens"} da fila atual?`}
          message="Os itens serão removidos da fila. Os PDFs já gerados ficam disponíveis no histórico."
          confirmLabel="Excluir fila"
          danger
          busy={busy}
          onCancel={() => setClearQueue(false)}
          onConfirm={() => {
            setBusy(true);
            void setQueue(() => []).then(() => {
              setEditingId(null);
              setOutputName("");
              loadLines(mold ? linesFrom(mold) : []);
              setBarcode("");
              setBarcodeOverride(undefined);
              setProgress(undefined);
              onProgress?.(undefined);
              setQueuePage(0);
              setMessage("Fila atual excluída.");
              setClearQueue(false);
            }).catch(() => setClearQueue(false)).finally(() => setBusy(false));
          }}
        />
      )}
      {visible && confirmBlanks && (
        <ConfirmDialog
          title="Gerar lote com campos em branco?"
          message={`${pendingBlanks} pedido(s) têm campos em branco no CSV. Confira os avisos da fila ou volte à planilha para corrigir as linhas antes de gerar.`}
          confirmLabel="Gerar mesmo assim"
          onCancel={() => {
            setConfirmBlanks(false);
            setTab("csv");
            setCsvReview((value) => value + 1);
          }}
          onConfirm={() => {
            setConfirmBlanks(false);
            void process();
          }}
        />
      )}
    </section>
  );
}
