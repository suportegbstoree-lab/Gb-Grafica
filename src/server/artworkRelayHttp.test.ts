import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test, { after, before, mock } from 'node:test';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { runArtworkRelayUpload } from '../services/artworkRelayClient.js';
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
    return { uid: 'alice' } as unknown as DecodedIdToken;
  });
  const ref = (path: string) => ({ path, async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
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

test('rota desativada retorna 404 sem alterar o comportamento padrão', async () => {
  delete process.env.ARTWORK_UPLOAD_RELAY_MODE;
  const response = await fetch(`${baseUrl}/api/artwork-uploads`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(response.status, 404);
});

test('limite de 3 MiB é restrito à rota de partes e ainda exige autenticação', async () => {
  process.env.ARTWORK_UPLOAD_RELAY_MODE = 'enabled';
  const body = JSON.stringify({ data: 'a'.repeat(1024 * 1024) });
  const relay = await fetch(`${baseUrl}/api/artwork-uploads`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake' }, body,
  });
  assert.equal(relay.status, 422);
  const unauthenticated = await fetch(`${baseUrl}/api/artwork-uploads`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  assert.equal(unauthenticated.status, 401);
  const ordinary = await fetch(`${baseUrl}/api/shipping-quote`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  assert.equal(ordinary.status, 413);
});

test('rota respeita a exigência do App Check quando configurada', async () => {
  process.env.ARTWORK_UPLOAD_RELAY_MODE = 'enabled';
  process.env.FIREBASE_APP_CHECK_MODE = 'enforce';
  try {
    const response = await fetch(`${baseUrl}/api/artwork-uploads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake' }, body: '{}',
    });
    assert.equal(response.status, 401);
    const body = await response.json() as { code?: string };
    assert.equal(body.code, 'APP_CHECK_REQUIRED');
  } finally { process.env.FIREBASE_APP_CHECK_MODE = 'off'; }
});

test('cliente envia arquivo em partes pela API autenticada e recebe caminho da própria conta', async () => {
  process.env.ARTWORK_UPLOAD_RELAY_MODE = 'enabled';
  const size = 4 * 1024 * 1024 + 3;
  const blob = new Blob([Buffer.alloc(size, 0x42)], { type: 'image/png' });
  const send = async (path: string, body: unknown) => {
    const response = await localFetch(`${baseUrl}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake' }, body: JSON.stringify(body),
    });
    const data = await response.json() as Record<string, unknown>;
    assert.equal(response.ok, true, JSON.stringify(data));
    assert.doesNotMatch(JSON.stringify(data), /storage\.googleapis|upload_id/);
    return data;
  };
  const result = await runArtworkRelayUpload(blob, 'arte.png', 'source-artwork', 'alice',
    data => send('/api/artwork-uploads', data),
    (id, data) => send(`/api/artwork-uploads/${id}/chunk`, data));
  assert.match(result.path, /^artworks\/alice\/pending\/[a-f0-9]{32}\.png$/);
  const object = [...objects.values()].find(value => value.path === result.path);
  assert.equal(object?.bytes.length, size);
});
