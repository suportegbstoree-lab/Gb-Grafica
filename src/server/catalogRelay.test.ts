import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogRelayError, sendCatalogRelayChunk, startCatalogRelay } from './catalogRelay.js';
import { runCatalogRelayUpload } from '../services/catalogRelayClient.js';
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


const png = (size = 64) => { const bytes = Buffer.alloc(size, 65); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); return bytes; };
const input = { size: 64, contentType: 'image/png', name: 'capa.png', kind: 'products', ownerId: 'produto' };

test('envia 8 MiB por partes, preserva metadados e não expõe a URI de sessão', async () => {
  const f = fixture(); const bytes = png(8 * 1024 * 1024);
  const result = await runCatalogRelayUpload(new Blob([bytes], { type: 'image/png' }), 'capa.png', 'products', 'produto', 'demo.example',
    data => startCatalogRelay(f.services, 'alice', data),
    (id, data) => sendCatalogRelayChunk(f.services, 'alice', id, data.offset, data.data, f.fetchMock));
  assert.match(result.path, /^catalog\/products\/produto\/[a-f0-9]{32}[.]png$/);
  assert.match(result.url, /^https:\/\/firebasestorage[.]googleapis[.]com/);
  assert.equal(f.getUploads(), 4);
  const object = [...f.sessions.values()][0];
  assert.deepEqual(object.bytes, bytes);
  assert.equal((object.metadata.metadata as Record<string, string>).uploadedBy, 'alice');
  assert.doesNotMatch(JSON.stringify(result), /upload_id|sessionUrl/);
});

test('valida tipo, tamanho, destino e assinatura antes de publicar', async () => {
  const f = fixture();
  for (const invalid of [{ ...input, kind: 'artworks' }, { ...input, ownerId: '../x' }, { ...input, size: 8 * 1024 * 1024 + 1 }, { ...input, contentType: 'application/pdf' }]) {
    await assert.rejects(startCatalogRelay(f.services, 'alice', invalid), (error: CatalogRelayError) => error.status === 422);
  }
  const start = await startCatalogRelay(f.services, 'alice', input);
  await assert.rejects(sendCatalogRelayChunk(f.services, 'alice', start.uploadId, 0, Buffer.alloc(64).toString('base64'), f.fetchMock), (error: CatalogRelayError) => error.status === 422);
  assert.equal(f.getUploads(), 0);
});

test('sessão não pode ser usada por outra conta nem após expirar', async () => {
  const f = fixture(); const start = await startCatalogRelay(f.services, 'alice', input);
  await assert.rejects(sendCatalogRelayChunk(f.services, 'bob', start.uploadId, 0, png().toString('base64'), f.fetchMock), (error: CatalogRelayError) => error.status === 404);
  f.docs.get(`_catalogUploadSessions/${start.uploadId}`)!.expiresAt = Date.now() - 1;
  await assert.rejects(sendCatalogRelayChunk(f.services, 'alice', start.uploadId, 0, png().toString('base64'), f.fetchMock), (error: CatalogRelayError) => error.status === 410);
});

test('retentativa após resposta perdida não duplica bytes', async () => {
  const f = fixture(); const start = await startCatalogRelay(f.services, 'alice', input);
  f.loseNextResponse();
  await assert.rejects(sendCatalogRelayChunk(f.services, 'alice', start.uploadId, 0, png().toString('base64'), f.fetchMock));
  const result = await sendCatalogRelayChunk(f.services, 'alice', start.uploadId, 0, png().toString('base64'), f.fetchMock);
  assert.equal(result.done, true); assert.equal(f.getUploads(), 1);
});

test('fonte WOFF2 usa namespace próprio e assinatura obrigatória', async () => {
  const f = fixture(); const bytes = Buffer.alloc(32);bytes.write('wOF2');
  const result = await runCatalogRelayUpload(new Blob([bytes], { type: 'font/woff2' }), 'fonte.woff2', 'fonts', 'fonte', 'demo.example',
    data => startCatalogRelay(f.services, 'alice', data),
    (id, data) => sendCatalogRelayChunk(f.services, 'alice', id, data.offset, data.data, f.fetchMock));
  assert.match(result.path, /^catalog\/fonts\/fonte\/.*[.]woff2$/);
});
