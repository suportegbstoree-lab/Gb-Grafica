import { DEFAULT_STAFF_PDF_COMPOUND_MARKER, type StaffPdfCompoundMarker } from "../lib/staffPdfCompound";
import { STAFF_PDF_MARKETPLACE_LABELS, type StaffPdfMarketplace } from "../lib/staffPdfMarketplace";
import { staffBarcodeCanvas } from "./staffPdfBarcode";
import { staffBarcodeBoxes } from "../lib/staffPdfBarcode";
import { PDFDocument, degrees, rgb, StandardFonts, type PDFPage } from "pdf-lib";
import {
  DEFAULT_PDF_TEXT_EFFECTS,
  staffPdfFont,
  STAFF_PDF_DPI,
  STAFF_PDF_MAX_PAGES,
  type StaffPdfLine,
  type PdfTextBox,
  type StaffPdfJob,
  type PdfTextLayout,
} from "../lib/staffPdf";
import type { PersonalizationFont } from "../lib/textCustomization";
import {
  centeredInitialBox,
  type DecorativeInitial,
} from "../lib/decorativeInitial";

export async function prepareStaffPdfFonts(
  lines: Pick<StaffPdfLine, "fontId">[],
  fonts: PersonalizationFont[],
) {
  const faces: FontFace[] = [];
  try {
    for (const id of new Set(lines.map((line) => line.fontId))) {
      const font = staffPdfFont(id, fonts);
      if (!font)
        throw new Error("Escolha uma fonte cadastrada para cada linha.");
      if (font.arquivoUrl) {
        const face = await new FontFace(
          font.cssFamily,
          `url(${JSON.stringify(font.arquivoUrl)})`,
        ).load();
        document.fonts.add(face);
        faces.push(face);
      }
      await document.fonts.load(`32px ${font.cssFamily}`);
    }
  } catch (e) {
    faces.forEach((face) => document.fonts.delete(face));
    throw new Error(
      "Uma fonte não pôde ser carregada. Confira o cadastro de fontes.",
    );
  }
  return () => faces.forEach((face) => document.fonts.delete(face));
}
type TextRun = {
  text: string;
  x: number;
  y: number;
  angle: number;
  offsetX: number;
};

function rotatedTextBounds(context: CanvasRenderingContext2D, runs: TextRun[], radians: number) {
  const cos = Math.cos(radians), sin = Math.sin(radians);
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const run of runs) {
    const { actualBoundingBoxLeft, actualBoundingBoxRight, actualBoundingBoxAscent, actualBoundingBoxDescent } =
      context.measureText(run.text);
    const width = actualBoundingBoxRight + actualBoundingBoxLeft;
    const height = actualBoundingBoxAscent + actualBoundingBoxDescent;
    if (!width || !height) continue;
    const angle = radians + run.angle;
    const glyphCos = Math.cos(angle), glyphSin = Math.sin(angle);
    const localX = run.offsetX + (actualBoundingBoxRight - actualBoundingBoxLeft) / 2;
    const localY = (actualBoundingBoxDescent - actualBoundingBoxAscent) / 2;
    const x = run.x * cos - run.y * sin + localX * glyphCos - localY * glyphSin;
    const y = run.x * sin + run.y * cos + localX * glyphSin + localY * glyphCos;
    const halfWidth = (Math.abs(glyphCos) * width + Math.abs(glyphSin) * height) / 2;
    const halfHeight = (Math.abs(glyphSin) * width + Math.abs(glyphCos) * height) / 2;
    left = Math.min(left, x - halfWidth);
    right = Math.max(right, x + halfWidth);
    top = Math.min(top, y - halfHeight);
    bottom = Math.max(bottom, y + halfHeight);
  }
  return Number.isFinite(left) ? { left, right, top, bottom } : undefined;
}

