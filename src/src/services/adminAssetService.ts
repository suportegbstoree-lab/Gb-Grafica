import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, storage } from '../firebase';
import {
  adminAssetPathFromUrl,
  adminFontPath,
  adminImagePath,
  isAdminFontPath,
  isAdminImagePath,
  isAllowedAdminFont,
  isAllowedAdminImage,
  isSafeAdminAssetId,
  matchesAdminImageSignature,
  matchesWoff2Signature,
  MAX_ADMIN_FONT_BYTES,
  sanitizeAdminAssetName,
  type AdminImageScope,
} from '../lib/adminAsset';
import { MAX_CATALOG_IMAGE_BYTES } from '../lib/catalogImage';

export interface UploadedAdminAsset {
  path: string;
  url: string;
  name: string;
}

function adminAssetError(error: unknown): Error {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  if (code === 'storage/unauthorized') {
    return new Error('Sua sessão não possui permissão para alterar arquivos administrativos. Saia e entre novamente.');
  }
  if (code === 'storage/quota-exceeded') return new Error('O limite do Firebase Storage foi atingido.');
  if (code === 'storage/retry-limit-exceeded') return new Error('O envio demorou demais. Verifique a conexão e tente novamente.');
  return error instanceof Error ? error : new Error('Não foi possível enviar o arquivo.');
}

export async function uploadAdminImage(
  scope: AdminImageScope,
  ownerId: string,
  file: File,
): Promise<UploadedAdminAsset> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sua sessão expirou. Faça login novamente.');
  if (!isSafeAdminAssetId(ownerId)) throw new Error('O identificador do arquivo é inválido.');
  if (!isAllowedAdminImage(file.type, file.size)) {
    throw new Error(`Envie JPG, PNG ou WebP com no máximo ${MAX_CATALOG_IMAGE_BYTES / 1024 / 1024} MB.`);
  }
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!matchesAdminImageSignature(file.type, header)) {
    throw new Error('O conteúdo do arquivo não corresponde ao formato de imagem informado.');
  }
  const path = adminImagePath(scope, ownerId, crypto.randomUUID().replace(/-/g, ''), file.type);
  if (!path) throw new Error('Não foi possível gerar um caminho seguro para a imagem.');
  const originalName = sanitizeAdminAssetName(file.name);
  try {
    const snapshot = await uploadBytes(ref(storage, path), file, {
      contentType: file.type,
      cacheControl: 'public,max-age=31536000,immutable',
      customMetadata: { uploadedBy: user.uid, originalName },
    });
    return { path, url: await getDownloadURL(snapshot.ref), name: originalName };
  } catch (error) {
    throw adminAssetError(error);
  }
}

export async function uploadAdminFont(fontId: string, file: File): Promise<UploadedAdminAsset> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sua sessão expirou. Faça login novamente.');
  if (!isSafeAdminAssetId(fontId)) throw new Error('O identificador da fonte é inválido.');
  const normalizedContentType = (
    (file.type === '' || file.type === 'application/octet-stream') && file.name.toLowerCase().endsWith('.woff2')
  ) ? 'font/woff2' : file.type;
  if (!isAllowedAdminFont(normalizedContentType, file.size)) {
    throw new Error(`Envie uma fonte WOFF2 com no máximo ${MAX_ADMIN_FONT_BYTES / 1024 / 1024} MB.`);
  }
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!matchesWoff2Signature(header)) throw new Error('O arquivo não possui uma assinatura WOFF2 válida.');
  const path = adminFontPath(fontId, crypto.randomUUID().replace(/-/g, ''));
  if (!path) throw new Error('Não foi possível gerar um caminho seguro para a fonte.');
  const originalName = sanitizeAdminAssetName(file.name);
  try {
    const snapshot = await uploadBytes(ref(storage, path), file, {
      contentType: 'font/woff2',
      cacheControl: 'public,max-age=31536000,immutable',
      customMetadata: { uploadedBy: user.uid, originalName },
    });
    return { path, url: await getDownloadURL(snapshot.ref), name: originalName };
  } catch (error) {
    throw adminAssetError(error);
  }
}

export async function removeAdminAsset(path: string): Promise<void> {
  if (!auth.currentUser) throw new Error('Sua sessão expirou. Faça login novamente.');
  if (!isAdminImagePath(path) && !isAdminFontPath(path)) throw new Error('O caminho do arquivo administrativo é inválido.');
  try {
    await deleteObject(ref(storage, path));
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
    if (code === 'storage/object-not-found') return;
    throw adminAssetError(error);
  }
}

export function storedAdminAssetPath(url: string): string | null {
  const bucket = storage.app.options.storageBucket;
  return typeof bucket === 'string' ? adminAssetPathFromUrl(url, bucket) : null;
}
