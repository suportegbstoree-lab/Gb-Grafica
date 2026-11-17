import React from "react";
import { PDFDocument } from "pdf-lib";
import {
  DEFAULT_STAFF_PDF_COMPOUND_MARKER, normalizeStaffPdfCompoundMarker, type StaffPdfCompoundMarker,
} from "../lib/staffPdfCompound";
import { STAFF_DOCUMENT_MAX_BYTES } from "../lib/staffDocument";
import { drawStaffPdfCompoundMarker } from "../services/staffPdfRender";
import EditorModal from "./EditorModal";
import StaffPdfPreview from "./StaffPdfPreview";
import { StaffPdfTextColor } from "./StaffPdfTextControls";

const input = "mt-1 block w-full rounded-lg border border-gray-700 bg-black p-2";
export default function StaffPdfCompoundMarkerEditor({
  value, onClose, onSave,
}: {
  value?: StaffPdfCompoundMarker;
  onClose: () => void;
  onSave: (value: StaffPdfCompoundMarker) => Promise<void>;
}) {
  const [marker, setMarker] = React.useState(value ?? DEFAULT_STAFF_PDF_COMPOUND_MARKER);
  const [source, setSource] = React.useState<File>();
  const [preview, setPreview] = React.useState<Blob>();
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const update = (patch: Partial<StaffPdfCompoundMarker>) => setMarker(current => ({ ...current, ...patch }));
  async function previewMarker() {
    if (!source) return;
    setError("");
    setChecking(true);
    try {
      const settings = normalizeStaffPdfCompoundMarker(marker);
      const original = await PDFDocument.load(await source.arrayBuffer(), { updateMetadata: false });
      if (!original.getPageCount()) throw new Error("O PDF precisa ter ao menos uma página.");
      const document = await PDFDocument.create();
      const [page] = await document.copyPages(original, [0]);
      document.addPage(page);
      await drawStaffPdfCompoundMarker(document, page, "BR264666798641W", settings);
      setPreview(new Blob([new Uint8Array(await document.save())], { type: "application/pdf" }));
    } catch (failure) { setError((failure as Error).message); }
    finally { setChecking(false); }
  }
  async function save() {
    setBusy(true);
    setError("");
    try { await onSave(normalizeStaffPdfCompoundMarker(marker)); onClose(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <EditorModal wide title="Identificador visual" busy={busy || checking} onClose={onClose} closeLabel="Fechar identificador visual" doneLabel="Voltar" footerText=""
      footerActions={<button type="button" disabled={busy || checking}
        className="rounded-lg bg-pink-600 px-4 py-2 font-bold disabled:opacity-40" onClick={() => void save()}>Salvar identificador</button>}>
      <p className="mb-3 text-sm text-gray-300">A posição vale para a primeira página dos PDFs com rastreio repetido no lote. Use uma base de exemplo para conferir o espaço entre a arte e as linhas de corte.</p>
      {error && <p role="alert" className="mb-3 text-red-300">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <fieldset disabled={busy || checking} className="space-y-3">
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
          <label className="block">PDF de teste
            <input className={input} type="file" accept=".pdf,application/pdf" onChange={event => {
              const file = event.target.files?.[0];
              setPreview(undefined);
              if (file && (/\.pdf$/i.test(file.name) && file.size <= STAFF_DOCUMENT_MAX_BYTES)) {
                setSource(file);
                setError("");
              } else {
                setSource(undefined);
                setError(file ? "Selecione um PDF de até 50 MB." : "");
              }
            }} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded border border-gray-700 p-2" disabled={!source} onClick={() => void previewMarker()}>Atualizar prévia</button>
            <button type="button" className="rounded border border-gray-700 p-2" onClick={() => setMarker(DEFAULT_STAFF_PDF_COMPOUND_MARKER)}>Restaurar padrão</button>
          </div>
        </fieldset>
        {preview ? <StaffPdfPreview original={preview} pageCount={1} lines={[]} fonts={[]} /> :
          <p className="rounded-lg bg-gray-900 p-4 text-sm text-gray-300">Selecione um PDF e atualize a prévia para ver o identificador.</p>}
      </div>
    </EditorModal>
  );
}