function drawFormattedLine(
  context: CanvasRenderingContext2D,
  line: StaffPdfLine,
  anchor: PdfTextBox,
  family: string,
  fitMargin: number,
  pageWidth: number,
  pageHeight: number,
) {
  const effects = line.effects ?? DEFAULT_PDF_TEXT_EFFECTS;
  const size = line.fontSize;
  context.font = `${effects.bold ? "bold " : ""}${size}px ${family}`;
  context.fillStyle = line.color;
  context.strokeStyle = effects.outlineColor;
  context.lineWidth = effects.outlineWidth * 2;
  context.lineJoin = "round";
  context.globalAlpha = effects.opacity / 100;
  context.textBaseline = "alphabetic";
  context.textAlign = "left";
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const gap = (size * effects.letterSpacing) / 200;
  const glyphs = (text: string) =>
    Array.from(segmenter.segment(text), ({ segment }) => segment);
  const widthOf = (text: string) =>
    context.measureText(text).width +
    Math.max(0, glyphs(text).length - 1) * gap;
  const dynamic = line.kind === "extra" && !line.fitBox;
  const blurMargin = Math.max(
    effects.glow ? effects.glow.intensity * 2 : 0,
    effects.shadow
      ? Math.max(Math.abs(effects.shadow.x), Math.abs(effects.shadow.y)) +
          effects.shadow.blur * 2
      : 0,
  );
  const padding = blurMargin + (effects.outline ? effects.outlineWidth : 0);
  const bend = (size * effects.curve) / 100;
  const maxWidth = dynamic
    ? Math.max(1, pageWidth - padding * 2 - (bend ? size : size * 0.15))
    : anchor.width * (1 - fitMargin);
  const rows = line.text.split("\n").flatMap((paragraph) => {
    const result: string[] = [];
    let text = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = text ? `${text} ${word}` : word;
      if (text && widthOf(candidate) > maxWidth) {
        result.push(text);
        text = word;
      } else text = candidate;
      if (dynamic && widthOf(text) > maxWidth) {
        let part = "";
        for (const glyph of glyphs(text)) {
          if (part && widthOf(part + glyph) > maxWidth) {
            result.push(part);
            part = glyph;
          } else part += glyph;
        }
        text = part;
      }
    }
    return [...result, text];
  });
  const metrics = context.measureText("Ájg");
  const ascent = metrics.actualBoundingBoxAscent || size * 0.8;
  const descent = metrics.actualBoundingBoxDescent || size * 0.2;
  const pitch = size * effects.lineSpacing;
  const widths = rows.map(widthOf);
  const textWidth = Math.max(1, ...widths);
  const height = ascent + descent + Math.abs(bend) + (rows.length - 1) * pitch;
  const width = textWidth + padding * 2 + (bend ? size : size * 0.15);
  const radians = (line.rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians)),
    cos = Math.abs(Math.cos(radians));
  const outerHeight = height + padding * 2 + (bend ? size : 0);
  const rotatedWidth = width * cos + outerHeight * sin;
  const rotatedHeight = width * sin + outerHeight * cos;
  const runs = rows.flatMap((text, index): TextRun[] => {
    const rowWidth = widths[index];
    const left =
      line.align === "left"
        ? -textWidth / 2
        : line.align === "right"
          ? textWidth / 2 - rowWidth
          : -rowWidth / 2;
    const baseline = -height / 2 + ascent + Math.max(0, -bend) + index * pitch;
    if (!gap && !bend) return [{ text, x: left, y: baseline, angle: 0, offsetX: 0 }];
    let prefix = "";
    return glyphs(text).map((glyph, i) => {
      const offset = context.measureText(prefix).width + gap * i;
      const glyphWidth = context.measureText(glyph).width;
      const middle = offset + glyphWidth / 2;
      const relative = rowWidth > 0 ? (2 * middle) / rowWidth - 1 : 0;
      prefix += glyph;
      return {
        text: glyph,
        x: left + middle,
        y: baseline + bend * relative * relative,
        angle: bend && rowWidth > 0 ? Math.atan((4 * bend * relative) / rowWidth) : 0,
        offsetX: -glyphWidth / 2,
      };
    });
  });
  const centerInBox = line.align === "center" && !dynamic;
  const bounds = centerInBox ? rotatedTextBounds(context, runs, radians) : undefined;
  const fitWidth = bounds ? Math.max(rotatedWidth, bounds.right - bounds.left + padding * 2) : rotatedWidth;
  const fitHeight = bounds ? Math.max(rotatedHeight, bounds.bottom - bounds.top + padding * 2) : rotatedHeight;
  const scale = Math.min(
    1,
    (dynamic ? pageWidth : maxWidth) / fitWidth,
    (dynamic ? pageHeight : anchor.height * (1 - fitMargin)) / fitHeight,
  );
  const inkWidth = rotatedWidth * scale;
  const inkHeight = rotatedHeight * scale;
  const box = dynamic
    ? {
        x: Math.max(0, Math.min(pageWidth - inkWidth, anchor.x)),
        y: Math.max(0, Math.min(pageHeight - inkHeight, anchor.y)),
        width: inkWidth,
        height: inkHeight,
      }
    : anchor;
  if (dynamic) context.translate(box.x, box.y);
  const centerX =
    line.align === "left"
      ? inkWidth / 2
      : line.align === "right"
        ? box.width - inkWidth / 2
        : box.width / 2;
  const centerY = centerInBox ? box.height / 2 : inkHeight / 2;
  context.translate(
    centerX - (bounds ? (bounds.left + bounds.right) * scale / 2 : 0),
    centerY - (bounds ? (bounds.top + bounds.bottom) * scale / 2 : 0),
  );
  context.rotate(radians);
  context.scale(scale, scale);
  function paint(text: string, x: number, y: number) {
    for (const layer of [
      effects.glow && {
        x: 0,
        y: 0,
        blur: effects.glow.intensity,
        color: effects.glow.color,
      },
      effects.shadow,
    ]) {
      if (!layer) continue;
      const transform = context.getTransform();
      context.save();
      // Canvas shadow offsets are device-space. Shift the source outside the
      // clip and bring only the shadow back, preserving fill opacity.
      const distance = pageWidth + pageHeight + 1000;
      context.shadowOffsetX =
        transform.a * layer.x + transform.c * layer.y + distance;
      context.shadowOffsetY = transform.b * layer.x + transform.d * layer.y;
      context.shadowBlur = layer.blur * scale;
      context.shadowColor = layer.color;
      context.translate(
        (-distance * transform.a) / (scale * scale),
        (-distance * transform.c) / (scale * scale),
      );
      context.fillText(text, x, y);
      context.restore();
    }
    if (effects.outline) {
      context.save();
      context.globalAlpha *= (effects.outlineOpacity ?? 100) / 100;
      context.strokeText(text, x, y);
      context.restore();
    }
    context.fillText(text, x, y);
  }
  for (const { text, x, y, angle, offsetX } of runs) {
    if (!angle) {
      paint(text, x + offsetX, y);
      continue;
    }
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    paint(text, offsetX, 0);
    context.restore();
  }
  return box;
}

