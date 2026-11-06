import React from "react";
import { PDFDocument, rgb } from "pdf-lib";
import StaffPdfWorkspace from "../components/StaffPdfWorkspace";
import type { StaffPdfApi } from "../services/staffPdfService";
import {
  defaultPdfLayout,
  normalizePdfLayout,
  parsePdfLayoutMap,
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
export default function StaffPdfFixture() {
  const [documents, setDocuments] = React.useState<
    Array<{ doc: StaffDocumentView; blob: Blob }>
  >([]);
  const params = new URLSearchParams(location.search),
    canManage = params.get("permission") !== "generate",
    canGenerate = params.get("permission") !== "templates";
  const api = React.useMemo(() => {
    let bases: StaffPdfBase[] = [
        {
          id: "a".repeat(32),
          name: "Kit de teste.pdf",
          pageCount: 4,
          pages: Array.from({ length: 4 }, () => ({ width: 595, height: 842 })),
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
          },
        },
      ];
    const files = new Map<string, Blob>(),
      saved = new Map<string, StaffDocumentView>();
    const value: StaffPdfApi = {
      list: async () => ({
        bases: structuredClone(bases),
        layouts: structuredClone(layouts),
        truncated: false,
      }),
      baseFile: async (id) => {
        if (files.has(id)) return files.get(id)!;
        const d = await PDFDocument.create();
        for (let i = 0; i < 4; i++) {
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
      initial: async () => undefined,
      uploadAlphabet: async () => {},
      uploadBase: async (file) => {
        const d = await PDFDocument.load(await file.arrayBuffer()),
          id = crypto.randomUUID().replaceAll("-", "");
        files.set(id, file);
        bases.push({
          id,
          name: file.name,
          pageCount: d.getPageCount(),
          pages: [],
          revision: crypto.randomUUID().replaceAll("-", ""),
          source: "internal",
        });
      },
      deleteBase: async (id) => {
        bases = bases.filter((b) => b.id !== id);
      },
      saveLayout: async (name, layout, revision) => {
        const old = layouts.find((t) => t.name === name);
        if (old && old.revision !== revision) throw new Error("Molde mudou.");
        layouts = layouts.filter((t) => t.name !== name);
        layouts.push({
          id: old?.id || crypto.randomUUID().replaceAll("-", ""),
          name,
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
    return value;
  }, []);
  return (
    <main className="min-h-screen bg-[#111] p-3 text-white sm:p-8">
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
          canManage={canManage}
          canGenerate={canGenerate}
          api={api}
          timingApi={timing}
          onGenerated={async () => {}}
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
