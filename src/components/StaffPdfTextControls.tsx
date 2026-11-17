import React from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export const textControl = "inline-flex h-8 min-w-7 items-center justify-center gap-1 rounded-md bg-[#1d5f94] px-1.5 text-sm text-white hover:bg-[#2679b9] aria-expanded:bg-[#2679b9] disabled:opacity-50";
export const textField = "rounded-md border border-[#49576a] bg-[#191f2a] px-2 py-1 text-sm text-white";

export function StaffPdfTextPopover({
  label, trigger, children, className = "", panelClass = "", disabled, role, focusOnOpen,
}: {
  label: string;
  trigger: React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  className?: string;
  panelClass?: string;
  disabled?: boolean;
  role?: "listbox" | "group";
  focusOnOpen?: string;
}) {
  const id = React.useId();
  const button = React.useRef<HTMLButtonElement>(null);
  const popup = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const close = () => {
    popup.current?.hidePopover();
    button.current?.focus({ preventScroll: true });
  };
  React.useLayoutEffect(() => {
    const anchor = button.current;
    const panel = popup.current;
    if (!open || !anchor || !panel) return;
    const position = () => {
      if (!panel.matches(":popover-open")) return;
      const gap = 5;
      const edge = 8;
      const rect = anchor.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - gap - edge;
      const above = rect.top - gap - edge;
      const opensAbove = panel.scrollHeight > below && above > below;
      panel.style.maxHeight = `${Math.max(0, opensAbove ? above : below)}px`;
      panel.style.top = `${Math.max(edge, Math.min(opensAbove ? rect.top - gap - panel.offsetHeight : rect.bottom + gap, window.innerHeight - edge - panel.offsetHeight))}px`;
      panel.style.left = `${Math.max(edge, Math.min(rect.left, window.innerWidth - edge - panel.offsetWidth))}px`;
      panel.style.visibility = "visible";
    };

    position();
    if (focusOnOpen)
      panel.querySelector<HTMLElement>(focusOnOpen)?.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    observer.observe(anchor);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      panel.style.visibility = "";
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, focusOnOpen]);

  React.useEffect(() => {
    if (disabled && popup.current?.matches(":popover-open")) popup.current.hidePopover();
  }, [disabled]);

  return (
    <>
      <button type="button" ref={button} className={`${textControl} ${className}`}
        title={label} aria-label={label} aria-expanded={open}
        aria-haspopup={role === "listbox" ? "listbox" : undefined}
        aria-controls={id} popoverTarget={id} disabled={disabled}>
        {trigger}
      </button>
      <div ref={popup} id={id} popover="auto" role={role === "listbox" ? undefined : "group"} aria-label={label}
        className={`staff-pdf-text-popover ${panelClass}`}
        onToggle={(event) => setOpen(event.currentTarget.matches(":popover-open"))}>
        {typeof children === "function" ? children(close) : children}
      </div>
    </>
  );
}

export function StaffPdfTextSelect({
  label, value, options, onChange, searchable, icon, className, disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  searchable?: boolean;
  icon?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const [search, setSearch] = React.useState("");
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const query = normalize(search.trim());
  const choices = query ? options.filter((option) => normalize(option.label).includes(query)) : options;
  const selected = options.find((option) => option.value === value);
  return (
    <StaffPdfTextPopover label={label} role="listbox" className={className} disabled={disabled}
      panelClass="w-52" focusOnOpen={searchable ? "input" : "[aria-selected=true]"}
      trigger={icon ?? <><span className="min-w-0 flex-1 truncate text-left">{selected?.label}</span><ChevronDown className="shrink-0" size={14} aria-hidden="true" /></>}>
      {(close) => (
        <div className="grid gap-1" onKeyDown={(event) => {
          if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
          if (event.target instanceof HTMLInputElement && ["Home", "End"].includes(event.key)) return;
          const list = event.currentTarget as HTMLDivElement;
          const buttons = [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')];
          if (!buttons.length) return;
          event.preventDefault();
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
            event.key === "ArrowDown" ? (current + 1) % buttons.length : (current <= 0 ? buttons.length - 1 : current - 1);
          buttons[next].focus();
        }}>
          {searchable && (
            <label className="flex items-center gap-1.5 px-1 text-slate-300">
              <Search size={14} aria-hidden="true" />
              <input type="search" aria-label="Buscar fonte" placeholder="Buscar fonte" className={`${textField} min-w-0 w-full`}
                value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
          )}
          <div role="listbox" aria-label={label} className="grid gap-0.5">
            {choices.map((option) => (
              <button key={option.value} role="option" aria-selected={option.value === value} type="button" tabIndex={-1}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-700 aria-selected:bg-[#244d70]"
                onClick={() => {
                  onChange(option.value);
                  setSearch("");
                  close();
                }}>
                <span className="flex-1 break-words">{option.label}</span>
                {option.value === value && <Check className="shrink-0" size={14} aria-hidden="true" />}
              </button>
            ))}
          </div>
          {!choices.length && <p className="px-2 py-1 text-slate-300">Nenhuma opção encontrada.</p>}
        </div>
      )}
    </StaffPdfTextPopover>
  );
}

const colorByte = (value: number) => Math.round(value).toString(16).padStart(2, "0");
const clampColor = (value: number) => Math.max(0, Math.min(1, value));
function hsvHex(hue: number, saturation: number, brightness: number) {
  return "#" + [5, 3, 1].map(offset => {
    const k = (offset + hue / 60) % 6;
    return colorByte(255 * brightness * (1 - saturation * Math.max(0, Math.min(k, 4 - k, 1))));
  }).join("");
}
function colorChannels(value: string) {
  return [1, 3, 5].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16) || 0);
}
function colorCoordinates([red, green, blue]: number[]) {
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue), span = max - min;
  const sector = span === 0 ? 0 : max === red ? (green - blue) / span : max === green ? 2 + (blue - red) / span : 4 + (red - green) / span;
  return { hue: (sector * 60 + 360) % 360, saturation: max ? span / max : 0, brightness: max / 255 };
}

