import assert from 'node:assert/strict';
import test from 'node:test';
import { ArtworkRelayError, sendArtworkRelayChunk, startArtworkRelay } from './artworkRelay.js';
import { runArtworkRelayUpload } from '../services/artworkRelayClient.js';
import type { getAdminServices } from './firebaseAdmin.js';

type Services = ReturnType<typeof getAdminServices>;

function fixture() {
  const docs = new Map<string, Record<string, unknown>>();
  const sessions = new Map<string, { path: string; size: number; metadata: Record<string, unknown>; bytes: Buffer; finished: boolean }>();
  let queue: Promise<unknown> = Promise.resolve();
  let uploads = 0;
  let loseResponse = false;
  const ref = (path: string) => ({
    path,
    async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
      docs.set(path, options?.merge ? { ...docs.get(path), ...data } : { ...data });
    },
  });
  type Ref = ReturnType<typeof ref>;
  const update = (r: Ref, data: Record<string, unknown>, merge = true) => {
    const next: Record<string, unknown> = merge ? { ...docs.get(r.path) } : {};
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && value.constructor.name === 'DeleteTransform') delete next[key];
      else next[key] = value;
    }
    docs.set(r.path, next);
  };
  const tx = {
    async get(r: Ref) { const data = docs.get(r.path); return { exists: Boolean(data), data: () => data }; },
    set(r: Ref, data: Record<string, unknown>) { update(r, data, false); },
    update(r: Ref, data: Record<string, unknown>) { update(r, data); },
    create(r: Ref, data: Record<string, unknown>) { if (docs.has(r.path)) throw new Error('duplicate'); update(r, data, false); },
  };
  const db = {
    collection(name: string) { return { doc(id: string) { return ref(`${name}/${id}`); } }; },
    runTransaction(fn: (transaction: typeof tx) => Promise<unknown>) {
      const current = queue.then(() => fn(tx));
      queue = current.catch(() => undefined);
      return current;
    },
  };
  const bucket = {
    name: 'demo.example',
    file(path: string) {
      return {
        async createResumableUpload(options: { metadata: { contentType: string; metadata: Record<string, string> }; preconditionOpts: unknown }) {
          assert.deepEqual(options.preconditionOpts, { ifGenerationMatch: 0 });
          const id = String(sessions.size + 1);
          sessions.set(id, { path, size: 0, metadata: options.metadata, bytes: Buffer.alloc(0), finished: false });
          return [`https://storage.googleapis.com/upload/storage/v1/b/demo.example/o?uploadType=resumable&upload_id=${id}`];
        },
        async getMetadata() {
          const session = [...sessions.values()].find(item => item.path === path && item.finished);
          if (!session) throw new Error('missing');
          return [{ size: String(session.size), ...session.metadata }];
        },
      };
    },
  };
  const fetchMock: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const session = sessions.get(url.searchParams.get('upload_id') || '');
    assert.ok(session);
    const range = new Headers(init?.headers).get('content-range');
    if (range?.startsWith('bytes */')) {
      session.size = Number(range.slice(8));
      if (session.finished) return new Response(null, { status: 200 });
      return new Response(null, { status: 308, headers: session.bytes.length ? { Range: `bytes=0-${session.bytes.length - 1}` } : {} });
    }
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range || '');
    assert.ok(m);
    const start = Number(m[1]); const end = Number(m[2]); const size = Number(m[3]);
    const data = Buffer.from(init?.body as Buffer);
    assert.equal(data.length, end - start + 1);
    assert.ok(start <= session.bytes.length);
    session.bytes = Buffer.concat([session.bytes, data.subarray(session.bytes.length - start)]);
    session.size = size;
    session.finished = session.bytes.length === size;
    uploads += 1;
    if (loseResponse) { loseResponse = false; throw new Error('URI fictícia e sensível'); }
    return new Response(null, session.finished ? { status: 200 } : { status: 308, headers: { Range: `bytes=0-${session.bytes.length - 1}` } });
  };
  return {
    services: { db, bucket } as unknown as Services, docs, sessions, fetchMock,
    getUploads: () => uploads, loseNextResponse: () => { loseResponse = true; },
  };
}

test('envia 15 MiB por partes e nunca devolve a URI de sessão', async () => {
  const f = fixture(); const size = 15 * 1024 * 1024;
  let uploadId = '';
  const file = new Blob([Buffer.alloc(size, 65)], { type: 'image/png' });
  const result = await runArtworkRelayUpload(file, 'arte.png', 'source-artwork', 'alice', async input => {
    const start = await startArtworkRelay(f.services, 'alice', input);
    uploadId = start.uploadId;
    assert.doesNotMatch(JSON.stringify(start), /storage\.googleapis|upload_id/);
    return start;
  }, async (id, chunk) => {
    const response = await sendArtworkRelayChunk(f.services, 'alice', id, chunk.offset, chunk.data, f.fetchMock);
    assert.doesNotMatch(JSON.stringify(response), /storage\.googleapis|upload_id/);
    return response;
  });
  assert.match(result.path, /^artworks\/alice\/pending\/[a-f0-9]{32}\.png$/);
  assert.equal(f.getUploads(), 8);
  const state = f.docs.get(`_artworkUploadSessions/${uploadId}`);
  assert.equal(state?.phase, 'complete');
  assert.equal('sessionUrl' in (state || {}), false);
  assert.equal([...f.sessions.values()][0].bytes.length, size);
});

