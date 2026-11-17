import React from "react";
import { AlignCenter, AlignLeft, AlignRight, Bold, Check, Grid2X2, Minus, Plus, SlidersHorizontal, TextCursorInput } from "lucide-react";
import {
  DEFAULT_PDF_TEXT_EFFECTS,
  STAFF_PDF_SYSTEM_FONT,
  type StaffPdfLine,
  type StaffPdfTextEffects,
} from "../lib/staffPdf";
import type { PersonalizationFont } from "../lib/textCustomization";
import { StaffPdfTextColor, StaffPdfTextPopover, StaffPdfTextSelect, textControl, textField } from "./StaffPdfTextControls";

function Slider({
  label, min, max, step = 1, value, onChange,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-x-2 text-xs">
      <span className="col-span-2 text-slate-200">{label}</span>
      <input aria-label={`Controle de ${label.toLowerCase()}`} type="range" min={min} max={max} step={step}
        value={value} className="staff-pdf-text-range w-full"
        style={{ "--range-fill": `${((value - min) * 100) / (max - min)}%` } as React.CSSProperties}
        onChange={(event) => onChange(event.target.valueAsNumber)} />
      <input aria-label={label} type="number" min={min} max={max} step={step}
        value={value} className={`${textField} staff-pdf-text-number w-full text-right`}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          if (next >= min && next <= max) onChange(next);
        }} />
    </div>
  );
}

function EffectToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="relative flex min-h-8 flex-1 cursor-pointer items-center gap-2 rounded-md bg-slate-700/60 px-2 hover:bg-slate-600">
      <input type="checkbox" className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0" checked={checked} onChange={onChange} />
      <span className="grid h-4 w-4 place-items-center rounded border border-slate-400 text-transparent peer-checked:border-blue-400 peer-checked:bg-[#1d5f94] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300">
        <Check size={12} aria-hidden="true" />
      </span>
      <span>{label}</span>
    </label>
  );
}

