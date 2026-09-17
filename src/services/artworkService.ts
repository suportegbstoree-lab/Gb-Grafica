import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import { auth, storage } from '../firebase';
import {
  artworkExtension,
  isAllowedArtwork,
  MAX_ARTWORK_BYTES,
  matchesArtworkSignature,
  sanitizeArtworkName,
} from '../lib/artwork';
import {
  isComposablePersonalizationImage,
  MAX_PERSONALIZATION_MODEL_BYTES,
} from '../lib/personalizationModel';
import { apiErrorMessage, type ApiErrorPayload } from '../lib/apiError';

export interface UploadedArtwork {
  path: string;
  name: string;
}

export async function uploadArtwork(file: File): Promise<UploadedArtwork> {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login antes de enviar sua arte.');
  if (!isAllowedArtwork(file.type, file.size)) {
    throw new Error(`Envie PDF, PNG, JPG ou WebP com no máximo ${MAX_ARTWORK_BYTES / 1024 / 1024} MB.`);
  }

  const extension = artworkExtension(file.type);
  if (!extension) throw new Error('Formato de arquivo não permitido.');
  const uploadId = crypto.randomUUID().replace(/-/g, '');
  const path = `artworks/${user.uid}/pending/${uploadId}.${extension}`;
  const originalName = sanitizeArtworkName(file.name);

  await uploadBytes(ref(storage, path), file, {
    contentType: file.type,
    customMetadata: {
      ownerId: user.uid,
      originalName,
      kind: 'source-artwork',
    },
  });

  return { path, name: originalName };
}

export async function uploadPersonalizationModel(blob: Blob, preferredName: string): Promise<UploadedArtwork> {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login antes de gerar o modelo personalizado.');
  if (!isComposablePersonalizationImage(blob.type, blob.size)) {
    throw new Error(`O modelo deve ser PNG, JPG ou WebP e ter no máximo ${MAX_PERSONALIZATION_MODEL_BYTES / 1024 / 1024} MB.`);
  }
  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (!matchesArtworkSignature(blob.type, header)) {
    throw new Error('O conteúdo do modelo personalizado é inválido.');
  }

  const extension = artworkExtension(blob.type);
  if (!extension || extension === 'pdf') throw new Error('O formato do modelo personalizado não é permitido.');
  const uploadId = crypto.randomUUID().replace(/-/g, '');
  const path = `artworks/${user.uid}/pending/${uploadId}.${extension}`;
  const baseName = sanitizeArtworkName(preferredName).replace(/\.[^.]+$/, '').slice(0, 110) || 'modelo';
  const originalName = `${baseName}.${extension}`;

  await uploadBytes(ref(storage, path), blob, {
    contentType: blob.type,
    customMetadata: {
      ownerId: user.uid,
      originalName,
      kind: 'personalization-model',
    },
  });

  return { path, name: originalName };
}

export async function removePendingArtwork(path: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !path.startsWith(`artworks/${user.uid}/pending/`)) return;
  await deleteObject(ref(storage, path));
}

async function authenticatedRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sua sessão expirou. Faça login novamente.');
  const token = await user.getIdToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json().catch(() => ({})) as ApiErrorPayload & T;
  if (!response.ok) {
    throw new Error(apiErrorMessage(data, 'Não foi possível acessar a arte.'));
  }
  return data;
}

export async function requestArtworkUrl(orderId: string, itemId: string): Promise<string> {
  const data = await authenticatedRequest<{ url?: unknown }>(
    `/api/orders/${encodeURIComponent(orderId)}/artwork/${encodeURIComponent(itemId)}`,
  );
  if (typeof data.url !== 'string' || !data.url.startsWith('https://')) {
    throw new Error('O servidor não retornou um link válido para a arte.');
  }
  return data.url;
}

export async function requestPersonalizationModelUrl(orderId: string, itemId: string): Promise<string> {
  const data = await authenticatedRequest<{ url?: unknown }>(
    `/api/orders/${encodeURIComponent(orderId)}/model/${encodeURIComponent(itemId)}`,
  );
  if (typeof data.url !== 'string' || !data.url.startsWith('https://')) {
    throw new Error('O servidor não retornou um link válido para o modelo personalizado.');
  }
  return data.url;
}
