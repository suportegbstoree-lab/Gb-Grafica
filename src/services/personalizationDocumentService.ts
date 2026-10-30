import { isComposablePersonalizationImage, MAX_PERSONALIZATION_MODEL_BYTES } from '../lib/personalizationModel';
import { matchesArtworkSignature } from '../lib/artwork';
import type { CartItem } from '../types';
import { requestPersonalizationModelUrl } from './artworkService';
import type { PersonalizationDocument } from './personalizationExport';

async function readSignedModel(url: string): Promise<Blob> {
  const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(30_000) });
  const type = response.headers.get('content-type')?.split(';')[0].trim() || '';
  if (!response.ok || !response.body || !['image/png', 'image/jpeg', 'image/webp'].includes(type)) {
    await response.body?.cancel();
    throw new Error('Não foi possível carregar o modelo. Confira a conexão e o CORS do Storage.');
  }
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PERSONALIZATION_MODEL_BYTES) throw new Error('O modelo excede o tamanho permitido.');
      chunks.push(new Uint8Array(value));
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const blob = new Blob(chunks, { type });
  if (!isComposablePersonalizationImage(blob.type, blob.size) || !matchesArtworkSignature(blob.type, new Uint8Array(await blob.slice(0, 16).arrayBuffer()))) {
    throw new Error('O modelo armazenado possui conteúdo inválido.');
  }
  return blob;
}

export async function loadOrderPersonalizationDocument(orderId: string, item: CartItem): Promise<PersonalizationDocument> {
  const front = await readSignedModel(await requestPersonalizationModelUrl(orderId, item.id));
  const back = item.contracapaPath ? await readSignedModel(await requestPersonalizationModelUrl(orderId, item.id, 'back')) : null;
  return { title: item.nome, pages: [{ label: 'Capa', blob: front }, ...(back ? [{ label: 'Contracapa' as const, blob: back }] : [])] };
}
