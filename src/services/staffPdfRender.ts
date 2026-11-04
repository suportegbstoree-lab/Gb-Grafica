import { PDFDocument, degrees } from "pdf-lib";
import {
  STAFF_PDF_DPI,
  STAFF_PDF_MAX_PAGES,
  type StaffPdfLine,
  type StaffPdfJob,
  type PdfTextLayout,
} from "../lib/staffPdf";
import type { PersonalizationFont } from "../lib/textCustomization";
import {
  centeredInitialBox,
  type DecorativeInitial,
} from "../lib/decorativeInitial";

export async function prepareStaffPdfFonts(
  lines: StaffPdfLine[],
  fonts: PersonalizationFont[],
) {
  const faces: FontFace[] = [];
  try {
    for (const id of new Set(lines.map((line) => line.fontId))) {
      const font = fonts.find((f) => f.id === id && f.ativo);
      if (!font) throw new Error("Escolha uma fonte ativa para cada linha.");
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
  context.save();
  context.beginPath();
  context.rect(0, 0, width, height);
  context.clip();
  const landscape = orientation === "landscape";
  if (landscape) {
    context.translate(width, 0);
    context.rotate(Math.PI / 2);
  }
  const canvasWidth = landscape ? height : width,
    canvasHeight = landscape ? width : height;
  for (const line of lines) {
    if (!line.text) continue;
    const box = line[orientation],
      font = fonts.find((f) => f.id === line.fontId && f.ativo);
    if (!font) throw new Error("Fonte não encontrada.");
    if (
      box.x + box.width > canvasWidth + 1 ||
      box.y + box.height > canvasHeight + 1
    )
      throw new Error(
        "A caixa de texto está fora da página. Ajuste a geometria.",
      );
    context.save();
    context.translate(box.x, box.y);
    context.beginPath();
    context.rect(0, 0, box.width, box.height);
    context.clip();
    context.font = `${line.fontSize}px ${font.cssFamily}`;
    const measured = context.measureText(line.text);
    const measuredHeight =
      (measured.actualBoundingBoxAscent || line.fontSize * 0.8) +
      (measured.actualBoundingBoxDescent || line.fontSize * 0.2);
    const radians = (line.rotation * Math.PI) / 180,
      absCos = Math.abs(Math.cos(radians)),
      absSin = Math.abs(Math.sin(radians));
    const rotatedWidth = measured.width * absCos + measuredHeight * absSin,
      rotatedHeight = measured.width * absSin + measuredHeight * absCos;
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
    context.translate(centerX, inkHeight / 2);
    context.rotate(radians);
    context.scale(scale, scale);
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.fillStyle = line.color;
    context.fillText(
      line.text,
      0,
      ((measured.actualBoundingBoxAscent || line.fontSize * 0.8) -
        (measured.actualBoundingBoxDescent || line.fontSize * 0.2)) /
        2,
    );
    context.restore();
  }
  context.restore();
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
export async function exportStaffPdf(
  original: Blob,
  job: StaffPdfJob,
  fonts: PersonalizationFont[],
  fitMargin = 0.2,
  initial?: DecorativeInitial,
) {
  const source = await PDFDocument.load(await original.arrayBuffer(), {
      updateMetadata: false,
    }),
    pdf = await PDFDocument.create();
  if (source.getPageCount() < 1 || source.getPageCount() > STAFF_PDF_MAX_PAGES)
    throw new Error("Quantidade de páginas não suportada.");
  const release = await prepareStaffPdfFonts(job.lines, fonts);
  try {
    for (const [index, p] of source.getPages().entries()) {
      const crop = p.getCropBox(),
        angle = ((p.getRotation().angle % 360) + 360) % 360,
        rotated = angle === 90 || angle === 270;
      if (![0, 90, 180, 270].includes(angle))
        throw new Error("Rotação inválida.");
      const width = rotated ? crop.height : crop.width,
        height = rotated ? crop.width : crop.height;
      const sheet = pdf.addPage([width, height]);
      if (p.node.Contents()) {
        const embedded = await pdf.embedPage(p, {
          left: crop.x,
          bottom: crop.y,
          right: crop.x + crop.width,
          top: crop.y + crop.height,
        });
        sheet.drawPage(embedded, {
          x: angle === 180 || angle === 270 ? width : 0,
          y: angle === 90 || angle === 180 ? height : 0,
          width: crop.width,
          height: crop.height,
          rotate: degrees(-angle),
        });
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
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil((width * STAFF_PDF_DPI) / 72);
        canvas.height = Math.ceil((height * STAFF_PDF_DPI) / 72);
        if (
          canvas.width * canvas.height > 64_000_000 ||
          Math.max(canvas.width, canvas.height) > 32767
        )
          throw new Error("Página excede a capacidade de edição a 300 DPI.");
        try {
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas indisponível.");
          drawStaffPdfText(
            context,
            canvas.width,
            canvas.height,
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
            x: 0,
            y: 0,
            width,
            height,
          });
        } finally {
          canvas.width = canvas.height = 1;
        }
      }
    }
    return new Blob([new Uint8Array(await pdf.save())], {
      type: "application/pdf",
    });
  } finally {
    release();
  }
}