const colors = ["#000000", "#ffffff", "#64748b", "#1d5f94", "#ec4899", "#e11d48", "#eab308", "#22c55e"];

export function StaffPdfTextColor({
  label, value, onChange, disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = React.useState<string>();
  const [preferredHue, setPreferredHue] = React.useState(0);
  const rgb = colorChannels(value);
  const { hue: actualHue, saturation, brightness } = colorCoordinates(rgb);
  const hue = saturation ? actualHue : preferredHue;
  function selectColor(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const nextSaturation = clampColor((event.clientX - rect.left) / rect.width);
    const nextBrightness = 1 - clampColor((event.clientY - rect.top) / rect.height);
    onChange(hsvHex(hue, nextSaturation, nextBrightness));
  }
  return (
    <StaffPdfTextPopover label={label} className="border border-[#49576a] !bg-[#191f2a] hover:!bg-[#344255]"
      disabled={disabled} panelClass="w-64 max-w-[calc(100vw-16px)]" focusOnOpen="[data-hex]"
      trigger={<span className="h-4 w-5 rounded-sm border border-white/20" style={{ backgroundColor: value }} />}>
      {(close) => (
        <div className="grid min-w-0 gap-2">
          <div role="group" aria-label="Área de seleção da cor"
            className="relative h-28 w-full touch-none cursor-crosshair rounded border border-white/25"
            style={{ backgroundImage: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hue} 100% 50%))` }}
            onPointerDown={event => {
              event.currentTarget.setPointerCapture(event.pointerId);
              selectColor(event);
            }}
            onPointerMove={event => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) selectColor(event);
            }}>
            <span className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_2px_#000]"
              style={{ left: `${100 * saturation}%`, top: `${100 * (1 - brightness)}%` }} />
          </div>
          <label className="grid gap-1">Matiz
            <input aria-label="Matiz" className="w-full" type="range" min={0} max={359} value={hue}
              style={{ accentColor: `hsl(${hue} 100% 50%)` }}
              onChange={event => {
                const next = event.target.valueAsNumber;
                setPreferredHue(next);
                onChange(hsvHex(next, saturation || 1, brightness || 1));
              }} />
          </label>
          <label className="grid min-w-0 gap-1">
            {label} (HEX)
            <input data-hex type="text" autoComplete="off" spellCheck={false} maxLength={7} className={`${textField} min-w-0 w-full`}
              value={draft ?? value} onChange={(event) => {
                const next = event.target.value;
                setDraft(next);
                if (/^#[a-f0-9]{6}$/i.test(next)) onChange(next.toLowerCase());
              }} onBlur={() => setDraft(undefined)} />
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {["R", "G", "B"].map((channel, index) => (
              <label key={channel} className="grid min-w-0 gap-1">
                {channel}
                <input type="number" aria-label={`${label} (${channel})`} min={0} max={255}
                  className={`${textField} w-full min-w-0`} value={rgb[index]}
                  onChange={event => {
                    const next = event.target.valueAsNumber;
                    if (!Number.isInteger(next) || next < 0 || next > 255) return;
                    onChange("#" + rgb.map((value, i) => colorByte(i === index ? next : value)).join(""));
                  }} />
              </label>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {colors.map((color) => (
              <button key={color} type="button" aria-label={`Usar ${color}`} title={color}
                aria-pressed={value.toLowerCase() === color}
                className="h-7 rounded border border-white/25 hover:border-white aria-pressed:outline aria-pressed:outline-blue-300"
                style={{ backgroundColor: color }} onClick={() => {
                  onChange(color);
                  setDraft(undefined);
                  close();
                }} />
            ))}
          </div>
        </div>
      )}
    </StaffPdfTextPopover>
  );
}
