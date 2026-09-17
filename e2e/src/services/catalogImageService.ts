import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, storage } from '../firebase';
import {
  catalogImageExtension,
  catalogImagePathFromUrl,
  isAllowedCatalogImage,
  isCatalogImagePath,
  isSafeCatalogProductId,
  MAX_CATALOG_IMAGE_BYTES,
  matchesCatalogImageSignature,
  sanitizeCatalogImageName,
} from '../lib/catalogImage';

export interface UploadedCatalogImage {
  path: string;
  url: string;
  name: string;
}

function catalogStorageError(error: unknown): Error {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';

  if (code === 'storage/unauthorized') {
    return new Error('Sua sessão não possui permissão para alterar imagens do catálogo. Saia, entre novamente e confirme a claim administrativa.');
  }
  if (code === 'storage/quota-exceeded') {
    return new Error('O limite do Firebase Storage foi atingido.');
  }
  if (code === 'storage/retry-limit-exceeded') {
    return new Error('O envio demorou demais. Verifique a conexão e tente novamente.');
  }
  return error instanceof Error ? error : new Error('Não foi possível enviar a imagem do catálogo.');
}

export async function uploadCatalogImage(productId: string, file: File): Promise<UploadedCatalogImage> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sua sessão expirou. Faça login novamente.');
  if (!isSafeCatalogProductId(productId)) throw new Error('O identificador do produto é inválido.');
  if (!isAllowedCatalogImage(file.type, file.size)) {
    throw new Error(`Envie JPG, PNG ou WebP com no máximo ${MAX_CATALOG_IMAGE_BYTES / 1024 / 1024} MB.`);
  }

  const extension = catalogImageExtension(file.type);
  if (!extension) throw new Error('Formato de imagem não permitido.');
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!matchesCatalogImageSignature(file.type, header)) {
    throw new Error('O conteúdo do arquivo não corresponde ao formato de imagem informado.');
  }
  const uploadId = crypto.randomUUID().replace(/-/g, '');
  const path = `catalog/products/${productId}/${uploadId}.${extension}`;
  const originalName = sanitizeCatalogImageName(file.name);

  try {
    const snapshot = await uploadBytes(ref(storage, path), file, {
      contentType: file.type,
      cacheControl: 'public,max-age=31536000,immutable',
      customMetadata: {
        uploadedBy: user.uid,
        originalName,
      },
    });
    const url = await getDownloadURL(snapshot.ref);
    return { path, url, name: originalName };
  } catch (error) {
    throw catalogStorageError(error);
  }
}

export async function removeCatalogImage(path: string): Promise<void> {
  if (!auth.currentUser) throw new Error('Sua sessão expirou. Faça login novamente.');
  if (!isCatalogImagePath(path)) throw new Error('O caminho da imagem do catálogo é inválido.');

  try {
    await deleteObject(ref(storage, path));
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
    if (code === 'storage/object-not-found') return;
    throw catalogStorageError(error);
  }
}

export function storedCatalogImagePath(url: string, productId?: string): string | null {
  const bucket = storage.app.options.storageBucket;
  return typeof bucket === 'string'
    ? catalogImagePathFromUrl(url, bucket, productId)
    : null;
}