/** One shared renderer drives previews and final 300-DPI transparent overlays. */
export function drawStaffPdfText(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  lines: StaffPdfLine[],
  fonts: PersonalizationFont[],
  orientation: PdfTextLayout,
  fitMargin = 0.2,
) {
  const boxes = new Map<string, PdfTextBox>();
  const landscape = orientation === "landscape";
  const canvasWidth = landscape ? height : width,
    canvasHeight = landscape ? width : height;
  for (const line of lines) {
    if (!line.text) continue;
    const box = line[orientation];
    if (
      line.kind !== "extra" &&
      (box.x + box.width > canvasWidth + 1 ||
        box.y + box.height > canvasHeight + 1)
    )
      throw new Error(
        "A caixa de texto está fora da página. Ajuste a geometria.",
      );
    if (!staffPdfFont(line.fontId, fonts))
      throw new Error("Fonte não encontrada.");
  }
  context.save();
  context.beginPath();
  context.rect(0, 0, width, height);
  context.clip();
  if (landscape) {
    context.translate(width, 0);
    context.rotate(Math.PI / 2);
  }
  for (const line of lines) {
    if (!line.text) continue;
    const box = line[orientation],
      font = staffPdfFont(line.fontId, fonts)!;
    context.save();
    if (line.kind === "extra" && !line.fitBox) {
      boxes.set(
        line.id,
        drawFormattedLine(
          context,
          line,
          box,
          font.cssFamily,
          0,
          canvasWidth,
          canvasHeight,
        ),
      );
      context.restore();
      continue;
    }
    boxes.set(line.id, box);
    context.translate(box.x, box.y);
    context.beginPath();
    context.rect(0, 0, box.width, box.height);
    context.clip();
    if (line.effects || line.text.includes("\n")) {
      drawFormattedLine(
        context,
        line,
        box,
        font.cssFamily,
        fitMargin,
        canvasWidth,
        canvasHeight,
      );
      context.restore();
      continue;
    }
    context.font = `${line.fontSize}px ${font.cssFamily}`;
    const centered = line.align === "center";
    context.textAlign = centered ? "left" : "center";
    context.textBaseline = "alphabetic";
    const measured = context.measureText(line.text);
    const ascent = centered ? measured.actualBoundingBoxAscent
      : measured.actualBoundingBoxAscent || line.fontSize * 0.8;
    const descent = centered ? measured.actualBoundingBoxDescent
      : measured.actualBoundingBoxDescent || line.fontSize * 0.2;
    const measuredHeight = ascent + descent;
    const measuredWidth = centered
      ? measured.actualBoundingBoxLeft + measured.actualBoundingBoxRight
      : measured.width;
    const radians = (line.rotation * Math.PI) / 180,
      absCos = Math.abs(Math.cos(radians)),
      absSin = Math.abs(Math.sin(radians));
    const rotatedWidth = measuredWidth * absCos + measuredHeight * absSin,
      rotatedHeight = measuredWidth * absSin + measuredHeight * absCos;
    const scale = Math.min(
      1,
      (box.width * (1 - fitMargin)) / Math.max(1, rotatedWidth),
      (box.height * (1 - fitMargin)) / Math.max(1, rotatedHeight),
    );
    const inkWidth = rotatedWidth * scale,
      inkHeight = rotatedHeight * scale;
    const centerX =
      line.align === "left"
        ? inkWidth / 2
        : line.align === "right"
          ? box.width - inkWidth / 2
          : box.width / 2;
    context.translate(centerX, centered ? box.height / 2 : inkHeight / 2);
    context.rotate(radians);
    context.scale(scale, scale);
    context.fillStyle = line.color;
    context.fillText(
      line.text,
      centered ? (measured.actualBoundingBoxLeft - measured.actualBoundingBoxRight) / 2 : 0,
      (ascent - descent) / 2,
    );
    context.restore();
  }
  context.restore();
  return boxes;
}
export function editedStaffPdfPage(
  pageIndex: number,
  pageCount: number,
): PdfTextLayout | null {
  return pageIndex === 0
    ? "portrait"
    : pageCount === 4 && pageIndex === 2
      ? "landscape"
      : null;
}
/** Center and clip a customer image to the front page; share placement with the customer preview. */
export function drawStaffPdfImage(context:CanvasRenderingContext2D,width:number,height:number,source:CanvasImageSource,imageWidth:number,imageHeight:number,fullPage:boolean) {
  const ratio=(fullPage?Math.max:Math.min)(width/imageWidth,height/imageHeight);
  const w=imageWidth*ratio,h=imageHeight*ratio;
  context.save();context.beginPath();context.rect(0,0,width,height);context.clip();context.drawImage(source,(width-w)/2,(height-h)/2,w,h);context.restore();
}

