import { createHash, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminFontPath, adminImagePath, isAdminFontPath, isAdminImagePath, isAllowedAdminFont, matchesWoff2Signature } from '../lib/adminAsset.js';
import { catalogImageExtension, isAllowedCatalogImage, isCatalogImagePath, isSafeCatalogProductId, matchesCatalogImageSignature, sanitizeCatalogImageName } from '../lib/catalogImage.js';
import type { getAdminServices } from './firebaseAdmin.js';

type Services = ReturnType<typeof getAdminServices>;
type Kind = 'products' | 'categories' | 'site' | 'promotions' | 'fonts';
function validAsset(mime: unknown, size: unknown): boolean { return typeof mime === 'string' && typeof size === 'number' && Number.isSafeInteger(size) && (isAllowedCatalogImage(mime, size) || (mime === 'font/woff2' && isAllowedAdminFont(mime, size))); }
function validPath(path: unknown): path is string { return typeof path === 'string' && (isCatalogImagePath(path) || isAdminImagePath(path) || isAdminFontPath(path)); }
const CHUNK_BYTES = 2 * 1024 * 1024;
const WINDOW_MS = 60 * 60_000;
const SESSION_MS = 30 * 60_000;
const LEASE_MS = 120_000;
const MAX_UPLOADS = 100;
const MAX_BYTES = 512 * 1024 * 1024;

export class CatalogRelayError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

function error(status: number, code: string, message: string): never {
  throw new CatalogRelayError(status, code, message);
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
    return error(503, 'CATALOG_UPLOAD_UNAVAILABLE', 'Não foi possível continuar o envio. Tente novamente.');
  }
  return end + 1;
}

