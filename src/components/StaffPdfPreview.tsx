import React from "react";
import { staffPdfPreviewPage } from "../services/pdfPreview";
import {
  drawStaffPdfText,
  editedStaffPdfPage,
  prepareStaffPdfFonts,
} from "../services/staffPdfRender";
import type { PdfTextBox, PdfTextLayout, StaffPdfLine } from "../lib/staffPdf";
import type { PersonalizationFont } from "../lib/textCustomization";
import {
  centeredInitialBox,
  type DecorativeInitial,
} from "../lib/decorativeInitial";

type ChangeBox = (
  id: string,
  x: number,
  y: number,
  orientation: PdfTextLayout,
) => void;
const control =
  "rounded border border-gray-700 px-2 py-1 text-sm disabled:opacity-40";

export default function StaffPdfPreview({
  original,
  pageCount,
  lines,
  fonts,
  selected,
  onSelect,
  onMove,
  onResize,
  onEdit,
  fitMargin = 0.2,
  initial,
}: {
  original: Blob;
  pageCount: number;
  lines: StaffPdfLine[];
  fonts: PersonalizationFont[];
  selected?: string;
  onSelect?: (id: string) => void;
  onMove?: ChangeBox;
  onResize?: ChangeBox;
  onEdit?: (id: string) => void;
  fitMargin?: number;
  initial?: DecorativeInitial;
}) {
  const [page, setPage] = React.useState(1);
  const pageNumber = Math.max(1, Math.min(page, pageCount));
  const orientation = editedStaffPdfPage(pageNumber - 1, pageCount);
  const [zoom, setZoom] = React.useState<number | null>(null);
  const [fit, setFit] = React.useState(0.24);
  const [asset, setAsset] = React.useState<{
    original: Blob;
    page: number;
    bitmap: ImageBitmap;
  }>();
  const image =
    asset?.original === original && asset.page === pageNumber
      ? asset.bitmap
      : undefined;
  const [letter, setLetter] = React.useState<{
    source: Blob;
    bitmap: ImageBitmap;
  }>();
  const [loadError, setLoadError] = React.useState("");
  const [drawError, setDrawError] = React.useState("");
  const [fontError, setFontError] = React.useState("");
  const [readyFonts, setReadyFonts] = React.useState("");
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const viewport = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef<{
    id: string;
    x: number;
    y: number;
    resize: boolean;
  } | null>(null);

  React.useEffect(() => {
    let active = true,
      bitmap: ImageBitmap | undefined;
    setLoadError("");
    void staffPdfPreviewPage(original, pageNumber)
      .then(createImageBitmap)
      .then((result) => {
        bitmap = result;
        if (active) setAsset({ original, page: pageNumber, bitmap });
        else bitmap.close();
      })
      .catch((e) => {
        if (active) setLoadError(e.message);
      });
    return () => {
      active = false;
      bitmap?.close();
    };
  }, [original, pageNumber]);

  const letterSource =
    pageNumber === 1 ? (initial?.source as Blob | undefined) : undefined;
  React.useEffect(() => {
    if (!letterSource) return;
    let active = true,
      bitmap: ImageBitmap | undefined;
    void createImageBitmap(letterSource)
      .then((result) => {
        bitmap = result;
        if (active) setLetter({ source: letterSource, bitmap });
        else bitmap.close();
      })
      .catch(() => {
        if (active) setLetter(undefined);
      });
    return () => {
      active = false;
      bitmap?.close();
    };
  }, [letterSource]);

  const fontIds = JSON.stringify(
    [...new Set(lines.map((line) => line.fontId))].sort(),
  );
  React.useEffect(() => {
    let active = true,
      release: (() => void) | undefined;
    setReadyFonts("");
    setFontError("");
    const used = (JSON.parse(fontIds) as string[]).filter((id) =>
      fonts.some((font) => font.ativo && font.id === id),
    );
    void prepareStaffPdfFonts(
      used.map((fontId) => ({ fontId })),
      fonts,
    )
      .then((cleanup) => {
        release = cleanup;
        if (active) setReadyFonts(fontIds);
        else cleanup();
      })
      .catch((e) => {
        if (active) setFontError(e.message);
      });
    return () => {
      active = false;
      release?.();
    };
  }, [fontIds, fonts]);

  React.useEffect(() => {
    const frame = viewport.current;
    if (!frame || !image) return;
    const resize = () =>
      setFit(
        Math.max(
          0.01,
          Math.min(
            (frame.clientWidth - 24) / image.width,
            (frame.clientHeight - 24) / image.height,
          ),
        ),
      );
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [image]);

  React.useEffect(() => {
    const c = canvas.current,
      ctx = c?.getContext("2d");
    if (!c || !ctx || !image) return;
    setDrawError("");
    c.width = image.width;
    c.height = image.height;
    ctx.drawImage(image, 0, 0);
    if (letterSource && letter?.source === letterSource && initial) {
      const box = centeredInitialBox(
        c.width,
        c.height,
        letter.bitmap.width,
        letter.bitmap.height,
        initial.sizePercent,
      );
      ctx.drawImage(letter.bitmap, box.x, box.y, box.width, box.height);
    }
    if (!orientation || readyFonts !== fontIds) return;
    const valid = lines.filter((line) =>
      fonts.some((font) => font.ativo && font.id === line.fontId),
    );
    try {
      drawStaffPdfText(
        ctx,
        c.width,
        c.height,
        valid,
        fonts,
        orientation,
        fitMargin,
      );
    } catch (e) {
      ctx.resetTransform();
      setDrawError((e as Error).message);
    }
    const current = lines.find((line) => line.id === selected);
    if (current && onMove) {
      ctx.save();
      if (orientation === "landscape") {
        ctx.translate(c.width, 0);
        ctx.rotate(Math.PI / 2);
      }
      const box = current[orientation];
      ctx.strokeStyle = "#ec4899";
      ctx.lineWidth = Math.max(c.width / 400, 2);
      ctx.setLineDash([ctx.lineWidth * 3, ctx.lineWidth * 2]);
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      if (onResize) {
        const size = ctx.lineWidth * 5;
        ctx.fillStyle = "#ec4899";
        ctx.fillRect(
          box.x + box.width - size / 2,
          box.y + box.height - size / 2,
          size,
          size,
        );
      }
      ctx.restore();
    }
  }, [
    image,
    lines,
    fonts,
    selected,
    orientation,
    onMove,
    onResize,
    fitMargin,
    letter,
    letterSource,
    initial,
    readyFonts,
    fontIds,
  ]);

  const point = (
    event: { clientX: number; clientY: number },
    target: HTMLCanvasElement,
  ) => {
    if (!image || !orientation) return;
    const r = target.getBoundingClientRect();
    const px = ((event.clientX - r.left) / r.width) * image.width;
    const py = ((event.clientY - r.top) / r.height) * image.height;
    return orientation === "portrait"
      ? { x: px, y: py, w: image.width, h: image.height }
      : { x: py, y: image.width - px, w: image.height, h: image.width };
  };
  const hit = ({ x, y }: { x: number; y: number }, box: PdfTextBox) =>
    x >= box.x &&
    x <= box.x + box.width &&
    y >= box.y &&
    y <= box.y + box.height;
  const lineAt = (p: { x: number; y: number }, o: PdfTextLayout) =>
    [...lines]
      .reverse()
      .find((line) => (line.text || line.id === selected) && hit(p, line[o]));
  const move = (line: StaffPdfLine, x: number, y: number, o: PdfTextLayout) => {
    if (!image) return;
    const box = line[o];
    const [width, height] =
      o === "portrait"
        ? [image.width, image.height]
        : [image.height, image.width];
    onMove?.(
      line.id,
      Math.round(Math.max(0, Math.min(width - box.width, x))),
      Math.round(Math.max(0, Math.min(height - box.height, y))),
      o,
    );
  };
  const scale = zoom === null ? fit : (zoom * 72) / 300;
  const percent =
    zoom === null
      ? Math.round(((fit * 300) / 72) * 100)
      : Math.round(zoom * 100);
  const adjustZoom = (factor: number) =>
    setZoom(Math.min(4, Math.max(0.1, ((scale * 300) / 72) * factor)));
  const error = loadError || fontError || drawError;

  return (
    <div className="min-w-0 space-y-2 rounded-xl bg-gray-950 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Página anterior"
            className={control}
            disabled={pageNumber <= 1}
            onClick={() => setPage(pageNumber - 1)}
          >
            ‹
          </button>
          <select
            aria-label="Página da prévia interna"
            value={pageNumber}
            onChange={(e) => setPage(Number(e.target.value))}
            className={`${control} bg-black`}
          >
            {Array.from({ length: pageCount }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
                {i === 0
                  ? " · Frente"
                  : pageCount === 4 && i === 2
                    ? " · Paisagem"
                    : " · Original"}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Próxima página"
            className={control}
            disabled={pageNumber >= pageCount}
            onClick={() => setPage(pageNumber + 1)}
          >
            ›
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Diminuir zoom"
            className={control}
            onClick={() => adjustZoom(0.8)}
            disabled={!image || percent <= 10}
          >
            −
          </button>
          <button
            type="button"
            className={control}
            onClick={() => setZoom(null)}
            aria-pressed={zoom === null}
          >
            Ajustar
          </button>
          <button
            type="button"
            aria-label="Aumentar zoom"
            className={control}
            onClick={() => adjustZoom(1.25)}
            disabled={!image || percent >= 400}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Restaurar zoom para 100%"
            className={control}
            onClick={() => setZoom(1)}
          >
            100%
          </button>
          <output
            role="meter"
            aria-label="Zoom atual"
            aria-valuemin={0}
            aria-valuemax={400}
            aria-valuenow={percent}
            className="ml-1 text-xs text-gray-400"
          >
            {percent}%
          </output>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <div
        ref={viewport}
        className="h-[clamp(16rem,58vh,48rem)] overflow-auto rounded-lg border border-gray-800 bg-[#17191f] p-3"
      >
        {!image && !loadError && (
          <p role="status" className="p-4 text-sm">
            Carregando página...
          </p>
        )}
        <canvas
          ref={canvas}
          hidden={!image}
          tabIndex={onMove && orientation ? 0 : undefined}
          aria-label="Prévia do PDF interno"
          className={`${!image ? "hidden" : "mx-auto block bg-white shadow-lg"} ${onMove && orientation ? "cursor-crosshair touch-none" : ""}`}
          style={{
            width: image ? image.width * scale : 0,
            height: image ? image.height * scale : 0,
          }}
          onPointerDown={(e) => {
            if (!onMove || !orientation || e.button !== 0) return;
            const p = point(e, e.currentTarget);
            if (!p) return;
            const current = lines.find((line) => line.id === selected);
            const box = current?.[orientation];
            const radius = 10 / scale;
            const resize = Boolean(
              onResize &&
                box &&
                Math.abs(p.x - box.x - box.width) < radius &&
                Math.abs(p.y - box.y - box.height) < radius,
            );
            const line = resize ? current : lineAt(p, orientation);
            if (!line) return;
            onSelect?.(line.id);
            const b = line[orientation];
            dragging.current = {
              id: line.id,
              x: p.x - b.x,
              y: p.y - b.y,
              resize,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!dragging.current || !orientation) return;
            const drag = dragging.current;
            const p = point(e, e.currentTarget);
            const line = lines.find((l) => l.id === drag.id);
            if (!p || !line) return;
            const box = line[orientation];
            if (drag.resize)
              onResize?.(
                line.id,
                Math.round(Math.max(1, Math.min(p.w - box.x, p.x - box.x))),
                Math.round(Math.max(1, Math.min(p.h - box.y, p.y - box.y))),
                orientation,
              );
            else move(line, p.x - drag.x, p.y - drag.y, orientation);
          }}
          onLostPointerCapture={() => {
            dragging.current = null;
          }}
          onDoubleClick={(e) => {
            if (!orientation) return;
            const p = point(e, e.currentTarget);
            const line = p && lineAt(p, orientation);
            if (line) onEdit?.(line.id);
          }}
          onKeyDown={(e) => {
            if (!orientation || !selected) return;
            if (e.key === "Enter" && onEdit) {
              e.preventDefault();
              onEdit(selected);
              return;
            }
            const offsets: Record<string, [number, number]> = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            };
            const offset = offsets[e.key],
              line = lines.find((l) => l.id === selected);
            if (!offset || !line) return;
            e.preventDefault();
            const step = e.shiftKey ? 50 : 5,
              box = line[orientation];
            const [x, y] =
              orientation === "portrait" ? offset : [offset[1], -offset[0]];
            move(line, box.x + x * step, box.y + y * step, orientation);
          }}
        />
      </div>
      <p className="text-xs text-gray-400">
        {orientation && onResize
          ? "Arraste a caixa ou use a alça para redimensionar."
          : orientation && onMove
            ? "Arraste uma caixa para movê-la. Use as setas para ajustar em 5 px."
            : "Visualização da página original."}
        {orientation && onEdit ? " Dê dois cliques na caixa para editar." : ""}
      </p>
    </div>
  );
}
