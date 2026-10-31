import { PDFDocument, degrees } from "pdf-lib";
import type { PersonalizationDocument } from "./personalizationExport";
import {
  decodePersonalizationSource,
  drawPersonalizationText,
  preparePersonalizationFont,
  personalizationCanvasBlob,
} from "./personalizationModelService";
import { printGeometry } from "../lib/printProfile";

/** Embed static page content, without importing active PDF annotations or JavaScript. */
export async function exportOriginalPdf(
  document: PersonalizationDocument,
): Promise<Blob> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(document.title);
  const front = document.originalPdf
    ? await PDFDocument.load(await document.originalPdf.arrayBuffer())
    : undefined;
  const customBack = document.originalBackPdf
    ? await PDFDocument.load(await document.originalBackPdf.arrayBuffer())
    : undefined;
  for (const [index, page] of document.pages.entries()) {
    const source =
      index === 0
        ? front?.getPage(0)
        : customBack?.getPage(0) ||
          (document.automaticPdfBack && front && front.getPageCount() > 1
            ? front.getPage(1)
            : undefined);
    const image = await decodePersonalizationSource(page.blob);
    try {
      const crop = source?.getCropBox(),
        angle = (((source?.getRotation().angle || 0) % 360) + 360) % 360;
      if (![0, 90, 180, 270].includes(angle))
        throw new Error("Rotação do PDF não suportada.");
      const rotated = angle === 90 || angle === 270;
      const nativeWidth = crop
        ? rotated
          ? crop.height
          : crop.width
        : (image.width * 72) / 300;
      const nativeHeight = crop
        ? rotated
          ? crop.width
          : crop.height
        : (image.height * 72) / 300;
      const geometry =
        document.printProfile && printGeometry(document.printProfile);
      const width = geometry ? (geometry.widthMm * 72) / 25.4 : nativeWidth,
        height = geometry ? (geometry.heightMm * 72) / 25.4 : nativeHeight;
      if (Math.abs(width / height - image.width / image.height) > 0.02)
        throw new Error(
          "A proporção do PDF não corresponde ao modelo aprovado.",
        );
      const sheet = pdf.addPage([width, height]);
      if (source && crop) {
        const embedded = await pdf.embedPage(source, {
          left: crop.x,
          bottom: crop.y,
          right: crop.x + crop.width,
          top: crop.y + crop.height,
        });
        const scale = Math.min(width / nativeWidth, height / nativeHeight),
          w = embedded.width * scale,
          h = embedded.height * scale;
        const dx = (width - nativeWidth * scale) / 2,
          dy = (height - nativeHeight * scale) / 2;
        sheet.drawPage(embedded, {
          x: dx + (angle === 180 || angle === 270 ? nativeWidth * scale : 0),
          y: dy + (angle === 90 || angle === 180 ? nativeHeight * scale : 0),
          width: w,
          height: h,
          rotate: degrees(-angle),
        });
        if (index === 0 && document.customization) {
          const canvas = globalThis.document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Não foi possível exportar o texto.");
          const release = await preparePersonalizationFont(
            document.customization,
            document.fonts || [],
          );
          try {
            drawPersonalizationText(
              context,
              image.width,
              image.height,
              document.customization,
              document.fonts || [],
            );
            const overlay = await pdf.embedPng(
              await (
                await personalizationCanvasBlob(canvas, "image/png")
              ).arrayBuffer(),
            );
            sheet.drawImage(overlay, { x: 0, y: 0, width, height });
          } finally {
            release();
            canvas.width = canvas.height = 1;
          }
        }
      } else {
        const raster =
          page.blob.type === "image/jpeg"
            ? await pdf.embedJpg(await page.blob.arrayBuffer())
            : await pdf.embedPng(await page.blob.arrayBuffer());
        sheet.drawImage(raster, { x: 0, y: 0, width, height });
      }
      if (document.printProfile) {
        const profile = document.printProfile;
        sheet.setBleedBox(0, 0, width, height);
        sheet.setTrimBox(
          (profile.bleedMm * 72) / 25.4,
          (profile.bleedMm * 72) / 25.4,
          (profile.widthMm * 72) / 25.4,
          (profile.heightMm * 72) / 25.4,
        );
      }
    } finally {
      image.dispose();
    }
  }
  return new Blob([new Uint8Array(await pdf.save())], {
    type: "application/pdf",
  });
}
