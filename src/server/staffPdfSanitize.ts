import { PDFDocument, degrees } from "pdf-lib";
import { OperationsError } from "../lib/operations.js";
import { STAFF_DOCUMENT_MAX_BYTES } from "../lib/staffDocument.js";
import { STAFF_PDF_MAX_PAGES } from "../lib/staffPdf.js";

/** Only static page streams survive. Normalize CropBox and Rotate without rasterizing the PDF. */
export async function sanitizeStaffPdfBase(bytes: Uint8Array) {
  if (
    bytes.length > STAFF_DOCUMENT_MAX_BYTES ||
    Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-"
  )
    throw new OperationsError("Envie um PDF válido de até 50 MB.");
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new OperationsError(
      "O PDF não pôde ser aberto. Confira se está protegido por senha.",
    );
  }
  if (source.getPageCount() < 1 || source.getPageCount() > STAFF_PDF_MAX_PAGES)
    throw new OperationsError(
      `Use um PDF de 1 a ${STAFF_PDF_MAX_PAGES} páginas.`,
    );
  const result = await PDFDocument.create(),
    pages: Array<{ width: number; height: number }> = [];
  for (const p of source.getPages()) {
    const crop = p.getCropBox(),
      angle = ((p.getRotation().angle % 360) + 360) % 360;
    if (
      ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
      crop.width < 1 ||
      crop.height < 1 ||
      Math.max(crop.width, crop.height) > 14400 ||
      ![0, 90, 180, 270].includes(angle)
    )
      throw new OperationsError("Dimensões ou rotação do PDF inválidas.");
    const rotated = angle === 90 || angle === 270,
      width = rotated ? crop.height : crop.width,
      height = rotated ? crop.width : crop.height;
    const sheet = result.addPage([width, height]);
    if (p.node.Contents()) {
      const embedded = await result.embedPage(p, {
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
    pages.push({ width, height });
  }
  const output = Buffer.from(await result.save());
  if (output.length > STAFF_DOCUMENT_MAX_BYTES)
    throw new OperationsError("O PDF final excede 50 MB.");
  return { output, pages };
}
