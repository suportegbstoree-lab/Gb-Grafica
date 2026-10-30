import { isAdminFontPath, isAdminImagePath } from '../lib/adminAsset.js';
import { isCatalogImagePath } from '../lib/catalogImage.js';

export type CatalogAssetKind = 'products' | 'categories' | 'site' | 'promotions' | 'fonts';
type Result = Record<string, unknown>;
export async function runCatalogRelayUpload(blob: Blob, name: string, kind: CatalogAssetKind, ownerId: string, bucket: string,
  startUpload: (body: Record<string, unknown>) => Promise<Result>,
  sendChunk: (uploadId: string, body: { offset: number; data: string }) => Promise<Result>,
): Promise<{ path: string; name: string; url: string }> {
  const session = await startUpload({ size: blob.size, contentType: blob.type, name, kind, ownerId });
  if (typeof session.uploadId !== 'string' || !/^[a-f0-9]{32}$/.test(session.uploadId) || session.chunkBytes !== 2 * 1024 * 1024) throw new Error('Resposta de envio administrativo inválida.');
  let offset = 0; let stalls = 0;
  while (offset < blob.size) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + session.chunkBytes).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const result = await sendChunk(session.uploadId, { offset, data: btoa(binary) });
    if (result.done === true) {
      const path = result.path;
      if (typeof path !== 'string' || !(isCatalogImagePath(path) || isAdminImagePath(path) || isAdminFontPath(path)) ||
          !path.startsWith(`catalog/${kind}/${ownerId}/`) || typeof result.name !== 'string' || typeof result.url !== 'string') throw new Error('Resposta de envio administrativo inválida.');
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.port || url.username || url.password ||
          url.pathname !== `/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}`) throw new Error('URL do arquivo administrativo inválida.');
      return { path, name: result.name, url: result.url };
    }
    if (result.done !== false || !Number.isSafeInteger(result.offset) || (result.offset as number) < 0 || (result.offset as number) >= blob.size) throw new Error('Resposta de envio administrativo inválida.');
    const next = result.offset as number; stalls = next <= offset ? stalls + 1 : 0;
    if (stalls > 3) throw new Error('Não foi possível continuar o envio administrativo.');
    offset = next;
  }
  throw new Error('O envio administrativo não foi concluído.');
}
