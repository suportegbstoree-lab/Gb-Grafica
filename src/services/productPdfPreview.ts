import { selectedInitial, centeredInitialBox } from "../lib/decorativeInitial";
import {
  productPdfOrder,
  type ProductPdfBinding,
} from "../lib/productCustomization";
import {
  decodePersonalizationSource,
  personalizationCanvasBlob,
} from "./personalizationModelService";
import {
  drawStaffPdfImage,
  drawStaffPdfText,
  editedStaffPdfPage,
  prepareStaffPdfFonts,
} from "./staffPdfRender";
import type { PersonalizationDocument } from "./personalizationExport";
export async function productPdfPreview(
  binding: ProductPdfBinding,
  text: string,
  textEnabled: boolean,
  image?: Blob | string,
): Promise<PersonalizationDocument> {
  const recipe = productPdfOrder(binding, text, textEnabled),
    release = await prepareStaffPdfFonts(recipe.job.lines, recipe.fonts);
  try {
    const pages = [];
    for (let index = 0; index < binding.pdf.pages.length; index++) {
      const base = await decodePersonalizationSource(binding.pdf.pages[index]),
        canvas = document.createElement("canvas");
      canvas.width = base.width;
      canvas.height = base.height;
      try {
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas indisponível.");
        ctx.drawImage(base.source, 0, 0);
        if (index === 0 && image) {
          const extra = await decodePersonalizationSource(image);
          try {
            drawStaffPdfImage(
              ctx,
              canvas.width,
              canvas.height,
              extra.source,
              extra.width,
              extra.height,
              recipe.fullPage,
            );
          } finally {
            extra.dispose();
          }
        }
        const initial =
          index === 0
            ? selectedInitial(binding.pdf, textEnabled ? text : "")
            : undefined;
        if (initial) {
          const letter = await decodePersonalizationSource(initial.url);
          try {
            const box = centeredInitialBox(
              canvas.width,
              canvas.height,
              letter.width,
              letter.height,
              initial.sizePercent,
            );
            ctx.drawImage(letter.source, box.x, box.y, box.width, box.height);
          } finally {
            letter.dispose();
          }
        }
        const orientation = editedStaffPdfPage(index, binding.pdf.pages.length);
        if (orientation)
          drawStaffPdfText(
            ctx,
            canvas.width,
            canvas.height,
            recipe.job.lines,
            recipe.fonts,
            orientation,
            recipe.fitMargin,
          );
        pages.push({
          label:
            index === 0
              ? ("Capa" as const)
              : index === 1
                ? ("Contracapa" as const)
                : (`Página ${index + 1}` as const),
          blob: await personalizationCanvasBlob(canvas, "image/png"),
        });
      } finally {
        base.dispose();
        canvas.width = canvas.height = 1;
      }
    }
    return { title: binding.pdf.name, pages };
  } finally {
    release();
  }
}
