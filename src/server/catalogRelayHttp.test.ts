import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test, { after, before, beforeEach, mock } from 'node:test';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { runCatalogRelayUpload } from '../services/catalogRelayClient.js';
import app from './app.js';

let server: Server;
let baseUrl: string;
let firebaseApp: App;
const localFetch = globalThis.fetch;
const docs = new Map<string, Record<string, unknown>>();
const objects = new Map<string, { path: string; metadata: Record<string, unknown>; bytes: Buffer; size: number; finished: boolean }>();
let queue: Promise<unknown> = Promise.resolve();
const keys = ['ARTWORK_UPLOAD_RELAY_MODE', 'FIREBASE_APP_CHECK_MODE', 'LOG_LEVEL', 'FIREBASE_STORAGE_BUCKET', 'FIREBASE_FIRESTORE_DATABASE_ID'] as const;
const previous = new Map(keys.map(key => [key, process.env[key]]));

before(async () => {
  process.env.LOG_LEVEL = 'silent';
  process.env.FIREBASE_APP_CHECK_MODE = 'off';
  process.env.FIREBASE_STORAGE_BUCKET = 'demo-relay-http.appspot.com';
  process.env.FIREBASE_FIRESTORE_DATABASE_ID = 'relay-http-test';
  firebaseApp = initializeApp({ projectId: 'demo-relay-http' });
  const auth = getAuth(firebaseApp);
  const db = getFirestore(firebaseApp, 'relay-http-test');
  mock.method(auth, 'verifyIdToken', async (_token: string, checkRevoked?: boolean) => {
    assert.equal(checkRevoked, true);
    return { uid: 'alice', admin: true } as unknown as DecodedIdToken;
  });
  mock.method(auth, 'getUser', async () => ({ uid: 'alice', disabled: false, customClaims: { admin: true } }) as never);
  const ref = (path: string) => ({ path, async get() { const data = docs.get(path); return { exists: Boolean(data), data: () => data }; }, async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
    docs.set(path, options?.merge ? { ...docs.get(path), ...data } : { ...data });
  } });
  type Ref = ReturnType<typeof ref>;
  const set = (target: Ref, data: Record<string, unknown>, merge = true) => {
    const result: Record<string, unknown> = merge ? { ...docs.get(target.path) } : {};
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && value.constructor.name === 'DeleteTransform') delete result[key];
      else result[key] = value;
    }
    docs.set(target.path, result);
  };
  const tx = {
    async get(target: Ref) { const data = docs.get(target.path); return { exists: Boolean(data), data: () => data }; },
    set(target: Ref, data: Record<string, unknown>) { set(target, data, false); },
    update(target: Ref, data: Record<string, unknown>) { set(target, data); },
    create(target: Ref, data: Record<string, unknown>) { set(target, data, false); },
  };
  mock.method(db, 'collection', ((name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) })) as unknown as typeof db.collection);
  mock.method(db, 'runTransaction', ((fn: (value: typeof tx) => Promise<unknown>) => {
    const result = queue.then(() => fn(tx)); queue = result.catch(() => undefined); return result;
  }) as unknown as typeof db.runTransaction);
  const storage = getStorage(firebaseApp);
  const fakeBucket = {
    name: process.env.FIREBASE_STORAGE_BUCKET,
    file(path: string) { return {
      async createResumableUpload(options: { metadata: Record<string, unknown> }) {
        const id = String(objects.size + 1);
        objects.set(id, { path, metadata: options.metadata, bytes: Buffer.alloc(0), size: 0, finished: false });
        return [`https://storage.googleapis.com/upload/storage/v1/b/demo-relay-http.appspot.com/o?uploadType=resumable&upload_id=${id}`];
      },
      async delete() {},
      async getMetadata() {
        const obj = [...objects.values()].find(value => value.path === path && value.finished);
        if (!obj) throw new Error('missing');
        return [{ size: String(obj.size), ...obj.metadata }];
      },
    }; },
  };
  mock.method(storage, 'bucket', (() => fakeBucket) as unknown as typeof storage.bucket);
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== 'storage.googleapis.com') return localFetch(input, init);
    const obj = objects.get(url.searchParams.get('upload_id') || '');
    assert.ok(obj);
    const range = new Headers(init?.headers).get('content-range') || '';
    if (range.startsWith('bytes */')) {
      obj.size = Number(range.slice(8));
      if (obj.finished) return new Response(null, { status: 200 });
      return new Response(null, { status: 308, headers: obj.bytes.length ? { Range: `bytes=0-${obj.bytes.length - 1}` } : {} });
    }
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    assert.ok(match);
    const start = Number(match[1]);
    const data = Buffer.from(init?.body as Buffer);
    obj.bytes = Buffer.concat([obj.bytes, data.subarray(obj.bytes.length - start)]);
    obj.size = Number(match[3]); obj.finished = obj.bytes.length === obj.size;
    return new Response(null, obj.finished ? { status: 200 } : { status: 308, headers: { Range: `bytes=0-${obj.bytes.length - 1}` } });
  };
  server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Servidor indisponível');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  globalThis.fetch = localFetch;
  mock.restoreAll();
  await deleteApp(firebaseApp);
  for (const key of keys) {
    const value = previous.get(key);
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});


