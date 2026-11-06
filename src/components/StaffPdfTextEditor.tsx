import React from "react";
import EditorModal from "./EditorModal";
import StaffPdfPreview from "./StaffPdfPreview";
import {
  DEFAULT_PDF_TEXT_EFFECTS,
  newPdfLine,
  STAFF_PDF_MAX_LINES,
  type StaffPdfLayout,
  type StaffPdfLine,
  type StaffPdfTextEffects,
  type PdfTextLayout,
} from "../lib/staffPdf";
import type { PersonalizationFont } from "../lib/textCustomization";
import type { StaffPdfApi } from "../services/staffPdfService";
import { useStaffPdfInitial } from "./useStaffPdfInitial";
const input =
  "mt-1 block w-full min-w-0 rounded-lg border border-gray-700 bg-black p-2";
export default function StaffPdfTextEditor({
  original,
  pageCount,
  layout,
  fonts,
  initialLines,
  initialSelected,
  onSave,
  onClose,
  api,
  baseId,
}: {
  original: Blob;
  pageCount: number;
  layout: StaffPdfLayout;
  fonts: PersonalizationFont[];
  initialLines: StaffPdfLine[];
  initialSelected?: string;
  onSave: (lines: StaffPdfLine[]) => void;
  onClose: () => void;
  api: StaffPdfApi;
  baseId: string;
}) {
  const [lines, setLines] = React.useState(() => structuredClone(initialLines)),
    [selected, setSelected] = React.useState(
      initialSelected || initialLines[0]?.id,
    ),
    [orientation, setOrientation] = React.useState<PdfTextLayout>("portrait"),
    [error, setError] = React.useState("");
  const current = lines.find((l) => l.id === selected),
    update = (patch: Partial<StaffPdfLine>) =>
      setLines((old) =>
        old.map((l) => (l.id === selected ? { ...l, ...patch } : l)),
      );
  const effects = current?.effects ?? DEFAULT_PDF_TEXT_EFFECTS;
  const updateEffects = (patch: Partial<StaffPdfTextEffects>) =>
    update({ effects: { ...effects, ...patch } });
  const { initial, initialError } = useStaffPdfInitial(
    api,
    baseId,
    lines.map((l) => l.text).join(" "),
    layout.imagem_full_page,
  );
  const move = React.useCallback(
    (id: string, x: number, y: number, o: PdfTextLayout) =>
      setLines((old) =>
        old.map((l) => (l.id === id ? { ...l, [o]: { ...l[o], x, y } } : l)),
      ),
    [],
  );
  return (
    <EditorModal
      wide
      title="Editar texto do PDF interno"
      onClose={onClose}
      closeLabel="Fechar edição do texto interno"
      doneLabel="Voltar sem aplicar"
      footerText="As alterações só entram na fila depois de aplicar e adicionar o arquivo."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {lines.map((line, i) => (
            <button
              key={line.id}
              onClick={() => setSelected(line.id)}
              aria-pressed={selected === line.id}
              className={`rounded-lg border px-3 py-2 text-sm ${selected === line.id ? "border-pink-500 bg-pink-950" : "border-gray-700"}`}
            >
              Linha {i + 1}
            </button>
          ))}
          <button
            disabled={lines.length >= STAFF_PDF_MAX_LINES}
            className="rounded-lg bg-purple-600 px-3 py-2 text-sm disabled:opacity-40"
            onClick={() => {
              const line = newPdfLine(layout, fonts, lines.length);
              setLines((old) => [...old, line]);
              setSelected(line.id);
            }}
          >
            Adicionar linha de texto
          </button>
        </div>
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
          {current && (
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:max-h-[65vh] lg:overflow-y-auto lg:pr-2">
              <label className="sm:col-span-2">
                Texto da linha
                <textarea
                  rows={2}
                  aria-label="Texto da linha interna"
                  maxLength={500}
                  value={current.text}
                  onChange={(e) => update({ text: e.target.value })}
                  className={input}
                />
              </label>
              <label>
                Fonte
                <select
                  aria-label="Fonte da linha interna"
                  value={current.fontId}
                  onChange={(e) => update({ fontId: e.target.value })}
                  className={input}
                >
                  <option value="">Selecione a fonte</option>
                  {fonts
                    .filter((f) => f.ativo)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Tamanho da fonte (px a 300 DPI)
                <input
                  aria-label="Tamanho da linha interna"
                  type="number"
                  min={1}
                  max={4000}
                  value={current.fontSize}
                  onChange={(e) => update({ fontSize: Number(e.target.value) })}
                  className={input}
                />
              </label>
              <label>
                Cor do texto
                <input
                  aria-label="Cor da linha interna"
                  type="color"
                  value={current.color}
                  onChange={(e) => update({ color: e.target.value })}
                  className={`${input} h-10`}
                />
              </label>
              <label>
                Alinhamento
                <select
                  aria-label="Alinhamento da linha interna"
                  value={current.align}
                  onChange={(e) =>
                    update({ align: e.target.value as StaffPdfLine["align"] })
                  }
                  className={input}
                >
                  <option value="left">Esquerda</option>
                  <option value="center">Centralizado</option>
                  <option value="right">Direita</option>
                </select>
              </label>
              <label>
                Rotação do texto (graus)
                <input
                  aria-label="Rotação da linha interna"
                  type="number"
                  min={-180}
                  max={180}
                  value={current.rotation}
                  onChange={(e) => update({ rotation: Number(e.target.value) })}
                  className={input}
                />
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <button
                  className="rounded-lg border border-gray-700 p-2 text-sm"
                  onClick={() =>
                    setLines((old) =>
                      old.map((l) => ({
                        ...l,
                        fontId: current.fontId,
                        color: current.color,
                      })),
                    )
                  }
                >
                  Aplicar fonte e cor a todas
                </button>
                <button
                  disabled={lines.length === 1}
                  className="rounded-lg border border-red-900 p-2 text-sm text-red-300 disabled:opacity-40"
                  onClick={() => {
                    setLines((old) => old.filter((l) => l.id !== selected));
                    setSelected(lines.find((l) => l.id !== selected)?.id);
                  }}
                >
                  Remover linha
                </button>
              </div>
              <fieldset className="space-y-3 rounded-xl border border-gray-700 p-3 sm:col-span-2">
                <legend>Efeitos da linha</legend>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={effects.bold}
                      onChange={(e) =>
                        updateEffects({ bold: e.target.checked })
                      }
                    />
                    Negrito
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={effects.outline}
                      onChange={(e) =>
                        updateEffects({ outline: e.target.checked })
                      }
                    />
                    Contorno
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      ["opacity", "Opacidade (%)", 0, 100, 1],
                      ["curve", "Curvatura", -100, 100, 1],
                      [
                        "letterSpacing",
                        "Espaçamento entre letras",
                        -50,
                        100,
                        1,
                      ],
                      ["lineSpacing", "Espaçamento entre linhas", 0.5, 3, 0.05],
                      ...(effects.outline
                        ? [
                            [
                              "outlineWidth",
                              "Espessura do contorno",
                              1,
                              30,
                              1,
                            ] as const,
                          ]
                        : []),
                    ] as const
                  ).map(([key, label, min, max, step]) => (
                    <label key={key} className="text-sm">
                      {label}
                      <input
                        type="number"
                        min={min}
                        max={max}
                        step={step}
                        className={input}
                        value={effects[key]}
                        onChange={(e) => {
                          if (Number.isFinite(e.target.valueAsNumber))
                            updateEffects({ [key]: e.target.valueAsNumber });
                        }}
                      />
                    </label>
                  ))}
                  {effects.outline && (
                    <label className="text-sm">
                      Cor do contorno
                      <input
                        type="color"
                        className={`${input} h-10`}
                        value={effects.outlineColor}
                        onChange={(e) =>
                          updateEffects({ outlineColor: e.target.value })
                        }
                      />
                    </label>
                  )}
                </div>
              </fieldset>
              <fieldset className="space-y-3 rounded-xl border border-gray-700 p-3 sm:col-span-2">
                <legend>Geometria da linha</legend>
                <label>
                  Orientação da área
                  <select
                    aria-label="Orientação da geometria"
                    value={orientation}
                    onChange={(e) =>
                      setOrientation(e.target.value as PdfTextLayout)
                    }
                    className={input}
                  >
                    <option value="portrait">Retrato · página 1</option>
                    {pageCount === 4 && (
                      <option value="landscape">Paisagem · página 3</option>
                    )}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(["x", "y", "width", "height"] as const).map((key) => (
                    <label key={key}>
                      {
                        { x: "X", y: "Y", width: "Largura", height: "Altura" }[
                          key
                        ]
                      }
                      <input
                        aria-label={`Linha ${key} ${orientation}`}
                        type="number"
                        min={key === "x" || key === "y" ? 0 : 1}
                        max={60000}
                        value={current[orientation][key]}
                        onChange={(e) =>
                          update({
                            [orientation]: {
                              ...current[orientation],
                              [key]: Number(e.target.value),
                            },
                          })
                        }
                        className={input}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
          <StaffPdfPreview
            original={original}
            pageCount={pageCount}
            lines={lines}
            fonts={fonts}
            selected={selected}
            onSelect={setSelected}
            onMove={move}
            fitMargin={layout.fit_margin}
            initial={initial}
          />
        </div>
        {initialError && (
          <p role="alert" className="text-red-300">
            {initialError}
          </p>
        )}
        {error && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}
        <button
          className="w-full rounded-xl bg-pink-500 px-5 py-3 font-bold"
          onClick={() => {
            if (!lines.some((l) => l.text.trim())) {
              setError("Digite pelo menos uma linha.");
              return;
            }
            if (
              lines.some(
                (l) => !fonts.some((f) => f.ativo && f.id === l.fontId),
              )
            ) {
              setError("Escolha uma fonte ativa para cada linha.");
              return;
            }
            onSave(lines);
          }}
        >
          Aplicar texto à edição
        </button>
      </div>
    </EditorModal>
  );
}