function textOverlayRegion(
  width: number,
  height: number,
  lines: StaffPdfLine[],
  orientation: PdfTextLayout,
): PdfTextBox {
  const visible = lines.filter((line) => line.text);
  if (!visible.length) return { x: 0, y: 0, width: 1, height: 1 };
  // The renderer clips the main text and its effects to the template box.
  // Extra lines can extend beyond their anchors and still need the full page.
  if (visible.length === 1 && visible[0].kind !== "extra") {
    const box = visible[0][orientation];
    const landscape = orientation === "landscape";
    const x = landscape ? width - box.y - box.height : box.x;
    const y = landscape ? box.x : box.y;
    const left = Math.max(0, Math.floor(x) - 1);
    const top = Math.max(0, Math.floor(y) - 1);
    const right = Math.min(width, Math.ceil(x + (landscape ? box.height : box.width)) + 1);
    const bottom = Math.min(height, Math.ceil(y + (landscape ? box.width : box.height)) + 1);
    if (right > left && bottom > top)
      return { x: left, y: top, width: right - left, height: bottom - top };
  }
  return { x: 0, y: 0, width, height };
}

export async function drawStaffPdfCompoundMarker(
  pdf: PDFDocument, page: PDFPage, barcode: string | undefined, marker: StaffPdfCompoundMarker,
  marketplace?: StaffPdfMarketplace,
) {
  const text = [
    marketplace && STAFF_PDF_MARKETPLACE_LABELS[marketplace],
    barcode && `pedido composto ${barcode}`,
  ].filter(Boolean).join(" - ");
  if (!text) return;
  const font = await pdf.embedFont(marker.font === "courier" ? StandardFonts.Courier : StandardFonts.Helvetica);
  const crop = page.getCropBox();
  const { width, height } = crop;
  const vertical = marker.angle === 90 || marker.angle === 270;
  const available = (vertical ? height : width) - 4;
  const size = Math.min(marker.size, available / font.widthOfTextAtSize(text, 1));
  if (size <= 0) return;
  const halfWidth = font.widthOfTextAtSize(text, size) / 2;
  const halfHeight = font.heightAtSize(size, { descender: false }) / 2;
  const limit = (center: number, extent: number, boundary: number) =>
    Math.max(extent + 2, Math.min(boundary - extent - 2, center));
  const cx = limit(width * marker.x / 100, vertical ? halfHeight : halfWidth, width);
  const cy = limit(height * (1 - marker.y / 100), vertical ? halfWidth : halfHeight, height);
  const [cos, sin] = [[1, 0], [0, -1], [-1, 0], [0, 1]][marker.angle / 90];
  const [red, green, blue] = [1, 3, 5].map(offset => Number.parseInt(marker.color.slice(offset, offset + 2), 16) / 255);
  page.drawText(text, {
    x: crop.x + cx - cos * halfWidth + sin * halfHeight,
    y: crop.y + cy - sin * halfWidth - cos * halfHeight,
    size, font, color: rgb(red, green, blue), rotate: degrees(-marker.angle),
  });
}

