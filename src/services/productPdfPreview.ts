import { selectedInitial, centeredInitialBox } from "../lib/decorativeInitial";
import {
  productPdfOrder,
  type ProductPdfBinding,
  type ProductPdfOrder,
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

type DecodedImage = Awaited<ReturnType<typeof decodePersonalizationSource>>;

export function productPdfPageLabel(index: number) {
  return index === 0
    ? "Capa"
    : index === 1
      ? "Contracapa"
      : (`Página ${index + 1}` as const);
}

export function drawProductPdfPage(
  canvas: HTMLCanvasElement,
  base: DecodedImage,
  index: number,
  pageCount: number,
  recipe: ProductPdfOrder,
  extra?: DecodedImage,
  initial?: { image: DecodedImage; sizePercent: number },
  maxEdge = Infinity,
  showText = true,
) {
  const { width, height } = base;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const displayWidth = Math.max(1, Math.round(width * scale));
  const displayHeight = Math.max(1, Math.round(height * scale));
  if (canvas.width !== displayWidth) canvas.width = displayWidth;
  if (canvas.height !== displayHeight) canvas.height = displayHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível.");
  ctx.setTransform(displayWidth / width, 0, 0, displayHeight / height, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(base.source, 0, 0);
  if (index === 0 && extra)
    drawStaffPdfImage(
      ctx,
      width,
      height,
      extra.source,
      extra.width,
      extra.height,
      recipe.fullPage,
    );
  if (index === 0 && initial) {
    const { image, sizePercent } = initial;
    const box = centeredInitialBox(
      width,
      height,
      image.width,
      image.height,
      sizePercent,
    );
    ctx.drawImage(image.source, box.x, box.y, box.width, box.height);
  }
  const orientation = editedStaffPdfPage(index, pageCount);
  if (showText && orientation)
    drawStaffPdfText(
      ctx,
      width,
      height,
      recipe.job.lines,
      recipe.fonts,
      orientation,
      recipe.fitMargin,
    );
}

export async function productPdfPreview(
  binding: ProductPdfBinding,
  text: string,
  textEnabled: boolean,
  image?: Blob | string,
): Promise<PersonalizationDocument> {
  const recipe = productPdfOrder(binding, text, textEnabled);
  const release = await prepareStaffPdfFonts(recipe.job.lines, recipe.fonts);
  try {
    const pages = [];
    for (let index = 0; index < binding.pdf.pages.length; index++) {
      const base = await decodePersonalizationSource(binding.pdf.pages[index]);
      const canvas = document.createElement("canvas");
      const initial =
        index === 0
          ? selectedInitial(
              binding.pdf,
              textEnabled ? text : "",
              binding.layout.initial_size_percent,
            )
          : undefined;
      let extra: DecodedImage | undefined;
      let letter: DecodedImage | undefined;
      try {
        if (index === 0 && image)
          extra = await decodePersonalizationSource(image);
        if (initial) letter = await decodePersonalizationSource(initial.url);
        drawProductPdfPage(
          canvas,
          base,
          index,
          binding.pdf.pages.length,
          recipe,
          extra,
          initial && letter
            ? { image: letter, sizePercent: initial.sizePercent }
            : undefined,
        );
        pages.push({
          label: productPdfPageLabel(index),
          blob: await personalizationCanvasBlob(canvas, "image/png"),
        });
      } finally {
        letter?.dispose();
        extra?.dispose();
        base.dispose();
        canvas.width = canvas.height = 1;
      }
    }
    return { title: binding.pdf.name, pages };
  } finally {
    release();
  }
}
