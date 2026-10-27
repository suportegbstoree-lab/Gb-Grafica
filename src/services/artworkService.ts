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
import { apiFetch } from './apiClient';
import { runArtworkRelayUpload } from './artworkRelayClient';

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
  const originalName = sanitizeArtworkName(file.name);
  if (relayEnabled()) return uploadViaRelay(file, originalName, 'source-artwork', user.uid);
  const uploadId = crypto.randomUUID().replace(/-/g, '');
  const path = `artworks/${user.uid}/pending/${uploadId}.${extension}`;

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
  const baseName = sanitizeArtworkName(preferredName).replace(/\.[^.]+$/, '').slice(0, 110) || 'modelo';
  const originalName = `${baseName}.${extension}`;
  if (relayEnabled()) return uploadViaRelay(blob, originalName, 'personalization-model', user.uid);
  const uploadId = crypto.randomUUID().replace(/-/g, '');
  const path = `artworks/${user.uid}/pending/${uploadId}.${extension}`;

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
  const response = await apiFetch(url, {
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

function relayEnabled(): boolean {
  const value = import.meta.env.VITE_ARTWORK_UPLOAD_RELAY_MODE?.trim();
  if (!value) return false;
  if (value === 'enabled') return true;
  throw new Error('O envio de arquivos está configurado incorretamente.');
}

async function relayChunk(url: string, payload: { offset: number; data: string }, userId: string): Promise<Record<string, unknown>> {
  let lastError: Error = new Error('Não foi possível enviar a parte do arquivo.');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const user = auth.currentUser;
    if (!user || user.uid !== userId) throw new Error('Sua sessão expirou. Faça login novamente.');
    let retryable = false;
    try {
      const token = await user.getIdToken();
      const response = await apiFetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({})) as ApiErrorPayload & Record<string, unknown>;
      if (response.ok) return result;
      lastError = new Error(apiErrorMessage(result, 'Não foi possível enviar a parte do arquivo.'));
      retryable = response.status === 409 || response.status === 503;
    } catch (caught) {
      lastError = caught instanceof Error ? caught : lastError;
      retryable = true;
    }
    if (!retryable || attempt === 2) throw lastError;
    await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
  }
  throw lastError;
}

async function uploadViaRelay(blob: Blob, name: string, kind: 'source-artwork' | 'personalization-model', userId: string): Promise<UploadedArtwork> {
  if (auth.currentUser?.uid !== userId) throw new Error('Sua sessão expirou. Faça login novamente.');
  return runArtworkRelayUpload(blob, name, kind, userId,
    data => authenticatedRequest('/api/artwork-uploads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    }),
    (uploadId, data) => relayChunk(`/api/artwork-uploads/${uploadId}/chunk`, data, userId),
  );
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
