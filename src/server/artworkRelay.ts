import { createHash, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { artworkExtension, isAllowedArtwork, sanitizeArtworkName } from '../lib/artwork.js';
import { isComposablePersonalizationImage } from '../lib/personalizationModel.js';
import type { getAdminServices } from './firebaseAdmin.js';

type Services = ReturnType<typeof getAdminServices>;
type Kind = 'source-artwork' | 'personalization-model';
const CHUNK_BYTES = 2 * 1024 * 1024;
const WINDOW_MS = 60 * 60_000;
const SESSION_MS = 30 * 60_000;
const LEASE_MS = 120_000;
const MAX_UPLOADS = 100;
const MAX_BYTES = 512 * 1024 * 1024;

export class ArtworkRelayError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

function error(status: number, code: string, message: string): never {
  throw new ArtworkRelayError(status, code, message);
}

function validSessionUrl(value: unknown, bucket: string): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'storage.googleapis.com' && !url.port &&
      !url.username && !url.password && url.pathname === `/upload/storage/v1/b/${encodeURIComponent(bucket)}/o` &&
      url.searchParams.get('uploadType') === 'resumable' && Boolean(url.searchParams.get('upload_id'));
  } catch { return false; }
}

function offsetFromRange(value: string | null, size: number): number {
  if (!value) return 0;
  const match = /^bytes=0-(\d+)$/i.exec(value.trim());
  const end = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(end) || end < 0 || end >= size) {
    return error(503, 'ARTWORK_UPLOAD_UNAVAILABLE', 'Não foi possível continuar o envio. Tente novamente.');
  }
  return end + 1;
}

