import { validPdfTemplates } from "../lib/pdfTemplate.js";
import { isAllowedArtwork, matchesArtworkSignature } from "../lib/artwork.js";
import { isPendingArtworkPath } from "../lib/artwork.js";
import {
  parseArtworkObjectGeneration,
  readArtworkPrefix,
  type ArtworkObjectVersion,
  type ArtworkBucket,
} from "./artworkObjectVersion.js";
export async function templateArtwork(
  bucket: ArtworkBucket,
  productId: string,
  product: Record<string, unknown>,
  id: unknown,
): Promise<ArtworkObjectVersion | undefined> {
  if (id === undefined || id === "") return undefined;
  const gallery = [
    product.imagem,
    ...(Array.isArray(product.imagens) ? product.imagens : []),
  ].filter((url): url is string => typeof url === "string");
  if (
    typeof id !== "string" ||
    !validPdfTemplates(product.modelosPdf, productId, gallery)
  )
    throw new Error("Modelo PDF inválido. Atualize o produto.");
  const template = product.modelosPdf.find((template) => template.id === id);
  if (!template) throw new Error("O modelo PDF não está mais disponível.");
  const [metadata] = await bucket.file(template.path).getMetadata();
  const generation = parseArtworkObjectGeneration(metadata.generation);
  if (
    !generation ||
    metadata.contentType !== "application/pdf" ||
    !isAllowedArtwork(metadata.contentType, Number(metadata.size)) ||
    !matchesArtworkSignature(
      metadata.contentType,
      await readArtworkPrefix(bucket, template.path, generation),
    )
  )
    throw new Error("O modelo PDF armazenado é inválido.");
  return {
    path: template.path,
    generation,
    contentType: "application/pdf",
    originalName: template.name,
    kind: "source-artwork",
  };
}

export async function pendingBackPdf(
  bucket: ArtworkBucket,
  uid: string,
  path: unknown,
): Promise<ArtworkObjectVersion | undefined> {
  if (path === undefined || path === "") return undefined;
  if (!isPendingArtworkPath(path, uid) || !path.endsWith(".pdf"))
    throw new Error("PDF da contracapa inválido.");
  const [metadata] = await bucket.file(path).getMetadata();
  const generation = parseArtworkObjectGeneration(metadata.generation);
  if (
    !generation ||
    metadata.metadata?.ownerId !== uid ||
    metadata.contentType !== "application/pdf" ||
    !isAllowedArtwork(metadata.contentType, Number(metadata.size)) ||
    !matchesArtworkSignature(
      metadata.contentType,
      await readArtworkPrefix(bucket, path, generation),
    )
  )
    throw new Error("PDF da contracapa não permitido.");
  return {
    path,
    generation,
    contentType: "application/pdf",
    originalName: String(
      metadata.metadata?.originalName || "contracapa.pdf",
    ).slice(0, 120),
    kind: "source-artwork",
  };
}