beforeEach(() => {
  process.env.FIREBASE_APP_CHECK_MODE = 'off';
  docs.set('_adminAccess/alice', { schemaVersion: 1, enabled: true, epoch: 'legacy' });
  docs.set('_adminCatalogLeases/alice', { schemaVersion: 1, enabled: true, epoch: 'legacy', issuedAt: Date.now() - 1000, expiresAt: Date.now() + 3_600_000 });
});
async function send(path: string, body: unknown = {}, authenticated = true) {
  return localFetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer fake' } : {}) }, body: JSON.stringify(body) });
}
const startBody = { size: 2 * 1024 * 1024 + 32, contentType: 'image/png', name: 'capa.png', kind: 'products', ownerId: 'produto' };

test('exceção ausente, expirada ou autorização revogada não libera o parser grande', async () => {
  assert.equal((await send('/api/admin/catalog-uploads', {}, false)).status, 401);
  docs.delete('_adminCatalogLeases/alice');
  assert.equal((await send('/api/admin/catalog-uploads', { data: 'x'.repeat(1024 * 1024) })).status, 403);
  docs.set('_adminCatalogLeases/alice', { schemaVersion: 1, enabled: true, epoch: 'legacy', issuedAt: Date.now() - 2000, expiresAt: Date.now() - 1000 });
  assert.equal((await send('/api/admin/catalog-uploads')).status, 403);
});

test('exceção não substitui App Check', async () => {
  process.env.FIREBASE_APP_CHECK_MODE = 'enforce';
  assert.equal((await send('/api/admin/catalog-uploads')).status, 401);
});

test('revogação entre partes impede concluir o upload e também impede exclusão', async () => {
  const response = await send('/api/admin/catalog-uploads', startBody);
  assert.equal(response.status, 201);
  const session = await response.json() as { uploadId: string };
  docs.set('_adminAccess/alice', { schemaVersion: 1, enabled: false, epoch: 'legacy' });
  assert.equal((await send(`/api/admin/catalog-uploads/${session.uploadId}/chunk`, { offset: 0, data: 'x'.repeat(1024 * 1024) })).status, 403);
  assert.equal((await send('/api/admin/catalog-assets/delete', { path: 'catalog/products/produto/11111111111111111111111111111111.png' })).status, 403);
  assert.equal(objects.size, 1);
  assert.equal([...objects.values()][0].bytes.length, 0);
});

test('exceção ativa envia arquivo maior que 256 KiB e limita exclusão ao catálogo', async () => {
  const bytes = Buffer.alloc(startBody.size, 65);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  const request = async (path: string, data: unknown) => {
    const response = await send(path, data);const body = await response.json() as Record<string, unknown>;
    assert.equal(response.ok, true, JSON.stringify(body));return body;
  };
  const result = await runCatalogRelayUpload(new Blob([bytes], { type: 'image/png' }), 'capa.png', 'products', 'produto', String(process.env.FIREBASE_STORAGE_BUCKET),
    data => request('/api/admin/catalog-uploads', data),
    (id, data) => request(`/api/admin/catalog-uploads/${id}/chunk`, data));
  assert.match(result.path, /^catalog\/products\/produto\//);
  assert.equal((await send('/api/admin/catalog-assets/delete', { path: 'artworks/alice/orders/pedido/arte.png' })).status, 422);
  assert.equal((await send('/api/admin/catalog-assets/delete', { path: result.path })).status, 200);
});