export async function startArtworkRelay(
  services: Services,
  userId: string,
  input: { size?: unknown; contentType?: unknown; name?: unknown; kind?: unknown },
) {
  const { size, contentType, kind } = input;
  if (!userId || userId.length > 128 || /[/\\\x00-\x1f\x7f]/.test(userId) ||
      !Number.isSafeInteger(size) || !isAllowedArtwork(contentType, size) ||
      (kind !== 'source-artwork' && kind !== 'personalization-model') ||
      (kind === 'personalization-model' && !isComposablePersonalizationImage(contentType, size)) ||
      typeof input.name !== 'string') {
    return error(422, 'ARTWORK_UPLOAD_INVALID', 'Arquivo inválido para envio.');
  }
  const mime = contentType as string;
  const fileSize = size as number;
  const uploadKind = kind as Kind;
  const extension = artworkExtension(mime);
  if (!extension) return error(422, 'ARTWORK_UPLOAD_INVALID', 'Formato de arquivo não permitido.');
  const name = sanitizeArtworkName(input.name);
  const sessionId = randomUUID().replace(/-/g, '');
  const fileId = randomUUID().replace(/-/g, '');
  const path = `artworks/${userId}/pending/${fileId}.${extension}`;
  const now = Date.now();
  const sessionRef = services.db.collection('_artworkUploadSessions').doc(sessionId);
  const budgetRef = services.db.collection('_artworkUploadBudgets').doc(createHash('sha256').update(userId).digest('hex'));

  await services.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(budgetRef);
    const current = snapshot.data();
    let count = 0; let bytes = 0; let resetAt = now + WINDOW_MS;
    if (snapshot.exists) {
      if (!Number.isSafeInteger(current?.count) || current.count < 0 ||
          !Number.isSafeInteger(current?.bytes) || current.bytes < 0 ||
          !Number.isSafeInteger(current?.resetAt) || current.resetAt < 0) {
        return error(503, 'ARTWORK_UPLOAD_UNAVAILABLE', 'Não foi possível autorizar o envio. Tente novamente.');
      }
      if (current.resetAt > now) { count = current.count; bytes = current.bytes; resetAt = current.resetAt; }
    }
    if (count >= MAX_UPLOADS || bytes > MAX_BYTES - fileSize) {
      return error(429, 'ARTWORK_UPLOAD_LIMIT', 'Limite temporário de envios atingido. Tente novamente mais tarde.');
    }
    transaction.set(budgetRef, { count: count + 1, bytes: bytes + fileSize, resetAt, cleanupAt: new Date(resetAt + 24 * 60 * 60_000) });
    transaction.create(sessionRef, {
      userId, path, name, kind: uploadKind, contentType: mime, size: fileSize,
      expiresAt: now + SESSION_MS, cleanupAt: new Date(now + SESSION_MS + 60 * 60_000), phase: 'starting', leaseUntil: 0,
    });
  });

  let uri = '';
  try {
    [uri] = await services.bucket.file(path).createResumableUpload({
      metadata: { contentType: mime, metadata: { ownerId: userId, kind: uploadKind, originalName: name } },
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    if (!validSessionUrl(uri, services.bucket.name)) throw new Error('URI inválida');
    await sessionRef.set({ phase: 'active', sessionUrl: uri }, { merge: true });
  } catch {
    if (validSessionUrl(uri, services.bucket.name)) {
      try {
        const response = await fetch(uri, { method: 'DELETE', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
        await response.body?.cancel().catch(() => undefined);
      } catch { /* sem registrar a URI */ }
    }
    await sessionRef.set({ phase: 'failed', sessionUrl: FieldValue.delete() }, { merge: true }).catch(() => undefined);
    return error(503, 'ARTWORK_UPLOAD_UNAVAILABLE', 'Não foi possível iniciar o envio. Tente novamente.');
  }
  return { uploadId: sessionId, chunkBytes: CHUNK_BYTES };
}

export async function sendArtworkRelayChunk(
  services: Services,
  userId: string,
  sessionId: string,
  offset: unknown,
  encoded: unknown,
  fetchImpl: typeof fetch = fetch,
) {
  if (!/^[a-f0-9]{32}$/.test(sessionId) || !Number.isSafeInteger(offset) || (offset as number) < 0 ||
      typeof encoded !== 'string' || encoded.length > Math.ceil(CHUNK_BYTES / 3) * 4 ||
      /[^A-Za-z0-9+/=]/.test(encoded)) {
    return error(422, 'ARTWORK_UPLOAD_INVALID', 'Parte do arquivo inválida.');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.length > CHUNK_BYTES || bytes.toString('base64') !== encoded) {
    return error(422, 'ARTWORK_UPLOAD_INVALID', 'Parte do arquivo inválida.');
  }
  const ref = services.db.collection('_artworkUploadSessions').doc(sessionId);
  const lease = randomUUID();
  const acquired = await services.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (!snapshot.exists || data?.userId !== userId) return error(404, 'ARTWORK_UPLOAD_NOT_FOUND', 'Envio não encontrado.');
    if (data.phase === 'complete') return { done: true, path: data.path, name: data.name } as const;
    if (data.phase !== 'active' || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now()) {
      return error(410, 'ARTWORK_UPLOAD_EXPIRED', 'Este envio expirou. Selecione o arquivo novamente.');
    }
    if (typeof data.leaseUntil === 'number' && data.leaseUntil > Date.now()) {
      return error(409, 'ARTWORK_UPLOAD_BUSY', 'Este envio ainda está sendo processado.');
    }
    if (!Number.isSafeInteger(data.size) || data.size <= 0 || !isAllowedArtwork(data.contentType, data.size) ||
        !validSessionUrl(data.sessionUrl, services.bucket.name) || typeof data.path !== 'string' || typeof data.name !== 'string' ||
        !['source-artwork', 'personalization-model'].includes(data.kind)) {
      return error(503, 'ARTWORK_UPLOAD_UNAVAILABLE', 'Não foi possível continuar o envio.');
    }
    if ((offset as number) >= data.size || bytes.length !== Math.min(CHUNK_BYTES, data.size - (offset as number))) {
      return error(422, 'ARTWORK_UPLOAD_INVALID', 'Parte do arquivo inválida.');
    }
    transaction.update(ref, { lease, leaseUntil: Date.now() + LEASE_MS });
    return { done: false, size: data.size as number, path: data.path as string, name: data.name as string,
      contentType: data.contentType as string, kind: data.kind as Kind, sessionUrl: data.sessionUrl as string } as const;
  });
  if (acquired.done) return acquired;

  const state = acquired as { size: number; path: string; name: string; contentType: string; kind: Kind; sessionUrl: string };
  let completed = false;
  try {
    const query = await fetchImpl(state.sessionUrl, {
      method: 'PUT', redirect: 'manual', signal: AbortSignal.timeout(25_000),
      headers: { 'Content-Range': `bytes */${state.size}`, 'Content-Length': '0' },
    });
    const queryRange = query.headers.get('range');
    await query.body?.cancel().catch(() => undefined);
    if (query.status !== 308 && query.status !== 200 && query.status !== 201) {
      return error(503, 'ARTWORK_UPLOAD_UNAVAILABLE', 'Não foi possível continuar o envio. Tente novamente.');
    }
    let remoteOffset = query.status === 308 ? offsetFromRange(queryRange, state.size) : state.size;
    if (query.status === 308 && remoteOffset < state.size && remoteOffset >= (offset as number) && remoteOffset < (offset as number) + bytes.length) {
      const response = await fetchImpl(state.sessionUrl, {
        method: 'PUT', redirect: 'manual', signal: AbortSignal.timeout(30_000), body: bytes,
        headers: { 'Content-Range': `bytes ${offset}-${(offset as number) + bytes.length - 1}/${state.size}` },
      });
      const responseRange = response.headers.get('range');
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 308) remoteOffset = offsetFromRange(responseRange, state.size);
      else if (response.status === 200 || response.status === 201) remoteOffset = state.size;
      else return error(503, 'ARTWORK_UPLOAD_UNAVAILABLE', 'Não foi possível continuar o envio. Tente novamente.');
    }
    if (remoteOffset < state.size) return { done: false, offset: remoteOffset } as const;
    const [metadata] = await services.bucket.file(state.path).getMetadata();
    if (Number(metadata.size) !== state.size || metadata.contentType !== state.contentType ||
        metadata.metadata?.ownerId !== userId || metadata.metadata?.kind !== state.kind) {
      return error(422, 'ARTWORK_UPLOAD_INVALID', 'Não foi possível validar o arquivo enviado.');
    }
    await services.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (snapshot.data()?.lease !== lease || snapshot.data()?.phase !== 'active') {
        return error(409, 'ARTWORK_UPLOAD_BUSY', 'Este envio ainda está sendo processado.');
      }
      transaction.update(ref, { phase: 'complete', sessionUrl: FieldValue.delete(), lease: FieldValue.delete(), leaseUntil: 0 });
    });
    completed = true;
    return { done: true, path: state.path, name: state.name } as const;
  } catch (caught) {
    if (caught instanceof ArtworkRelayError) throw caught;
    return error(503, 'ARTWORK_UPLOAD_UNAVAILABLE', 'Não foi possível continuar o envio. Tente novamente.');
  } finally {
    if (!completed) {
      await services.db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (snapshot.data()?.lease === lease && snapshot.data()?.phase === 'active') {
          transaction.update(ref, { lease: FieldValue.delete(), leaseUntil: 0 });
        }
      }).catch(() => undefined);
    }
  }
}
