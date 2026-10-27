import { isPendingArtworkPath } from '../lib/artwork.js';

type Start = { uploadId?: unknown; chunkBytes?: unknown };
type Chunk = Record<string, unknown>;
type Kind = 'source-artwork' | 'personalization-model';

export async function runArtworkRelayUpload(
  blob: Blob, name: string, kind: Kind, userId: string,
  startUpload: (data: { size: number; contentType: string; name: string; kind: Kind }) => Promise<Start>,
  sendChunk: (uploadId: string, data: { offset: number; data: string }) => Promise<Chunk>,
): Promise<{ path: string; name: string }> {
  const start = await startUpload({ size: blob.size, contentType: blob.type, name, kind });
  if (typeof start.uploadId !== 'string' || !/^[a-f0-9]{32}$/.test(start.uploadId) || start.chunkBytes !== 2 * 1024 * 1024) {
    throw new Error('Não foi possível iniciar o envio do arquivo.');
  }
  let offset = 0;
  let stalls = 0;
  while (offset < blob.size) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + start.chunkBytes).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const result = await sendChunk(start.uploadId, { offset, data: btoa(binary) });
    if (result.done === true) {
      if (!isPendingArtworkPath(result.path, userId) || typeof result.name !== 'string') throw new Error('Resposta inválida do envio.');
      return { path: result.path, name: result.name };
    }
    if (result.done !== false || !Number.isSafeInteger(result.offset) || (result.offset as number) < 0 || (result.offset as number) >= blob.size) {
      throw new Error('Resposta inválida do envio.');
    }
    const next = result.offset as number;
    stalls = next <= offset ? stalls + 1 : 0;
    if (stalls > 3) throw new Error('Não foi possível continuar o envio. Tente novamente.');
    offset = next;
  }
  throw new Error('Não foi possível concluir o envio.');
}