export async function addStaffPdfSourcePage(pdf: PDFDocument, source: PDFPage) {
  const crop = source.getCropBox();
  const angle = ((source.getRotation().angle % 360) + 360) % 360;
  const rotated = angle === 90 || angle === 270;
  if (![0, 90, 180, 270].includes(angle))
    throw new Error("Rotação inválida.");
  const width = rotated ? crop.height : crop.width;
  const height = rotated ? crop.width : crop.height;
  const page = pdf.addPage([width, height]);
  if (source.node.Contents()) {
    const embedded = await pdf.embedPage(source, {
      left: crop.x,
      bottom: crop.y,
      right: crop.x + crop.width,
      top: crop.y + crop.height,
    });
    page.drawPage(embedded, {
      x: angle === 180 || angle === 270 ? width : 0,
      y: angle === 90 || angle === 180 ? height : 0,
      width: crop.width,
      height: crop.height,
      rotate: degrees(-angle),
    });
  }
  return page;
}

export async function exportStaffPdf(
  original: Blob,
  job: StaffPdfJob,
  fonts: PersonalizationFont[],
  fitMargin = 0.2,
  initial?: DecorativeInitial,
  customerImage?: Blob,
  fullPage = false,
) {
  const source = await PDFDocument.load(await original.arrayBuffer(), {
      updateMetadata: false,
    }),
    pdf = await PDFDocument.create();
  if (source.getPageCount() < 1 || source.getPageCount() > STAFF_PDF_MAX_PAGES)
    throw new Error("Quantidade de páginas não suportada.");
  const release = await prepareStaffPdfFonts(job.lines, fonts);
  let barcode: Awaited<ReturnType<typeof pdf.embedPng>>;
  try {
    if (job.barcode) {
      const canvas = await staffBarcodeCanvas(
        job.barcode,
        job.barcodeVersion ?? 1,
        job.barcodeSize,
      );
      try {
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (result) =>
              result
                ? resolve(result)
                : reject(new Error("Falha ao gerar o código de barras.")),
            "image/png",
          ),
        );
        barcode = await pdf.embedPng(await blob.arrayBuffer());
      } finally {
        canvas.width = canvas.height = 1;
      }
    }
    for (const [index, p] of source.getPages().entries()) {
      const sheet = await addStaffPdfSourcePage(pdf, p);
      const { width, height } = sheet.getSize();
      if(index===0 && customerImage) {
        const decoded=await (await import('./personalizationModelService')).decodePersonalizationSource(customerImage);
        const canvas=document.createElement('canvas');
        canvas.width=Math.ceil(width*STAFF_PDF_DPI/72);canvas.height=Math.ceil(height*STAFF_PDF_DPI/72);
        if(canvas.width*canvas.height>64_000_000 || Math.max(canvas.width,canvas.height)>32767){decoded.dispose();throw new Error('Página excede a capacidade de edição a 300 DPI.');}
        try {const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas indisponível.');drawStaffPdfImage(ctx,canvas.width,canvas.height,decoded.source,decoded.width,decoded.height,fullPage);
          const blob=await (await import('./personalizationModelService')).personalizationCanvasBlob(canvas,'image/png');
          sheet.drawImage(await pdf.embedPng(await blob.arrayBuffer()),{x:0,y:0,width,height});
        } finally{decoded.dispose();canvas.width=canvas.height=1;}
      }
      if (index === 0 && initial) {
        const blob = initial.source as Blob,
          letter = await pdf.embedPng(await blob.arrayBuffer());
        sheet.drawImage(
          letter,
          centeredInitialBox(
            width,
            height,
            letter.width,
            letter.height,
            initial.sizePercent,
          ),
        );
      }
      const orientation = editedStaffPdfPage(index, source.getPageCount());
      if (orientation) {
        const pixelWidth = Math.ceil((width * STAFF_PDF_DPI) / 72);
        const pixelHeight = Math.ceil((height * STAFF_PDF_DPI) / 72);
        if (
          pixelWidth * pixelHeight > 64_000_000 ||
          Math.max(pixelWidth, pixelHeight) > 32767
        )
          throw new Error("Página excede a capacidade de edição a 300 DPI.");
        const region = textOverlayRegion(pixelWidth, pixelHeight, job.lines, orientation);
        const canvas = document.createElement("canvas");
        canvas.width = region.width;
        canvas.height = region.height;
        try {
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas indisponível.");
          context.translate(-region.x, -region.y);
          drawStaffPdfText(
            context,
            pixelWidth,
            pixelHeight,
            job.lines,
            fonts,
            orientation,
            fitMargin,
          );
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (value) =>
                value
                  ? resolve(value)
                  : reject(new Error("Falha ao compor texto.")),
              "image/png",
            ),
          );
          sheet.drawImage(await pdf.embedPng(await blob.arrayBuffer()), {
            x: width * region.x / pixelWidth,
            y: height * (pixelHeight - region.y - region.height) / pixelHeight,
            width: width * region.width / pixelWidth,
            height: height * region.height / pixelHeight,
          });
        } finally {
          canvas.width = canvas.height = 1;
        }
      }
      if (orientation && barcode)
        for (const box of staffBarcodeBoxes(
          width,
          height,
          job.barcode,
          job.barcodeVersion ?? 1,
          job.barcodeSize,
        ))
          sheet.drawImage(barcode, box);
      if (index === 0 && (job.marketplace || job.compoundMarker)) {
        const marker = job.compoundMarker ?? job.marketplaceMarker ?? DEFAULT_STAFF_PDF_COMPOUND_MARKER;
        await drawStaffPdfCompoundMarker(pdf, sheet, job.compoundMarker ? job.barcode : undefined, marker, job.marketplace);
      }
    }
    return new Blob([new Uint8Array(await pdf.save())], {
      type: "application/pdf",
    });
  } finally {
    release();
  }
}
