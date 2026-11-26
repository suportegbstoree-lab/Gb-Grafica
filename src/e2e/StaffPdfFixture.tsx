import type { StaffPdfCompoundMarker } from "../lib/staffPdfCompound";
import React from "react";
import { PDFDocument, rgb } from "pdf-lib";
import StaffLabelCategories from "../components/StaffLabelCategories";
import StaffPdfWorkspace from "../components/StaffPdfWorkspace";
import {
  type StaffPdfBatchView,
  type StaffPdfRecipe,
} from "../lib/staffPdfBatch";
import { labelCategoryClient, type StaffPdfApi } from "../services/staffPdfService";
import type { StaffBarcodeSize } from "../lib/staffPdfBarcode";
import {
  DEFAULT_DECORATIVE_INITIAL_PERCENT,
  findAlphabetLetter,
  readAlphabetFiles,
} from "../lib/decorativeInitial";
import {
  defaultPdfLayout,
  normalizePdfLayout,
  parsePdfLayoutMap,
  staffPdfSourceName,
  staffPdfOutputName,
  type StaffPdfBase,
  type StaffPdfLayoutView,
} from "../lib/staffPdf";
import type { StaffDocumentView } from "../services/staffDocumentService";
import { downloadPersonalization } from "../services/personalizationExport";
import type { WorkApi } from "../services/workService";
const timing: WorkApi = {
  get: async () => ({}),
  post: async () => ({ taskId: "f".repeat(32) }),
  csv: async () => new Blob(),
};
export function useStaffPdfFixture(batchesEnabled: boolean, smallPdf = false, resume = false) {
  const [documents, setDocuments] = React.useState<
    Array<{ doc: StaffDocumentView; blob: Blob }>
  >([]);
  const api = React.useMemo(() => {
    let bases: StaffPdfBase[] = [
        {
          id: "a".repeat(32),
          name: "Kit de teste.pdf",
          pageCount: smallPdf ? 1 : 4,
          pages: smallPdf
            ? [{ width: 240, height: 240 }]
            : Array.from({ length: 4 }, () => ({ width: 595, height: 842 })),
          revision: "a".repeat(32),
          source: "internal",
        },
      ],
      layouts: StaffPdfLayoutView[] = [
        {
          id: "b".repeat(32),
          name: "Kit de teste",
          revision: "b".repeat(32),
          layout: {
            ...defaultPdfLayout(),
            font_name: "Arial",
            pos_x: 200,
            pos_y: 800,
            max_width_pixels: 2000,
            max_height_pixels: 300,
            pos_x_landscape: 1000,
            pos_y_landscape: 600,
            max_width_pixels_landscape: 2000,
            max_height_pixels_landscape: 300,
            ...(smallPdf
              ? {
                  pos_x: 80,
                  pos_y: 380,
                  max_width_pixels: 840,
                  max_height_pixels: 220,
                }
              : {}),
          },
        },
      ];
    const files = new Map<string, Blob>(),
      alphabets = new Map<string, Record<string, File>>(),
      saved = new Map<string, StaffDocumentView>();
    const baseUploadRequests = new Map<string, string>();
    let loseBaseResponse = new URLSearchParams(location.search).has("base-upload-retry");
    let compoundMarker: StaffPdfCompoundMarker | undefined;
    let barcodeDefault: StaffBarcodeSize | undefined;
    const store = new URLSearchParams(location.search).get("label-store") || "fixture";
    const value: StaffPdfApi = {
      labelCategories: labelCategoryClient(async (path, body) => {
        const response = await fetch("/__e2e/label-api/" + encodeURIComponent(store) + path.replace("/label-categories", ""), {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        if (!response.ok) throw Object.assign(new Error("Falha ao consultar a categoria."), {status:response.status});
        return response.json();
      }),
      list: async () => ({
        bases: structuredClone(bases),
        layouts: structuredClone(layouts),
        truncated: false,
        barcodeDefault,
        compoundMarker,
      }),
      saveCompoundMarker: async (value) => { compoundMarker = value; },
      saveBarcodeDefault: async (size) => {
        barcodeDefault = { ...size };
        return barcodeDefault;
      },
      prepareProductCopy: async () => {
        throw new Error("Use o editor de produtos para vincular.");
      },
      baseFile: async (id) => {
        if (files.has(id)) return files.get(id)!;
        const d = await PDFDocument.create();
        if (smallPdf) d.addPage([240, 240]);
        for (let i = 0; !smallPdf && i < 4; i++) {
          const p = d.addPage([595, 842]);
          p.drawRectangle({
            x: 0,
            y: 0,
            width: 595,
            height: 842,
            color: i % 2 ? rgb(0.96, 0.93, 0.85) : rgb(0.86, 0.94, 0.94),
          });
          p.drawRectangle({
            x: 80,
            y: 400,
            width: 435,
            height: 240,
            color: i === 2 ? rgb(0.95, 0.75, 0.6) : rgb(0.75, 0.85, 0.94),
          });
        }
        const blob = new Blob([new Uint8Array(await d.save())], {
          type: "application/pdf",
        });
        files.set(id, blob);
        return blob;
      },
      initial: async (id, text) => {
        const alphabet = alphabets.get(id);
        const letter = findAlphabetLetter(alphabet, text);
        const source = letter ? alphabet?.[letter] : undefined;
        const sizePercent = bases.find((base) => base.id === id)?.initialSizePercent;
        return source ? { source, sizePercent: sizePercent ?? DEFAULT_DECORATIVE_INITIAL_PERCENT } : undefined;
      },
      uploadAlphabet: async (target, files, progress, mold) => {
        const { id } = target;
        const { folderName, letters } = readAlphabetFiles(
          files,
          mold ? [mold.name, staffPdfSourceName(target), ...(mold.previousNames ?? [])] : staffPdfSourceName(target),
        );
        progress?.(0, letters.length);
        alphabets.set(
          id,
          Object.fromEntries(letters.map(({ letter, file }) => [letter, file])),
        );
        bases = bases.map((base) =>
          base.id === id
            ? {
                ...base,
                initialFolderName: folderName,
                initialSizePercent: base.initialSizePercent ?? DEFAULT_DECORATIVE_INITIAL_PERCENT,
                initialLetters: letters.map(({ letter }) => letter),
              }
            : base,
        );
        progress?.(letters.length, letters.length);
      },
      uploadBase: async (file, requestId, replacement, category) => {
        const existing = baseUploadRequests.get(requestId);
        if (existing) return existing;
        const d = await PDFDocument.load(await file.arrayBuffer()),
          id = replacement?.id || crypto.randomUUID().replaceAll("-", "");
        files.set(id, file);
        if (replacement)
          bases = bases.filter((base) => base.id !== replacement.id);
        bases.push({
          id,
          name: replacement?.name || file.name,
          sourceName: replacement?.sourceName,
          category,
          pageCount: d.getPageCount(),
          pages: [],
          revision: crypto.randomUUID().replaceAll("-", ""),
          source: "internal",
        });
        baseUploadRequests.set(requestId, id);
        if (loseBaseResponse) {
          loseBaseResponse = false;
          throw new Error("A conexão caiu após salvar a base. Tente novamente.");
        }
        return id;
      },
      renameBase: async (target, name) => {
        const sourceName = staffPdfSourceName(target);
        const filename = /\.pdf$/i.test(name) ? name : `${name}.pdf`;
        bases = bases.map((base) => base.id === target.id ? { ...base, name: filename, sourceName } : base);
      },
      deleteBase: async (id) => {
        bases = bases.filter((b) => b.id !== id);
      },
      saveLayout: async (name, layout, revision, id) => {
        const old = layouts.find((t) => id ? t.id === id : t.name === name);
        if (layouts.some(t => t.name === name && t.id !== old?.id)) throw new Error("Já existe um molde com este nome.");
        if (old && old.revision !== revision) throw new Error("Molde mudou.");
        layouts = layouts.filter((t) => t.id !== old?.id);
        layouts.push({
          id: old?.id || crypto.randomUUID().replaceAll("-", ""),
          name,
          ...(old?.name !== name && old?.name ? { previousNames: [...(old.previousNames ?? []), old.name] } : {}),
          layout: normalizePdfLayout(layout),
          revision: crypto.randomUUID().replaceAll("-", ""),
        });
      },
      deleteLayout: async (id) => {
        layouts = layouts.filter((t) => t.id !== id);
      },
      importLayouts: async (raw) => {
        let created = 0,
          skipped = 0;
        for (const t of parsePdfLayoutMap(raw)) {
          if (layouts.some((l) => l.name === t.name)) {
            skipped++;
            continue;
          }
          created++;
          layouts.push({
            ...t,
            id: crypto.randomUUID().replaceAll("-", ""),
            revision: crypto.randomUUID().replaceAll("-", ""),
          });
        }
        return { created, skipped };
      },
      generate: async (job, blob, requestId) => {
        if (saved.has(requestId)) return saved.get(requestId)!;
        const doc: StaffDocumentView = {
          id: crypto.randomUUID().replaceAll("-", ""),
          ownerId: "test",
          ownerName: "Pessoa de teste",
          templateName: bases.find((b) => b.id === job.baseId)!.name,
          outputName: job.outputName,
          productId: "",
          templateId: job.baseId,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          status: "ready",
          size: blob.size,
          reference: `PDF-TEST-${saved.size + 1}`,
          sha256: null,
        };
        saved.set(requestId, doc);
        setDocuments((old) => [...old, { doc, blob }]);
        return doc;
      },
    };
    if (batchesEnabled) {
      const fixtureStorageKey = "staff-pdf-batches-resume-fixture";
      type Batch = { view: StaffPdfBatchView; records: Map<string, StaffPdfRecipe> };
      const batches = new Map<
        string,
        Batch
      >();
      const saved = resume ? JSON.parse(sessionStorage.getItem(fixtureStorageKey) || "[]") : [];
      for (const { view, records } of saved) {
        batches.set(view.id, { view, records: new Map(records) });
      }
      const outputFiles = new Map<string, Blob>();
      const preparedArchives = new Map<string, { count: number; url: string }>();
      function savedPdf(itemId: string) {
        if (outputFiles.has(itemId)) return outputFiles.get(itemId);
        const encoded = resume && sessionStorage.getItem(`staff-pdf-resume-file:${itemId}`);
        if (!encoded) return undefined;
        const bytes = Uint8Array.from(atob(encoded.split(",")[1]), (char) => char.charCodeAt(0));
        const blob = new Blob([bytes], { type: "application/pdf" });
        outputFiles.set(itemId, blob);
        return blob;
      }
      function persistBatches() {
        if (resume) sessionStorage.setItem(fixtureStorageKey, JSON.stringify(
          [...batches.values()].map(({ view, records }) => ({
            view,
            records: [...records].map(([id, recipe]) => [id, { ...recipe, originalUrl: "" }]),
          })),
        ));
      }
      async function recipeWithAsset(recipe: StaffPdfRecipe) {
        if (recipe.originalUrl || "kind" in recipe.job) return recipe;
        return { ...recipe, originalUrl: URL.createObjectURL(await value.baseFile(recipe.job.baseId)) };
      }
      value.batches = {
        list: async () => ({
          batches: [...batches.values()].map(({ view, records }) => ({
            ...view,
            count: records.size,
          })),
        }),
        rename: async (id, name) => {
          const batch = batches.get(id)!;
          batch.view = { ...batch.view, name, count: batch.records.size };
          persistBatches();
          return batch.view;
        },
        create: async (requestId, name, marketplace) => {
          const id = requestId.replaceAll("-", "");
          const existing = batches.get(id);
          if (existing) return existing.view;
          const view = {
            id,
            reference: batches.size
              ? `LOTE-TESTE-${batches.size + 1}`
              : "LOTE-TESTE",
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
            ownerName: "Equipe de teste",
            name,
            marketplace,
            count: 0,
          };
          batches.set(id, { view, records: new Map() });
          persistBatches();
          if (resume && batches.size === 1) throw new TypeError("Failed to fetch");
          return view;
        },
        items: async (batchId) => ({
          items: [...batches.get(batchId)!.records.values()].map(
            (recipe) => recipe.item,
          ),
        }),
        save: async (batchId, job, requestId) => {
          if ("kind" in job)
            throw new Error("Este cenário usa o editor da oficina.");
          const { records } = batches.get(batchId)!;
          if (!records.has(requestId))
            records.set(requestId, {
              rendererVersion: 1,
              job,
              fitMargin: 0.2,
              originalKey: `${job.baseId}:${job.baseRevision}`,
              originalUrl: URL.createObjectURL(
                await value.baseFile(job.baseId),
              ),
              fonts: [
                {
                  id: "arial",
                  nome: "Arial",
                  cssFamily: "Arial, sans-serif",
                  ativo: true,
                },
              ],
              item: {
                id: crypto.randomUUID().replaceAll("-", ""),
                outputName: job.outputName!,
                barcode: job.barcode,
                status: "pending",
              },
            });
          persistBatches();
          return recipeWithAsset(records.get(requestId)!);
        },
        recipe: async (batchId, itemId) => {
          const key = "staff-pdf-fixture-recipe-downloads";
          sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) ?? 0) + 1));
          const { records } = batches.get(batchId)!;
          const record = [...records.values()].find(
            (recipe) => recipe.item.id === itemId,
          );
          if (!record) throw new Error("Item não encontrado.");
          return recipeWithAsset(record);
        },
        upload: async (_batchId, itemId, blob) => {
          if (resume && !savedPdf(itemId)) {
            const encoded = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });
            sessionStorage.setItem(`staff-pdf-resume-file:${itemId}`, encoded);
          }
          if (!outputFiles.has(itemId)) outputFiles.set(itemId, blob);
        },
        complete: async (batchId, itemId) => {
          const { records } = batches.get(batchId)!;
          const record = [...records.values()].find(
            (recipe) => recipe.item.id === itemId,
          )!;
          if (!savedPdf(itemId)) throw new Error("O PDF do lote ainda não foi salvo.");
          if (record.item.status === "ready") return;
          record.item.status = "ready";
          record.item.hasFile = true;
          persistBatches();
          if (resume) {
            const key = "staff-pdf-resume-completions";
            const completed = JSON.parse(sessionStorage.getItem(key) || "[]");
            sessionStorage.setItem(key, JSON.stringify([...completed, itemId]));
            if (completed.length === 1) throw new TypeError("Failed to fetch");
          }
        },
        file: async (batchId, itemId) => {
          const record = [...batches.get(batchId)!.records.values()].find(({ item }) => item.id === itemId);
          const blob = savedPdf(itemId);
          return record && blob ? { url: URL.createObjectURL(blob), name: `${record.item.outputName}.pdf` } : null;
        },
        archive: async (batchId, _progress, format = "zip") => {
          const { view, records } = batches.get(batchId)!;
          const ready = [...records.values()].filter(({ item }) => item.status === "ready");
          if (!ready.length) return { empty: true };
          const legacy = ready.filter(({ item }) => !savedPdf(item.id)).map(({ item }) => item.id);
          if (legacy.length) return { legacy };
          const name = `${staffPdfOutputName(view.name || "") || view.reference}.${format}`;
          const cacheKey = `${batchId}:${format}`;
          const prepared = preparedArchives.get(cacheKey);
          if (prepared?.count === ready.length) return { name, url: prepared.url };
          const files: Record<string, Uint8Array> = { "Lote completo.pdf": new Uint8Array() };
          const combined = await PDFDocument.create();
          for (const { item } of ready) {
            let filename = `${item.outputName}.pdf`;
            let copy = 2;
            while (Object.hasOwn(files, filename)) filename = `${item.outputName} (${copy++}).pdf`;
            const bytes = new Uint8Array(await savedPdf(item.id)!.arrayBuffer());
            files[filename] = bytes;
            const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
            for (const page of await combined.copyPages(pdf, pdf.getPageIndices())) combined.addPage(page);
          }
          files["Lote completo.pdf"] = await combined.save();
          if (format === "pdf") {
            const url = URL.createObjectURL(new Blob([new Uint8Array(files["Lote completo.pdf"])], { type: "application/pdf" }));
            preparedArchives.set(cacheKey, { count: ready.length, url });
            return { name, url };
          }
          const { zipSync } = await import("fflate");
          const url = URL.createObjectURL(new Blob([new Uint8Array(zipSync(files, { level: 0 }))], { type: "application/zip" }));
          preparedArchives.set(cacheKey, { count: ready.length, url });
          return { name, url };
        },
      };
    }
    return value;
  }, [batchesEnabled, smallPdf, resume]);
  return { api, documents };
}

