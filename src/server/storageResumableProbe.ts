import { randomUUID } from 'node:crypto';
import type { getAdminServices } from './firebaseAdmin.js';

type Bucket = ReturnType<typeof getAdminServices>['bucket'];

export interface StorageProbeResult {
  ok: boolean;
  phase: 'session' | 'first_chunk' | 'last_chunk' | 'verify' | 'complete';
  cleanup: 'removed' | 'absent' | 'unknown';
  sessionCancellation: 'not_needed' | 'confirmed' | 'unknown';
}

export function storageProbePath(): string {
  return `_security-probe/resumable/${randomUUID()}.bin`;
}

function statusCode(error: unknown): number | null {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'number' ? code : typeof code === 'string' && /^\d{3}$/.test(code) ? Number(code) : null;
}

/** Esta função grava um objeto de teste e tenta removê-lo. Nunca imprime a URI da sessão. */
export async function probeStorageResumable(
  bucket: Bucket,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StorageProbeResult> {
  if (!/^_security-probe\/resumable\/[a-f0-9-]{36}\.bin$/.test(path)) {
    throw new Error('Caminho de teste inválido.');
  }
  const file = bucket.file(path);
  const first = Buffer.alloc(256 * 1024, 0x5a);
  const last = Buffer.from([1, 2, 3]);
  const total = first.length + last.length;
  // Marcador aleatório independente do nome: nunca remover um objeto que não é do teste.
  const probeId = randomUUID();
  let phase: StorageProbeResult['phase'] = 'session';
  let verified = false;
  let completed = false;
  let session = '';
  let sessionCancellation: StorageProbeResult['sessionCancellation'] = 'not_needed';

  try {
    const [uri] = await file.createResumableUpload({
      metadata: { contentType: 'application/octet-stream', metadata: { purpose: 'security-test', probeId } },
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    const parsed = new URL(uri);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'storage.googleapis.com' || parsed.username || parsed.password || parsed.port) {
      throw new Error('Endpoint de sessão inesperado.');
    }
    session = uri;
    const send = (data: Buffer, start: number) => fetchImpl(session, {
      method: 'PUT', redirect: 'manual', signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Range': `bytes ${start}-${start + data.length - 1}/${total}` },
      body: data,
    });
    phase = 'first_chunk';
    const firstResponse = await send(first, 0);
    if (firstResponse.status !== 308 || firstResponse.headers.get('range')?.toLowerCase() !== `bytes=0-${first.length - 1}`) {
      throw new Error('Resposta inesperada para a primeira parte.');
    }
    phase = 'last_chunk';
    const lastResponse = await send(last, first.length);
    if (lastResponse.status !== 200 && lastResponse.status !== 201) throw new Error('Resposta inesperada para a parte final.');
    completed = true;
    phase = 'verify';
    const [downloaded] = await file.download({ validation: false });
    const [metadata] = await file.getMetadata();
    if (!downloaded.equals(Buffer.concat([first, last])) || metadata.metadata?.purpose !== 'security-test' || metadata.metadata?.probeId !== probeId) {
      throw new Error('Objeto de teste divergente.');
    }
    verified = true;
    phase = 'complete';
  } catch {
    // Não propagamos erros HTTP, que podem conter a URI autenticada da sessão.
  }

  if (session && !completed) {
    sessionCancellation = 'unknown';
    try {
      const response = await fetchImpl(session, { method: 'DELETE', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      if (response.ok || response.status === 499) sessionCancellation = 'confirmed';
    } catch { /* O objeto e a sessão serão informados como não confirmados. */ }
  }

  let cleanup: StorageProbeResult['cleanup'] = 'unknown';
  try {
    const [metadata] = await file.getMetadata();
    if (metadata.metadata?.purpose !== 'security-test' || metadata.metadata?.probeId !== probeId) {
      throw new Error('O objeto não pertence ao teste.');
    }
    const generation = String(metadata.generation ?? '');
    if (!/^[1-9]\d*$/.test(generation)) throw new Error('Geração inválida.');
    await bucket.file(path, { preconditionOpts: { ifGenerationMatch: generation } }).delete();
    cleanup = 'removed';
  } catch (error) {
    if (statusCode(error) === 404) cleanup = 'absent';
  }
  return { ok: verified && cleanup === 'removed', phase, cleanup, sessionCancellation };
}
