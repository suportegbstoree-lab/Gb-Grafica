import { retireCatalogAsset } from './catalogRetentionService';
import { ref, uploadBytesResumable } from "firebase/storage";
import { auth, storage } from "../firebase";
import { pdfPreviewPages } from "./pdfPreview";
import {
  uploadCatalogImage,
  removeCatalogImage,
  type UploadedCatalogImage,
} from "./catalogImageService";
import { isTemplatePath, type ProductPdfTemplate } from "../lib/pdfTemplate";
export interface UploadedCatalogPdf {
  template: ProductPdfTemplate;
  images: UploadedCatalogImage[];
}
export async function uploadCatalogPdf(
  productId: string,
  file: File,
): Promise<UploadedCatalogPdf> {
  const user = auth.currentUser;
  if (!user) throw new Error("Entre novamente para enviar um modelo.");
  const pages = await pdfPreviewPages(file),
    id = crypto.randomUUID().replaceAll("-", ""),
    path = `catalog/templates/${productId}/${id}.pdf`;
  if (!isTemplatePath(path, productId)) throw new Error("Produto inválido.");
  const images: UploadedCatalogImage[] = [];
  let stored = false;
  try {
    await uploadBytesResumable(ref(storage, path), file, {
      contentType: "application/pdf",
      customMetadata: {
        uploadedBy: user.uid,
        originalName: file.name.slice(0, 120),
      },
    });
    stored = true;
    for (const page of pages)
      images.push(await uploadCatalogImage(productId, page));
    return {
      template: {
        id,
        path,
        name: file.name.slice(0, 120),
        pages: images.map((image) => image.url),
      },
      images,
    };
  } catch (error) {
    await Promise.allSettled([
      ...images.map((image) => removeCatalogImage(image.path)),
      ...(stored ? [retireCatalogAsset(path)] : []),
    ]);
    throw error;
  }
}
export async function removeCatalogPdf(path: string) {
  const productId = path.split("/")[2];
  if (!isTemplatePath(path, productId)) throw new Error("Modelo inválido.");
  await retireCatalogAsset(path);
}
