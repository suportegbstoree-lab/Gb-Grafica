import { isDeepStrictEqual } from "node:util";
import {
  bindingValid,
  type ProductPdfBinding,
} from "../lib/productCustomization.js";
import { retainedAssetPath } from "../lib/catalogRetention.js";
import { layoutFont, normalizePdfLayout } from "../lib/staffPdf.js";
import { normalizePersonalizationFonts } from "../lib/textCustomization.js";
import { resolveStaffPdfBase } from "./staffPdfLibrary.js";
import { OperationsError } from "../lib/operations.js";
import type { getAdminServices } from "./firebaseAdmin.js";
import type { Transaction } from "firebase-admin/firestore";
/** Publishing freezes the existing workshop source and layout, never browser-supplied geometry. */
export async function verifyProductPdfBinding(
  services: ReturnType<typeof getAdminServices>,
  tx: Transaction,
  id: string,
  b: ProductPdfBinding,
) {
  if (!bindingValid(b, id)) throw new OperationsError("Vínculo PDF inválido.");
  const base = await resolveStaffPdfBase(services, b.baseId);
  const [mold, config] = await Promise.all([
    tx.get(services.db.collection("_staffPdfLayouts").doc(b.layoutId)),
    tx.get(services.db.collection("config").doc("main")),
  ]);
  const layout = mold.data();
  if (
    base.revision !== b.baseRevision ||
    !layout ||
    layout.enabled !== true ||
    layout.revision !== b.layoutRevision ||
    !isDeepStrictEqual(normalizePdfLayout(layout.layout), b.layout)
  )
    throw new OperationsError(
      "A base ou o molde mudou. Atualize o vínculo antes de salvar.",
      409,
    );
  const font = layoutFont(
    b.layout,
    normalizePersonalizationFonts(config.data()?.fontes_personalizacao),
  );
  if (b.layout.font_name && !font)
    throw new OperationsError("Cadastre a fonte do molde antes de vincular.");
  if (!isDeepStrictEqual(b.fonts, font ? [font] : []))
    throw new OperationsError(
      "A fonte do molde mudou. Atualize o vínculo.",
      409,
    );
  if (
    b.pdf.pages.length !== base.pageCount ||
    b.pdf.pages.some(
      (url) =>
        !retainedAssetPath(url, services.bucket.name)?.startsWith(
          `catalog/products/${id}/`,
        ),
    )
  )
    throw new OperationsError("Prévias do molde inválidas.");
  const oldLetters = base.alphabet?.letters || {},
    newLetters = b.pdf.alphabet?.letters || {};
  if (
    Object.keys(oldLetters).sort().join() !==
      Object.keys(newLetters).sort().join() ||
    (base.alphabet && b.pdf.alphabet?.sizePercent !== base.alphabet.sizePercent)
  )
    throw new OperationsError("O alfabeto mudou. Atualize o vínculo.", 409);
  for (const letter of Object.keys(oldLetters)) {
    const [[original], [published]] = await Promise.all([
      services.bucket.file(oldLetters[letter].path).getMetadata(),
      services.bucket.file(newLetters[letter].path).getMetadata(),
    ]);
    if (
      !original.md5Hash ||
      original.md5Hash !== published.md5Hash ||
      String(original.size) !== String(published.size)
    )
      throw new OperationsError("A inicial publicada difere da base.");
  }
  const [[source], [copy]] = await Promise.all([
    services.bucket
      .file(
        base.path,
        base.generation ? { generation: Number(base.generation) } : undefined,
      )
      .getMetadata(),
    services.bucket.file(b.pdf.path).getMetadata(),
  ]);
  if (
    source.contentType !== "application/pdf" ||
    copy.contentType !== "application/pdf" ||
    !source.md5Hash ||
    source.md5Hash !== copy.md5Hash ||
    String(source.size) !== String(copy.size)
  )
    throw new OperationsError(
      "O PDF publicado difere da base da oficina. Vincule novamente.",
    );
}
