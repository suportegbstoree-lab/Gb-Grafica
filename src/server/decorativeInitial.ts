import { bindingValid, type ProductPdfBinding } from '../lib/productCustomization.js';
import { initialReference, selectedInitial } from '../lib/decorativeInitial.js';
import { validPdfTemplates } from '../lib/pdfTemplate.js';
import { matchesArtworkSignature, isAllowedArtwork } from '../lib/artwork.js';
import { parseArtworkObjectGeneration, readArtworkPrefix, type ArtworkBucket, type ArtworkObjectVersion } from './artworkObjectVersion.js';

/** Resolve only catalog-owned paths. No URL, path, letter or size from the customer is trusted. */
export async function resolveOrderInitial(bucket: ArtworkBucket, productId: string, product: Record<string, unknown>, templateId: unknown, text: string, reference: unknown): Promise<{
  version: ArtworkObjectVersion; letter: string; sizePercent: number;
} | undefined> {
  if(!product.moldePdf && (typeof templateId !== 'string' || !templateId)) return undefined;
  const gallery = [product.imagem, ...(Array.isArray(product.imagens) ? product.imagens : [])].filter((url): url is string => typeof url === 'string');
  if (product.moldePdf ? !bindingValid(product.moldePdf,productId) : !validPdfTemplates(product.modelosPdf, productId, gallery)) throw new Error('Modelos PDF ou alfabetos inválidos. Atualize o produto.');
  const binding = product.moldePdf as ProductPdfBinding | undefined;
  const template = binding ? binding.pdf : (product.modelosPdf as import('../lib/pdfTemplate.js').ProductPdfTemplate[]).find(item => item.id === templateId);
  if (!template) throw new Error('O modelo PDF não está mais disponível.');
  if (!template.alphabet) {
    if (reference !== undefined && reference !== 'null') throw new Error('O alfabeto foi removido. Gere o modelo novamente.');
    return undefined;
  }
  const sizePercent = binding?.layout.initial_size_percent;
  if (reference !== initialReference(template, text, sizePercent)) throw new Error('O alfabeto ou o tamanho da inicial mudou. Gere o modelo novamente.');
  const initial = selectedInitial(template, text, sizePercent);
  if (!initial) return undefined;
  const [metadata] = await bucket.file(initial.path).getMetadata();
  const generation = parseArtworkObjectGeneration(metadata.generation);
  if (!generation || metadata.contentType !== 'image/png' || !isAllowedArtwork(metadata.contentType, Number(metadata.size)) ||
    !matchesArtworkSignature('image/png', await readArtworkPrefix(bucket, initial.path, generation))) throw new Error('A imagem da inicial não está mais disponível ou é inválida. Gere o modelo novamente.');
  return { letter: initial.letter, sizePercent: initial.sizePercent,
    version: { path: initial.path, generation, contentType: 'image/png', kind: 'source-artwork', originalName: `${initial.letter}.png` } };
}
