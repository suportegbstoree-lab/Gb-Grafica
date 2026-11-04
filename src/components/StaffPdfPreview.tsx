import React from "react";
import { staffPdfPreviewPage } from "../services/pdfPreview";
import {
  drawStaffPdfText,
  editedStaffPdfPage,
  prepareStaffPdfFonts,
} from "../services/staffPdfRender";
import type { StaffPdfLine } from "../lib/staffPdf";
import type { PersonalizationFont } from "../lib/textCustomization";
import {
  centeredInitialBox,
  type DecorativeInitial,
} from "../lib/decorativeInitial";
export default function StaffPdfPreview({
  original,
  pageCount,
  lines,
  fonts,
  selected,
  onMove,
  fitMargin = 0.2,
  initial,
}: {
  original: Blob;
  pageCount: number;
  lines: StaffPdfLine[];
  fonts: PersonalizationFont[];
  selected?: string;
  onMove?: (
    id: string,
    x: number,
    y: number,
    orientation: "portrait" | "landscape",
  ) => void;
  fitMargin?: number;
  initial?: DecorativeInitial;
}) {
  const [page, setPage] = React.useState(1),
    [error, setError] = React.useState(""),
    [loading, setLoading] = React.useState(false),
    [image, setImage] = React.useState<ImageBitmap | null>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null),
    dragging = React.useRef(false);
  const currentBitmap = React.useRef<ImageBitmap | null>(null);
  React.useEffect(() => {
    let active = true,
      bitmap: ImageBitmap | undefined;
    setLoading(true);
    setError("");
    void staffPdfPreviewPage(original, page)
      .then(createImageBitmap)
      .then((value) => {
        bitmap = value;
        if (active) {
          currentBitmap.current = value;
          setImage(value);
        } else value.close();
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (currentBitmap.current === bitmap) currentBitmap.current = null;
      bitmap?.close();
    };
  }, [original, page]);
  React.useEffect(() => {
    let active = true,
      release: (() => void) | undefined;
    const c = canvas.current;
    if (!c || !image || loading || currentBitmap.current !== image) return;
    setError("");
    void (async () => {
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(image, 0, 0);
      if (page === 1 && initial) {
        const bitmap = await createImageBitmap(initial.source as Blob);
        try {
          if (!active) return;
          const box = centeredInitialBox(
            c.width,
            c.height,
            bitmap.width,
            bitmap.height,
            initial.sizePercent,
          );
          ctx.drawImage(bitmap, box.x, box.y, box.width, box.height);
        } finally {
          bitmap.close();
        }
      }
      const orientation = editedStaffPdfPage(page - 1, pageCount);
      if (!orientation) return;
      const valid = lines.filter((l) =>
        fonts.some((f) => f.ativo && f.id === l.fontId),
      );
      release = await prepareStaffPdfFonts(valid, fonts);
      if (!active) {
        release();
        return;
      }
      drawStaffPdfText(
        ctx,
        c.width,
        c.height,
        valid,
        fonts,
        orientation,
        fitMargin,
      );
      const current = lines.find((l) => l.id === selected);
      if (current && onMove) {
        ctx.save();
        if (orientation === "landscape") {
          ctx.translate(c.width, 0);
          ctx.rotate(Math.PI / 2);
        }
        const b = current[orientation];
        ctx.strokeStyle = "#ec4899";
        ctx.lineWidth = Math.max(c.width / 400, 2);
        ctx.setLineDash([ctx.lineWidth * 3, ctx.lineWidth * 2]);
        ctx.strokeRect(b.x, b.y, b.width, b.height);
        ctx.restore();
      }
    })().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
      release?.();
    };
  }, [
    image,
    loading,
    lines,
    fonts,
    page,
    pageCount,
    selected,
    onMove,
    fitMargin,
    initial,
  ]);
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging.current || !selected || !onMove || !image) return;
    const line = lines.find((l) => l.id === selected),
      orientation = editedStaffPdfPage(page - 1, pageCount);
    if (!line || !orientation) return;
    const r = e.currentTarget.getBoundingClientRect(),
      px = ((e.clientX - r.left) / r.width) * image.width,
      py = ((e.clientY - r.top) / r.height) * image.height,
      b = line[orientation];
    const x = orientation === "portrait" ? px : py,
      y = orientation === "portrait" ? py : image.width - px,
      w = orientation === "portrait" ? image.width : image.height,
      h = orientation === "portrait" ? image.height : image.width;
    onMove(
      selected,
      Math.round(Math.max(0, Math.min(w - b.width, x - b.width / 2))),
      Math.round(Math.max(0, Math.min(h - b.height, y - b.height / 2))),
      orientation,
    );
  };
  return (
    <div className="min-w-0 space-y-3 rounded-xl bg-gray-950 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm">
          Página
          <select
            aria-label="Página da prévia interna"
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
            className="ml-2 rounded-lg border border-gray-700 bg-black p-2"
          >
            {Array.from({ length: pageCount }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
                {i === 0
                  ? " · Frente"
                  : pageCount === 4 && i === 2
                    ? " · Texto em paisagem"
                    : " · Original"}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-gray-400">
          Coordenadas em pixels · 300 DPI
        </span>
      </div>
      {loading && <p role="status">Carregando página...</p>}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <canvas
        ref={canvas}
        tabIndex={onMove ? 0 : undefined}
        aria-label="Prévia do PDF interno; arraste para mover a linha selecionada"
        className="mx-auto block max-h-[65vh] max-w-full touch-none"
        style={{ opacity: loading ? 0.3 : 1, width: "auto", height: "auto" }}
        onPointerDown={(e) => {
          if (!onMove) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={move}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onKeyDown={(e) => {
          if (!onMove || !selected) return;
          const o = editedStaffPdfPage(page - 1, pageCount),
            line = lines.find((l) => l.id === selected);
          if (
            !o ||
            !line ||
            !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
          )
            return;
          e.preventDefault();
          const step = e.shiftKey ? 50 : 5,
            b = line[o];
          onMove(
            selected,
            Math.max(
              0,
              b.x +
                (e.key === "ArrowRight"
                  ? step
                  : e.key === "ArrowLeft"
                    ? -step
                    : 0),
            ),
            Math.max(
              0,
              b.y +
                (e.key === "ArrowDown"
                  ? step
                  : e.key === "ArrowUp"
                    ? -step
                    : 0),
            ),
            o,
          );
        }}
      />
      <p className="text-xs text-gray-400">
        {onMove
          ? "Selecione uma linha e arraste na frente. As setas movem 5 px; Shift move 50 px. "
          : ""}
        Os versos e as demais páginas permanecem originais.
      </p>
    </div>
  );
}