test('retoma a parte persistida mesmo quando a resposta anterior se perde', async () => {
  const f = fixture(); const size = 2 * 1024 * 1024 + 3;
  const start = await startArtworkRelay(f.services, 'alice', { size, contentType: 'application/pdf', name: 'x.pdf', kind: 'source-artwork' });
  const first = Buffer.alloc(start.chunkBytes, 3).toString('base64');
  f.loseNextResponse();
  await assert.rejects(sendArtworkRelayChunk(f.services, 'alice', start.uploadId, 0, first, f.fetchMock), (e: ArtworkRelayError) => e.code === 'ARTWORK_UPLOAD_UNAVAILABLE' && !e.message.includes('URI'));
  const retry = await sendArtworkRelayChunk(f.services, 'alice', start.uploadId, 0, first, f.fetchMock);
  assert.equal(retry.done, false);
  assert.equal('offset' in retry && retry.offset, start.chunkBytes);
  const final = await sendArtworkRelayChunk(f.services, 'alice', start.uploadId, start.chunkBytes, Buffer.from('abc').toString('base64'), f.fetchMock);
  assert.equal(final.done, true);
  assert.equal(f.getUploads(), 2);
});

test('recusa outra conta, dados inválidos e arquivo maior que o limite', async () => {
  const f = fixture();
  const start = await startArtworkRelay(f.services, 'alice', { size: 3, contentType: 'image/png', name: 'x', kind: 'source-artwork' });
  await assert.rejects(sendArtworkRelayChunk(f.services, 'bob', start.uploadId, 0, 'YWJj', f.fetchMock), (e: ArtworkRelayError) => e.status === 404);
  await assert.rejects(sendArtworkRelayChunk(f.services, 'alice', start.uploadId, 0, '***', f.fetchMock), (e: ArtworkRelayError) => e.status === 422);
  await assert.rejects(startArtworkRelay(f.services, 'alice', { size: 15 * 1024 * 1024 + 1, contentType: 'image/png', name: 'x', kind: 'source-artwork' }), (e: ArtworkRelayError) => e.status === 422);
  assert.equal(f.getUploads(), 0);
});

test('reserva quantidade de forma transacional e recusa a 101ª autorização', async () => {
  const f = fixture();
  const results = await Promise.allSettled(Array.from({ length: 101 }, () => startArtworkRelay(f.services, 'alice', { size: 1, contentType: 'image/png', name: 'x', kind: 'source-artwork' })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 100);
  const denied = results.find(r => r.status === 'rejected');
  assert.ok(denied && denied.status === 'rejected' && denied.reason instanceof ArtworkRelayError && denied.reason.status === 429);
});

test('aplica limite de bytes mesmo antes do limite de quantidade', async () => {
  const f = fixture();
  const input = { size: 15 * 1024 * 1024, contentType: 'image/png', name: 'x', kind: 'source-artwork' };
  const results = await Promise.allSettled(Array.from({ length: 35 }, () => startArtworkRelay(f.services, 'alice', input)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 34);
  assert.ok(results.some(r => r.status === 'rejected' && r.reason instanceof ArtworkRelayError && r.reason.status === 429));
});

test('impede duas operações simultâneas na mesma sessão', async () => {
  const f = fixture();
  const start = await startArtworkRelay(f.services, 'alice', { size: 3, contentType: 'image/png', name: 'x', kind: 'source-artwork' });
  let continueQuery: () => void = () => undefined;
  let startedQuery: () => void = () => undefined;
  const running = new Promise<void>(resolve => { startedQuery = resolve; });
  const gate = new Promise<void>(resolve => { continueQuery = resolve; });
  const delayed: typeof fetch = async (input, init) => { startedQuery(); await gate; return f.fetchMock(input, init); };
  const first = sendArtworkRelayChunk(f.services, 'alice', start.uploadId, 0, 'YWJj', delayed);
  await running;
  await assert.rejects(sendArtworkRelayChunk(f.services, 'alice', start.uploadId, 0, 'YWJj', f.fetchMock), (e: ArtworkRelayError) => e.status === 409);
  continueQuery();
  assert.equal((await first).done, true);
});

test('recusa sessão expirada e URI de sessão adulterada', async () => {
  const f = fixture();
  const start = await startArtworkRelay(f.services, 'alice', { size: 3, contentType: 'image/png', name: 'x', kind: 'source-artwork' });
  const doc = f.docs.get(`_artworkUploadSessions/${start.uploadId}`);
  assert.ok(doc);
  doc.expiresAt = Date.now() - 1;
  await assert.rejects(sendArtworkRelayChunk(f.services, 'alice', start.uploadId, 0, 'YWJj', f.fetchMock), (e: ArtworkRelayError) => e.status === 410);
  doc.expiresAt = Date.now() + 1000;
  doc.sessionUrl = 'https://example.invalid/private-secret';
  await assert.rejects(sendArtworkRelayChunk(f.services, 'alice', start.uploadId, 0, 'YWJj', f.fetchMock), (e: ArtworkRelayError) => e.status === 503 && !e.message.includes('private-secret'));
  assert.equal(f.getUploads(), 0);
});
