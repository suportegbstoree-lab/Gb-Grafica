import React from "react";
import { AlignCenter, AlignLeft, AlignRight, Bold, Grid2X2, Minus, Plus, TextCursorInput } from "lucide-react";
import {
  DEFAULT_PDF_TEXT_EFFECTS,
  STAFF_PDF_SYSTEM_FONT,
  type StaffPdfLine,
  type StaffPdfTextEffects,
} from "../lib/staffPdf";
import type { PersonalizationFont } from "../lib/textCustomization";

const field = "rounded border border-gray-700 bg-black px-2 py-1 text-sm";
const control = "inline-flex h-8 min-w-7 items-center justify-center rounded-md bg-[#1d5f94] px-1.5 text-sm text-white hover:bg-[#2679b9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 disabled:opacity-50";

function Slider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  function update(next: number) {
    if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)));
  }
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <div className="flex items-center gap-2">
        <input
          aria-label={`Controle de ${label.toLowerCase()}`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => update(e.target.valueAsNumber)}
        />
        <input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          className={`${field} w-20`}
          onChange={(e) => {
            if (e.target.valueAsNumber >= min && e.target.valueAsNumber <= max)
              update(e.target.valueAsNumber);
          }}
        />
      </div>
    </label>
  );
}

export default function StaffPdfTextEditor({
  lines,
  selected,
  fonts,
  disabled,
  onSelect,
  onChange,
  allowTextEditing = true,
}: {
  lines: StaffPdfLine[];
  selected?: string;
  fonts: PersonalizationFont[];
  disabled: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<StaffPdfLine>) => void;
  allowTextEditing?: boolean;
}) {
  const [panel, setPanel] = React.useState<"effects" | "spacing" | "opacity">();
  const line = lines.find((item) => item.id === selected) ?? lines[0];
  if (!line) return null;
  const extra = line.kind === "extra";
  const effects = { ...DEFAULT_PDF_TEXT_EFFECTS, ...line.effects };
  const change = (patch: Partial<StaffPdfLine>) => onChange(line.id, patch);
  const style = (patch: Partial<StaffPdfTextEffects>) =>
    change({ effects: { ...effects, ...patch } });
  const toggle = (next: typeof panel) =>
    setPanel(panel === next ? undefined : next);
  const AlignmentIcon = { left: AlignLeft, center: AlignCenter, right: AlignRight }[line.align];
  const resize = (amount: number) =>
    change({ fontSize: Math.max(1, Math.min(4000, line.fontSize + amount)) });
  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 space-y-2 rounded-lg border border-[#38516d] bg-[#21242d] p-2"
    >
      <legend className="sr-only">
        Formatação do texto
      </legend>
      <div className="flex flex-wrap items-center gap-1">
        {lines.length > 1 && (
          <label className="min-w-0">
            <span className="sr-only">Texto selecionado</span>
            <select
              className={`${control} w-32 max-w-full`}
              value={line.id}
              onChange={(e) => onSelect(e.target.value)}
            >
              {lines.map((item, i) => (
                <option key={item.id} value={item.id}>
                  {i ? `Linha extra ${i}` : "Texto principal"}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="min-w-0 max-w-full">
          <span className="sr-only">Fonte</span>
          <select
            value={line.fontId}
            className={`${control} max-w-40`}
            onChange={(e) => change({ fontId: e.target.value })}
          >
            {[
              STAFF_PDF_SYSTEM_FONT,
              ...fonts.filter((font) => font.id !== STAFF_PDF_SYSTEM_FONT.id),
            ].map((font) => (
              <option key={font.id} value={font.id}>
                {font.nome}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button type="button" className={control} aria-label="Diminuir tamanho"
            title="Diminuir tamanho" disabled={line.fontSize <= 1} onClick={() => resize(-1)}>
            <Minus size={14} aria-hidden="true" />
          </button>
          <input
            aria-label="Tamanho (px)"
            type="number"
            min={1}
            max={4000}
            className="h-8 w-14 rounded-md border border-[#596371] bg-[#323741] px-1 text-center text-sm text-white"
            value={line.fontSize}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              if (n >= 1 && n <= 4000) change({ fontSize: n });
            }}
          />
          <button type="button" className={control} aria-label="Aumentar tamanho"
            title="Aumentar tamanho" disabled={line.fontSize >= 4000} onClick={() => resize(1)}>
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
        {extra && (
          <>
            <button
              type="button"
              className={`${control} aria-pressed:bg-blue-400 aria-pressed:text-gray-950`}
              aria-label="Negrito"
              title="Negrito"
              aria-pressed={effects.bold}
              onClick={() => style({ bold: !effects.bold })}
            >
              <Bold size={16} aria-hidden="true" />
            </button>
            <label className={`${control} relative focus-within:ring-2 focus-within:ring-blue-300`} title="Alinhamento">
              <span className="sr-only">Alinhamento</span>
              <AlignmentIcon size={16} aria-hidden="true" />
              <select
                className="absolute inset-0 cursor-pointer opacity-0"
                value={line.align}
                onChange={(e) =>
                  change({ align: e.target.value as StaffPdfLine["align"] })
                }
              >
                <option value="left">Esquerda</option>
                <option value="center">Centro</option>
                <option value="right">Direita</option>
              </select>
            </label>
            <label className="inline-flex" title="Cor">
              <span className="sr-only">Cor</span>
              <input
                className="h-8 w-9 cursor-pointer rounded-md border border-[#596371] bg-[#151820] p-0.5"
                type="color"
                value={line.color}
                onChange={(e) => change({ color: e.target.value })}
              />
            </label>
            <button
              type="button"
              className={control}
              aria-expanded={panel === "effects"}
              onClick={() => toggle("effects")}
            >
              Efeitos
            </button>
            <button
              type="button"
              className={control}
              aria-label="Opções de letra"
              title="Opções de letra"
              aria-expanded={panel === "spacing"}
              onClick={() => toggle("spacing")}
            >
              <TextCursorInput size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={control}
              aria-label="Transparência"
              title="Transparência"
              aria-expanded={panel === "opacity"}
              onClick={() => toggle("opacity")}
            >
              <Grid2X2 size={16} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      {extra && allowTextEditing && (
        <label className="grid text-xs">
          Texto da linha extra
          <textarea
            rows={2}
            maxLength={500}
            className={field}
            value={line.text}
            onChange={(e) => change({ text: e.target.value })}
          />
        </label>
      )}
      {extra && panel === "opacity" && (
        <Slider
          label="Opacidade (%)"
          min={0}
          max={100}
          value={effects.opacity}
          onChange={(opacity) => style({ opacity })}
        />
      )}
      {extra && panel === "spacing" && (
        <div className="flex flex-wrap gap-4">
          <Slider
            label="Espaçamento entre letras"
            min={-50}
            max={100}
            value={effects.letterSpacing}
            onChange={(letterSpacing) => style({ letterSpacing })}
          />
          <Slider
            label="Espaçamento entre linhas"
            min={0.5}
            max={3}
            step={0.05}
            value={effects.lineSpacing}
            onChange={(lineSpacing) => style({ lineSpacing })}
          />
        </div>
      )}
      {extra && panel === "effects" && (
        <div className="grid gap-3 border-t border-gray-700 pt-2">
          <label>
            <input
              type="checkbox"
              checked={Boolean(effects.shadow)}
              onChange={(e) =>
                style({
                  shadow: e.target.checked
                    ? { x: 8, y: 8, blur: 10, color: "#000000" }
                    : undefined,
                })
              }
            />{" "}
            Sombra
          </label>
          {effects.shadow && (
            <div className="flex flex-wrap gap-3">
              {(["x", "y", "blur"] as const).map((key) => (
                <div key={key}>
                  <Slider
                    label={
                      { x: "Horizontal", y: "Vertical", blur: "Desfoque" }[key]
                    }
                    min={key === "blur" ? 0 : -200}
                    max={key === "blur" ? 100 : 200}
                    value={effects.shadow![key]}
                    onChange={(n) =>
                      style({ shadow: { ...effects.shadow!, [key]: n } })
                    }
                  />
                </div>
              ))}
              <label>
                Cor da sombra{" "}
                <input
                  type="color"
                  value={effects.shadow.color}
                  onChange={(e) =>
                    style({
                      shadow: { ...effects.shadow!, color: e.target.value },
                    })
                  }
                />
              </label>
            </div>
          )}
          <label>
            <input
              type="checkbox"
              checked={effects.outline}
              onChange={(e) => style({ outline: e.target.checked })}
            />{" "}
            Contorno
          </label>
          {effects.outline && (
            <div className="flex flex-wrap gap-3">
              <Slider
                label="Espessura do contorno"
                min={1}
                max={30}
                value={effects.outlineWidth}
                onChange={(outlineWidth) => style({ outlineWidth })}
              />
              <Slider
                label="Opacidade do contorno (%)"
                min={0}
                max={100}
                value={effects.outlineOpacity ?? 100}
                onChange={(outlineOpacity) => style({ outlineOpacity })}
              />
              <label>
                Cor do contorno{" "}
                <input
                  type="color"
                  value={effects.outlineColor}
                  onChange={(e) => style({ outlineColor: e.target.value })}
                />
              </label>
            </div>
          )}
          <label>
            <input
              type="checkbox"
              checked={Boolean(effects.glow)}
              onChange={(e) =>
                style({
                  glow: e.target.checked
                    ? { intensity: 20, color: "#ffffff" }
                    : undefined,
                })
              }
            />{" "}
            Brilho
          </label>
          {effects.glow && (
            <div className="flex flex-wrap gap-3">
              <Slider
                label="Intensidade do brilho"
                min={1}
                max={100}
                value={effects.glow.intensity}
                onChange={(intensity) =>
                  style({ glow: { ...effects.glow!, intensity } })
                }
              />
              <label>
                Cor do brilho{" "}
                <input
                  type="color"
                  value={effects.glow.color}
                  onChange={(e) =>
                    style({ glow: { ...effects.glow!, color: e.target.value } })
                  }
                />
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <Slider
              label="Curvatura"
              min={0}
              max={100}
              value={Math.abs(effects.curve)}
              onChange={(value) =>
                style({ curve: effects.curve < 0 ? -value : value })
              }
            />
            <label className="grid text-sm">
              Direção da curva
              <select
                className={field}
                disabled={!effects.curve}
                value={effects.curve < 0 ? -1 : 1}
                onChange={(e) =>
                  style({
                    curve: Math.abs(effects.curve) * Number(e.target.value),
                  })
                }
              >
                <option value={1}>Para cima</option>
                <option value={-1}>Para baixo</option>
              </select>
            </label>
          </div>
        </div>
      )}
    </fieldset>
  );
}