export async function startCatalogRelay(
  services: Services,
  userId: string,
  input: { size?: unknown; contentType?: unknown; name?: unknown; kind?: unknown; ownerId?: unknown },
) {
  const { size, contentType, kind } = input;
  if (!userId || userId.length > 128 || /[/\\\x00-\x1f\x7f]/.test(userId) ||
      !validAsset(contentType, size) || !['products', 'categories', 'site', 'promotions', 'fonts'].includes(String(kind)) ||
      (kind === 'fonts' ? contentType !== 'font/woff2' : !isAllowedCatalogImage(contentType as string, size as number)) ||
      typeof input.ownerId !== 'string' || !isSafeCatalogProductId(input.ownerId) ||
      typeof input.name !== 'string') {
    return error(422, 'CATALOG_UPLOAD_INVALID', 'Arquivo inválido para envio.');
  }
  const mime = contentType as string;
  const fileSize = size as number;
  const uploadKind = kind as Kind;
  const extension = mime === 'font/woff2' ? 'woff2' : catalogImageExtension(mime);
  if (!extension) return error(422, 'CATALOG_UPLOAD_INVALID', 'Formato de arquivo não permitido.');
  const name = sanitizeCatalogImageName(input.name);
  const sessionId = randomUUID().replace(/-/g, '');
  const fileId = randomUUID().replace(/-/g, '');
  const path = uploadKind === 'products' ? `catalog/products/${input.ownerId}/${fileId}.${extension}` : uploadKind === 'fonts' ? adminFontPath(input.ownerId, fileId)! : adminImagePath(uploadKind, input.ownerId, fileId, mime)!;
  if (!validPath(path)) return error(422, 'CATALOG_UPLOAD_INVALID', 'Destino inválido.');
  const downloadToken = randomUUID();
  const now = Date.now();
  const sessionRef = services.db.collection('_catalogUploadSessions').doc(sessionId);
  const budgetRef = services.db.collection('_catalogUploadBudgets').doc(createHash('sha256').update(userId).digest('hex'));

  await services.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(budgetRef);
    const current = snapshot.data();
    let count = 0; let bytes = 0; let resetAt = now + WINDOW_MS;
    if (snapshot.exists) {
      if (!Number.isSafeInteger(current?.count) || current.count < 0 ||
          !Number.isSafeInteger(current?.bytes) || current.bytes < 0 ||
          !Number.isSafeInteger(current?.resetAt) || current.resetAt < 0) {
        return error(503, 'CATALOG_UPLOAD_UNAVAILABLE', 'Não foi possível autorizar o envio. Tente novamente.');
      }
      if (current.resetAt > now) { count = current.count; bytes = current.bytes; resetAt = current.resetAt; }
    }
    if (count >= MAX_UPLOADS || bytes > MAX_BYTES - fileSize) {
      return error(429, 'CATALOG_UPLOAD_LIMIT', 'Limite temporário de envios atingido. Tente novamente mais tarde.');
    }
    transaction.set(budgetRef, { count: count + 1, bytes: bytes + fileSize, resetAt, cleanupAt: new Date(resetAt + 24 * 60 * 60_000) });
    transaction.create(sessionRef, {
      userId, path, name, kind: uploadKind, contentType: mime, size: fileSize, downloadToken,
      expiresAt: now + SESSION_MS, cleanupAt: new Date(now + SESSION_MS + 60 * 60_000), phase: 'starting', leaseUntil: 0,
    });
  });

  let uri = '';
  try {
    [uri] = await services.bucket.file(path).createResumableUpload({
      metadata: { contentType: mime, cacheControl: 'public,max-age=31536000,immutable', metadata: { uploadedBy: userId, kind: uploadKind, originalName: name, firebaseStorageDownloadTokens: downloadToken } },
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
    return error(503, 'CATALOG_UPLOAD_UNAVAILABLE', 'Não foi possível iniciar o envio. Tente novamente.');
  }
  return { uploadId: sessionId, chunkBytes: CHUNK_BYTES };
}

export async function sendCatalogRelayChunk(
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
    return error(422, 'CATALOG_UPLOAD_INVALID', 'Parte do arquivo inválida.');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.length > CHUNK_BYTES || bytes.toString('base64') !== encoded) {
    return error(422, 'CATALOG_UPLOAD_INVALID', 'Parte do arquivo inválida.');
  }
  const ref = services.db.collection('_catalogUploadSessions').doc(sessionId);
  const lease = randomUUID();
  const acquired = await services.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (!snapshot.exists || data?.userId !== userId) return error(404, 'CATALOG_UPLOAD_NOT_FOUND', 'Envio não encontrado.');
    if (data.phase === 'complete') return { done: true, path: data.path, name: data.name, url: assetUrl(services.bucket.name, data.path, data.downloadToken) } as const;
    if (data.phase !== 'active' || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now()) {
      return error(410, 'CATALOG_UPLOAD_EXPIRED', 'Este envio expirou. Selecione o arquivo novamente.');
    }
    if (typeof data.leaseUntil === 'number' && data.leaseUntil > Date.now()) {
      return error(409, 'CATALOG_UPLOAD_BUSY', 'Este envio ainda está sendo processado.');
    }
    if (!Number.isSafeInteger(data.size) || data.size <= 0 || !validAsset(data.contentType, data.size) ||
        !validSessionUrl(data.sessionUrl, services.bucket.name) || !validPath(data.path) || typeof data.name !== 'string' ||
        !['products', 'categories', 'site', 'promotions', 'fonts'].includes(data.kind)) {
      return error(503, 'CATALOG_UPLOAD_UNAVAILABLE', 'Não foi possível continuar o envio.');
    }
    if ((offset as number) >= data.size || bytes.length !== Math.min(CHUNK_BYTES, data.size - (offset as number))) {
      return error(422, 'CATALOG_UPLOAD_INVALID', 'Parte do arquivo inválida.');
    }
    if (offset === 0 && !(data.contentType === 'font/woff2' ? matchesWoff2Signature(bytes) : matchesCatalogImageSignature(data.contentType, bytes))) return error(422, 'CATALOG_UPLOAD_INVALID', 'Conteúdo do arquivo inválido.');
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
      return error(503, 'CATALOG_UPLOAD_UNAVAILABLE', 'Não foi possível continuar o envio. Tente novamente.');
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
      else return error(503, 'CATALOG_UPLOAD_UNAVAILABLE', 'Não foi possível continuar o envio. Tente novamente.');
    }
    if (remoteOffset < state.size) return { done: false, offset: remoteOffset } as const;
    const [metadata] = await services.bucket.file(state.path).getMetadata();
    if (Number(metadata.size) !== state.size || metadata.contentType !== state.contentType ||
        metadata.metadata?.uploadedBy !== userId || metadata.metadata?.kind !== state.kind) {
      return error(422, 'CATALOG_UPLOAD_INVALID', 'Não foi possível validar o arquivo enviado.');
    }
    await services.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (snapshot.data()?.lease !== lease || snapshot.data()?.phase !== 'active') {
        return error(409, 'CATALOG_UPLOAD_BUSY', 'Este envio ainda está sendo processado.');
      }
      transaction.update(ref, { phase: 'complete', sessionUrl: FieldValue.delete(), lease: FieldValue.delete(), leaseUntil: 0 });
    });
    completed = true;
    return { done: true, path: state.path, name: state.name, url: assetUrl(services.bucket.name, state.path, metadata.metadata?.firebaseStorageDownloadTokens) } as const;
  } catch (caught) {
    if (caught instanceof CatalogRelayError) throw caught;
    return error(503, 'CATALOG_UPLOAD_UNAVAILABLE', 'Não foi possível continuar o envio. Tente novamente.');
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

function assetUrl(bucket: string, path: string, token: unknown): string {
  if (!validPath(path) || typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)) return error(503, 'CATALOG_UPLOAD_UNAVAILABLE', 'Não foi possível concluir o envio.');
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`;
}