export default function StaffPdfFixture() {
  const params = new URLSearchParams(location.search);
  const { api, documents } = useStaffPdfFixture(params.has("batches"), false, params.has("resume"));
  return (
    <main className="admin-controls min-h-screen bg-[#111] p-3 text-white sm:p-8">
      <div className="mx-auto max-w-6xl">
        <StaffPdfWorkspace
          fonts={[
            {
              id: "arial",
              nome: "Arial",
              cssFamily: "Arial, sans-serif",
              ativo: true,
            },
            { id: "serif", nome: "Serif", cssFamily: "serif", ativo: true },
          ]}
          canManage={params.get("permission") !== "generate"}
          canGenerate={params.get("permission") !== "templates"}
          api={api}
          timingApi={timing}
          onGenerated={async () => {}}
          storageOwner={params.has("resume") ? params.get("owner") || "fixture-owner" : undefined}
        />
        <section className="mt-5 space-y-3">
          <h2>Documentos salvos · teste</h2>
          {documents.map(({ doc, blob }) => (
            <button
              key={doc.id}
              className="mr-3 rounded-lg bg-green-800 p-3"
              onClick={() =>
                downloadPersonalization(
                  blob,
                  `${doc.outputName || doc.reference}.pdf`,
                )
              }
            >
              Baixar {doc.reference}
            </button>
          ))}
        </section>
      </div>
    </main>
  );
}

export function StaffLabelFixture() {
  const params = new URLSearchParams(location.search);
  const { api } = useStaffPdfFixture(false, false, true);
  return (
    <main className="admin-controls min-h-screen bg-[#111] p-5 text-white">
      <h2 className="mb-5 text-2xl font-bold">Etiquetas importadas</h2>
      <StaffLabelCategories api={api.labelCategories!} owner={params.get("owner") || "fixture-owner"} />
    </main>
  );
}
