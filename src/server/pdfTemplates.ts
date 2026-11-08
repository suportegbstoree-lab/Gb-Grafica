import { retainedAssetPath } from '../lib/catalogRetention.js';
import { bindingValid } from '../lib/productCustomization.js';
import { validPdfTemplates } from "../lib/pdfTemplate.js";
import { isAllowedArtwork, matchesArtworkSignature, sanitizeArtworkName } from "../lib/artwork.js";
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

/** Production defaults are resolved only in this bucket, never fetched from user URLs. */
export async function defaultProductArtwork(bucket:ArtworkBucket,productId:string,product:Record<string,any>):Promise<ArtworkObjectVersion|undefined> {
 const binding=product.moldePdf;
 if(binding && !bindingValid(binding,productId)) throw new Error('Vínculo PDF inválido. Atualize o produto.');
 const path=binding?.pdf.path || (product.imagemBase?retainedAssetPath(product.imagemBase,bucket.name):undefined);
 if(!path) {if(product.imagemBase)throw new Error('Arte-base inválida.');return undefined;}
 if(!binding&&!path.startsWith(`catalog/products/${productId}/`))throw new Error('Arte-base de outro produto.');
 const [metadata]=await bucket.file(path).getMetadata(),generation=parseArtworkObjectGeneration(metadata.generation);
 if(!generation || !isAllowedArtwork(metadata.contentType,Number(metadata.size)) || (binding?metadata.contentType!=='application/pdf':!String(metadata.contentType).startsWith('image/')) || !matchesArtworkSignature(String(metadata.contentType),await readArtworkPrefix(bucket,path,generation)))throw new Error('A base de produção está indisponível.');
 return {path,generation,contentType:String(metadata.contentType),kind:'source-artwork',originalName:binding?.pdf.name||'imagem-base.'+path.split('.').at(-1)};
}
export async function productCustomerImage(bucket:ArtworkBucket,uid:string,path:unknown):Promise<ArtworkObjectVersion|undefined> {
 if(!path)return undefined;
 if(!isPendingArtworkPath(path,uid))throw new Error('A imagem não pertence à sua sessão.');
 const [m]=await bucket.file(path).getMetadata(),generation=parseArtworkObjectGeneration(m.generation);
 if(!generation || m.metadata?.ownerId!==uid || m.metadata?.kind!=='source-artwork' || !['image/jpeg','image/png','image/webp'].includes(String(m.contentType)) || !isAllowedArtwork(m.contentType,Number(m.size)) || !matchesArtworkSignature(String(m.contentType),await readArtworkPrefix(bucket,path,generation)))throw new Error('Envie uma imagem JPG, PNG ou WebP válida.');
 return {path,generation,contentType:String(m.contentType),kind:'source-artwork',originalName:sanitizeArtworkName(String(m.metadata?.originalName||'imagem-cliente').slice(0,120))};
}
