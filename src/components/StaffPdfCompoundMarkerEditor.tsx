import React from "react";
import { PDFDocument } from "pdf-lib";
import {
  DEFAULT_STAFF_PDF_COMPOUND_MARKER, normalizeStaffPdfCompoundMarker, type StaffPdfCompoundMarker,
} from "../lib/staffPdfCompound";
import { compareStaffPdfNames, type StaffPdfBase } from "../lib/staffPdf";
import { UNCATEGORIZED_PDFS } from "../lib/staffPdfCategory";
import { addStaffPdfSourcePage, drawStaffPdfCompoundMarker } from "../services/staffPdfRender";
import type { StaffPdfApi } from "../services/staffPdfService";
import EditorModal from "./EditorModal";
import StaffPdfPreview from "./StaffPdfPreview";
import { StaffPdfTextColor } from "./StaffPdfTextControls";

const input = "mt-1 block w-full rounded-lg border border-gray-700 bg-black p-2";
export default function StaffPdfCompoundMarkerEditor({
  value, bases, readBase, onClose, onSave,
}: {
  value?: StaffPdfCompoundMarker;
  bases: StaffPdfBase[];
  readBase: StaffPdfApi["baseFile"];
  onClose: () => void;
  onSave: (value: StaffPdfCompoundMarker) => Promise<void>;
}) {
  const [marker, setMarker] = React.useState(value ?? DEFAULT_STAFF_PDF_COMPOUND_MARKER);
  const sortedBases = React.useMemo(() => [...bases].sort((a, b) => compareStaffPdfNames(a.name, b.name)), [bases]);
  const [baseId, setBaseId] = React.useState("");
  const base = sortedBases.find(row => row.id === baseId) ?? sortedBases[0];
  const selectedId = base?.id;
  const sourceKey = base ? `${base.id}/${base.revision}` : "";
  const source = React.useRef<{ key: string; pdf: PDFDocument }>(undefined);
  const [previewSettings, setPreviewSettings] = React.useState(marker);
  const [preview, setPreview] = React.useState<{ key: string; blob: Blob }>();
  const [previewError, setPreviewError] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const update = (patch: Partial<StaffPdfCompoundMarker>) => setMarker(current => ({ ...current, ...patch }));
  React.useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setChecking(true);
    setPreviewError("");
    async function render(id: string) {
      try {
        const settings = normalizeStaffPdfCompoundMarker(previewSettings);
        const original = source.current?.key === sourceKey
          ? source.current.pdf
          : await PDFDocument.load(await (await readBase(id)).arrayBuffer(), { updateMetadata: false });
        if (!active) return;
        if (!original.getPageCount()) throw new Error("O PDF precisa ter ao menos uma página.");
        source.current = { key: sourceKey, pdf: original };
        const document = await PDFDocument.create();
        const page = await addStaffPdfSourcePage(document, original.getPage(0));
        await drawStaffPdfCompoundMarker(document, page, "BR264666798641W", settings, "tiktok");
        const bytes = await document.save();
        if (active) setPreview({
          key: sourceKey,
          blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        });
      } catch (failure) {
        if (active) setPreviewError((failure as Error).message);
      } finally {
        if (active) setChecking(false);
      }
    }
    void render(selectedId);
    return () => { active = false; };
  }, [readBase, previewSettings, selectedId, sourceKey]);
  async function save() {
    setBusy(true);
    setError("");
    try { await onSave(normalizeStaffPdfCompoundMarker(marker)); onClose(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <EditorModal wide title="Identificador visual" busy={busy} onClose={onClose} closeLabel="Fechar identificador visual" doneLabel="Voltar" footerText=""
      footerActions={<button type="button" disabled={busy}
        className="rounded-lg bg-pink-600 px-4 py-2 font-bold disabled:opacity-40" onClick={() => void save()}>Salvar identificador</button>}>
      <p className="mb-3 text-sm text-gray-300">O identificador fica na primeira página e mostra a origem do pedido quando informada. Se o rastreio se repetir no mesmo lote, ele também marca o pedido como composto. Use uma base de exemplo para conferir a posição.</p>
      {error && <p role="alert" className="mb-3 text-red-300">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <fieldset disabled={busy} className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {([["x", "Posição horizontal (%)", 0, 100, 0.1], ["y", "Posição vertical (%)", 0, 100, 0.1], ["size", "Tamanho (pt)", 6, 36, 0.5]] as const).map(([key, label, min, max, step]) =>
              <label key={key}>{label}
                <input className={input} type="number" value={marker[key]} min={min} max={max} step={step}
                  onChange={event => update({ [key]: Number(event.target.value) })} />
              </label>)}
            <label>Orientação
              <select className={input} value={marker.angle} onChange={event => update({ angle: Number(event.target.value) as StaffPdfCompoundMarker["angle"] })}>
                <option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option>
              </select>
            </label>
            <label>Fonte
              <select className={input} value={marker.font} onChange={event => update({ font: event.target.value as StaffPdfCompoundMarker["font"] })}>
                <option value="courier">Courier (monoespaçada)</option><option value="helvetica">Helvetica</option>
              </select>
            </label>
            <div className="grid justify-items-start gap-1">Cor<StaffPdfTextColor label="Cor do identificador" value={marker.color} onChange={color => update({ color })} /></div>
          </div>
          <label className="block">Base PDF para a prévia
            <select className={input} value={selectedId ?? ""} disabled={!sortedBases.length} onChange={event => {
              setBaseId(event.target.value);
              setPreviewSettings({ ...marker });
            }}>
              {!sortedBases.length && <option value="">Nenhuma base disponível</option>}
              {sortedBases.map(row => <option key={row.id} value={row.id}>
                {row.name} · {row.category || (row.source === "catalog" ? "Produtos" : UNCATEGORIZED_PDFS)}
              </option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded border border-gray-700 p-2 disabled:opacity-40" disabled={!selectedId || checking}
              onClick={() => setPreviewSettings({ ...marker })}>Atualizar prévia</button>
            <button type="button" className="rounded border border-gray-700 p-2" onClick={() => {
              setMarker(DEFAULT_STAFF_PDF_COMPOUND_MARKER);
              setPreviewSettings({ ...DEFAULT_STAFF_PDF_COMPOUND_MARKER });
            }}>Restaurar padrão</button>
          </div>
        </fieldset>
        <div className="min-w-0 space-y-2">
          {!selectedId && <p className="rounded-lg bg-gray-900 p-4 text-sm text-gray-300">Nenhuma base PDF cadastrada na biblioteca.</p>}
          {selectedId && checking && <p role="status" className="text-sm text-gray-300">Carregando prévia…</p>}
          {selectedId && previewError && <p role="alert" className="text-sm text-red-300">{previewError}</p>}
          {selectedId && preview?.key === sourceKey && <StaffPdfPreview original={preview.blob} pageCount={1} lines={[]} fonts={[]} />}
        </div>
      </div>
    </EditorModal>
  );
}