function TextEffects({
  effects, onChange, disabled,
}: {
  effects: StaffPdfTextEffects;
  onChange: (patch: Partial<StaffPdfTextEffects>) => void;
  disabled: boolean;
}) {
  const [detail, setDetail] = React.useState<"outline" | "curve" | "shadow" | "glow">();
  const toggle = (effect: typeof detail) => setDetail(detail === effect ? undefined : effect);
  const { outline, shadow, glow } = effects;
  return (
    <StaffPdfTextPopover label="Efeitos" trigger="Efeitos" panelClass="w-56" disabled={disabled}>
      <div className="grid gap-1">
        <div className="flex gap-1">
          <EffectToggle label="Contorno" checked={outline} onChange={() => {
            onChange({ outline: !outline });
            if (outline && detail === "outline") setDetail(undefined);
          }} />
          <StaffPdfTextColor label="Cor do contorno" value={effects.outlineColor}
            onChange={(outlineColor) => onChange({ outlineColor })} />
          <button type="button" className={textControl} disabled={!outline} aria-expanded={detail === "outline"}
            aria-label="Ajustes do contorno" title="Ajustes do contorno" onClick={() => toggle("outline")}>
            <SlidersHorizontal size={14} aria-hidden="true" />
          </button>
        </div>
        {outline && detail === "outline" && (
          <div className="grid gap-1.5 rounded-md bg-slate-900/70 p-2">
            <Slider label="Espessura do contorno" min={1} max={30} value={effects.outlineWidth}
              onChange={(outlineWidth) => onChange({ outlineWidth })} />
            <Slider label="Opacidade do contorno (%)" min={0} max={100} value={effects.outlineOpacity ?? 100}
              onChange={(outlineOpacity) => onChange({ outlineOpacity })} />
          </div>
        )}
        <button type="button" className={`${textControl} !justify-start !bg-slate-700/60 px-2 hover:!bg-slate-600`}
          aria-expanded={detail === "curve"} onClick={() => toggle("curve")}>Curvar</button>
        {detail === "curve" && (
          <div className="grid gap-1.5 rounded-md bg-slate-900/70 p-2">
            <Slider label="Curvatura" min={0} max={100} value={Math.abs(effects.curve)}
              onChange={(value) => onChange({ curve: effects.curve < 0 ? -value : value })} />
            <StaffPdfTextSelect label="Direção da curva" disabled={!effects.curve} value={effects.curve < 0 ? "-1" : "1"}
              options={[{ value: "1", label: "Para cima" }, { value: "-1", label: "Para baixo" }]}
              onChange={(value) => onChange({ curve: Math.abs(effects.curve) * Number(value) })} />
          </div>
        )}
        <div className="flex gap-1">
          <EffectToggle label="Sombra" checked={Boolean(shadow)} onChange={() => {
            onChange({ shadow: shadow ? undefined : { x: 8, y: 8, blur: 10, color: "#000000" } });
            if (shadow && detail === "shadow") setDetail(undefined);
          }} />
          {shadow && <StaffPdfTextColor label="Cor da sombra" value={shadow.color}
            onChange={(color) => onChange({ shadow: { ...shadow, color } })} />}
          <button type="button" className={textControl} disabled={!shadow} aria-expanded={detail === "shadow"}
            aria-label="Ajustes da sombra" title="Ajustes da sombra" onClick={() => toggle("shadow")}>
            <SlidersHorizontal size={14} aria-hidden="true" />
          </button>
        </div>
        {shadow && detail === "shadow" && (
          <div className="grid gap-1.5 rounded-md bg-slate-900/70 p-2">
            {([
              ["x", "Horizontal", -200, 200],
              ["y", "Vertical", -200, 200],
              ["blur", "Desfoque", 0, 100],
            ] as const).map(([key, label, min, max]) => (
              <div key={key}>
                <Slider label={label} min={min} max={max} value={shadow[key]}
                  onChange={(value) => onChange({ shadow: { ...shadow, [key]: value } })} />
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-1">
          <EffectToggle label="Brilho" checked={Boolean(glow)} onChange={() => {
            onChange({ glow: glow ? undefined : { intensity: 20, color: "#ffffff" } });
            if (glow && detail === "glow") setDetail(undefined);
          }} />
          {glow && <StaffPdfTextColor label="Cor do brilho" value={glow.color}
            onChange={(color) => onChange({ glow: { ...glow, color } })} />}
          <button type="button" className={textControl} disabled={!glow} aria-expanded={detail === "glow"}
            aria-label="Ajustes do brilho" title="Ajustes do brilho" onClick={() => toggle("glow")}>
            <SlidersHorizontal size={14} aria-hidden="true" />
          </button>
        </div>
        {glow && detail === "glow" && (
          <div className="rounded-md bg-slate-900/70 p-2">
            <Slider label="Intensidade do brilho" min={1} max={100} value={glow.intensity}
              onChange={(intensity) => onChange({ glow: { ...glow, intensity } })} />
          </div>
        )}
      </div>
    </StaffPdfTextPopover>
  );
}

export default function StaffPdfTextEditor({
  lines, selected, fonts, disabled, onSelect, onChange, allowTextEditing = true, editMainStyle = false,
}: {
  lines: StaffPdfLine[];
  selected?: string;
  fonts: PersonalizationFont[];
  disabled: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<StaffPdfLine>) => void;
  allowTextEditing?: boolean;
  editMainStyle?: boolean;
}) {
  const line = lines.find((item) => item.id === selected) ?? lines[0];
  if (!line) return null;
  const extra = line.kind === "extra";
  const canStyle = extra || editMainStyle;
  const hasExtras = lines.some((item) => item.kind === "extra");
  const effects = { ...DEFAULT_PDF_TEXT_EFFECTS, ...line.effects };
  const change = (patch: Partial<StaffPdfLine>) => onChange(line.id, patch);
  const style = (patch: Partial<StaffPdfTextEffects>) => change({ effects: { ...effects, ...patch } });
  const AlignmentIcon = { left: AlignLeft, center: AlignCenter, right: AlignRight }[line.align];
  const resize = (amount: number) =>
    change({ fontSize: Math.max(1, Math.min(4000, line.fontSize + amount)) });
  return (
    <fieldset disabled={disabled}
      className="min-w-0 space-y-1.5 rounded-lg border border-[#38516d] bg-[#21242d] p-1.5 shadow-lg">
      <legend className="sr-only">Formatação do texto</legend>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {lines.length > 1 && (
          <StaffPdfTextSelect label="Texto selecionado" value={line.id} onChange={onSelect}
            className="w-[min(8rem,44%)]" disabled={disabled}
            options={lines.map((item, index) => ({
              value: item.id,
              label: index ? `Linha extra ${index}` : "Texto principal",
            }))} />
        )}
        <StaffPdfTextSelect label="Fonte" value={line.fontId} searchable onChange={(fontId) => change({ fontId })}
          className="w-[min(10rem,52%)]" disabled={disabled}
          options={[STAFF_PDF_SYSTEM_FONT, ...fonts.filter((font) => font.id !== STAFF_PDF_SYSTEM_FONT.id)]
            .map((font) => ({ value: font.id, label: font.nome }))} />
        <div className="flex items-center gap-1">
          <button type="button" className={textControl} aria-label="Diminuir tamanho" title="Diminuir tamanho"
            disabled={line.fontSize <= 1} onClick={() => resize(-1)}>
            <Minus size={14} aria-hidden="true" />
          </button>
          <input aria-label="Tamanho (px)" type="number" min={1} max={4000} value={line.fontSize}
            className={`${textField} staff-pdf-text-number h-8 w-14 text-center`}
            onChange={(event) => {
              const n = event.target.valueAsNumber;
              if (n >= 1 && n <= 4000) change({ fontSize: n });
            }} />
          <button type="button" className={textControl} aria-label="Aumentar tamanho" title="Aumentar tamanho"
            disabled={line.fontSize >= 4000} onClick={() => resize(1)}>
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
        {(hasExtras || editMainStyle) && (
          <div key={line.id} className={`contents ${canStyle ? "" : "invisible"}`} aria-hidden={!canStyle}>
            <button type="button" className={`${textControl} aria-pressed:bg-blue-400 aria-pressed:text-gray-950`}
              aria-label="Negrito" title="Negrito" aria-pressed={effects.bold} disabled={!canStyle}
              onClick={() => style({ bold: !effects.bold })}>
              <Bold size={16} aria-hidden="true" />
            </button>
            <StaffPdfTextSelect label="Alinhamento" value={line.align} disabled={disabled || !canStyle}
              icon={<AlignmentIcon size={16} aria-hidden="true" />}
              options={[{ value: "left", label: "Esquerda" }, { value: "center", label: "Centro" }, { value: "right", label: "Direita" }]}
              onChange={(align) => change({ align: align as StaffPdfLine["align"] })} />
            <StaffPdfTextColor label="Cor" value={line.color} disabled={disabled || !canStyle}
              onChange={(color) => change({ color })} />
            <TextEffects effects={effects} onChange={style} disabled={disabled || !canStyle} />
            <StaffPdfTextPopover label="Opções de letra" trigger={<TextCursorInput size={16} aria-hidden="true" />}
              panelClass="w-56" disabled={disabled || !canStyle}>
              <div className="grid gap-2 p-1">
                <Slider label="Rotação do texto" min={-180} max={180} value={line.rotation}
                  onChange={(rotation) => change({ rotation })} />
                <Slider label="Espaçamento entre letras" min={-50} max={100} value={effects.letterSpacing}
                  onChange={(letterSpacing) => style({ letterSpacing })} />
                <Slider label="Espaçamento entre linhas" min={0.5} max={3} step={0.05} value={effects.lineSpacing}
                  onChange={(lineSpacing) => style({ lineSpacing })} />
              </div>
            </StaffPdfTextPopover>
            <StaffPdfTextPopover label="Transparência" trigger={<Grid2X2 size={16} aria-hidden="true" />}
              panelClass="w-52" disabled={disabled || !canStyle}>
              <div className="p-1">
                <Slider label="Opacidade (%)" min={0} max={100} value={effects.opacity}
                  onChange={(opacity) => style({ opacity })} />
              </div>
            </StaffPdfTextPopover>
          </div>
        )}
      </div>
      {hasExtras && allowTextEditing && (
        <label className={`grid gap-0.5 text-xs text-slate-300 ${extra ? "" : "invisible"}`} aria-hidden={!extra}>
          Texto da linha extra
          <textarea rows={2} maxLength={500} className={`${textField} resize-none`} value={extra ? line.text : ""} disabled={!extra}
            onChange={(event) => change({ text: event.target.value })} />
        </label>
      )}
    </fieldset>
  );
}
