import assert from 'node:assert/strict';
import test from 'node:test';
import { probeStorageResumable, storageProbePath } from './storageResumableProbe.js';
import type { getAdminServices } from './firebaseAdmin.js';

type Bucket = ReturnType<typeof getAdminServices>['bucket'];

function fixture(options: { firstStatus?: number; cleanupError?: boolean; foreignObject?: boolean } = {}) {
  let objectExists = Boolean(options.foreignObject);
  let cancelled = false;
  let deleted = false;
  let calls = 0;
  let startOptions: Record<string, unknown> | undefined;
  let deleteOptions: unknown;
  const pieces: Buffer[] = [];
  const uri = 'https://storage.googleapis.com/test-session-secret';
  const file = {
    async createResumableUpload(config: Record<string, unknown>) {
      startOptions = config;
      if (options.foreignObject) throw Object.assign(new Error('já existe'), { code: 412 });
      return [uri];
    },
    async download() { return [Buffer.concat(pieces)]; },
    async getMetadata() {
      if (options.cleanupError && objectExists) throw Object.assign(new Error('secret'), { code: 403 });
      if (!objectExists) throw Object.assign(new Error('absent'), { code: 404 });
      const metadata = options.foreignObject ? { purpose: 'outro-objeto' }
        : (startOptions?.metadata as { metadata?: Record<string, string> })?.metadata;
      return [{ generation: '42', metadata }];
    },
    async delete() { objectExists = false; deleted = true; },
  };
  const bucket = { file(_path: string, config?: unknown) { if (config) deleteOptions = config; return file; } } as unknown as Bucket;
  const fakeFetch: typeof fetch = async (url, init) => {
    assert.equal(String(url), uri);
    if (init?.method === 'DELETE') { cancelled = true; return new Response(null, { status: 499 }); }
    assert.equal(init?.method, 'PUT');
    calls += 1;
    const body = init?.body as Buffer;
    pieces.push(Buffer.from(body));
    if (calls === 1) {
      assert.equal(new Headers(init?.headers).get('content-range'), 'bytes 0-262143/262147');
      return new Response(null, { status: options.firstStatus ?? 308, headers: { Range: 'bytes=0-262143' } });
    }
    assert.equal(new Headers(init?.headers).get('content-range'), 'bytes 262144-262146/262147');
    objectExists = true;
    return new Response(null, { status: 200 });
  };
  return { bucket, fakeFetch, state: () => ({ cancelled, deleted, calls, startOptions, deleteOptions }) };
}

test('valida duas partes, integridade e remoção condicionada à geração', async () => {
  const f = fixture();
  const result = await probeStorageResumable(f.bucket, storageProbePath(), f.fakeFetch);
  assert.deepEqual(result, { ok: true, phase: 'complete', cleanup: 'removed', sessionCancellation: 'not_needed' });
  assert.equal(f.state().calls, 2);
  assert.equal(f.state().deleted, true);
  assert.deepEqual(f.state().deleteOptions, { preconditionOpts: { ifGenerationMatch: '42' } });
  assert.deepEqual(f.state().startOptions?.preconditionOpts, { ifGenerationMatch: 0 });
  assert.doesNotMatch(JSON.stringify(result), /test-session-secret/);
});

test('cancela uma sessão incompleta e não considera 200 na primeira parte um sucesso', async () => {
  const f = fixture({ firstStatus: 200 });
  const result = await probeStorageResumable(f.bucket, storageProbePath(), f.fakeFetch);
  assert.deepEqual(result, { ok: false, phase: 'first_chunk', cleanup: 'absent', sessionCancellation: 'confirmed' });
  assert.equal(f.state().cancelled, true);
  assert.equal(f.state().calls, 1);
});

test('não declara sucesso quando a limpeza não pode ser confirmada', async () => {
  const f = fixture();
  let reads = 0;
  const original = f.bucket.file.bind(f.bucket);
  const bucket = { file(path: string, opts?: unknown) {
    const file = original(path, opts as never);
    const getMetadata = file.getMetadata.bind(file);
    file.getMetadata = (async (...args: unknown[]) => {
      reads += 1;
      if (reads === 2) throw Object.assign(new Error('secret'), { code: 403 });
      return getMetadata(...args as []);
    }) as typeof file.getMetadata;
    return file;
  } } as unknown as Bucket;
  const result = await probeStorageResumable(bucket, storageProbePath(), f.fakeFetch);
  assert.equal(result.ok, false);
  assert.equal(result.cleanup, 'unknown');
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('não envia dados a uma URI de sessão fora do endpoint esperado do Google', async () => {
  const f = fixture();
  const file = f.bucket.file('ignored');
  file.createResumableUpload = (async () => ['https://example.invalid/session-secret']) as typeof file.createResumableUpload;
  const result = await probeStorageResumable(f.bucket, storageProbePath(), async () => {
    throw new Error('Nenhuma requisição deveria ser enviada.');
  });
  assert.equal(result.ok, false);
  assert.equal(result.phase, 'session');
  assert.equal(result.cleanup, 'absent');
  assert.doesNotMatch(JSON.stringify(result), /session-secret/);
});

test('nunca remove um objeto existente que não pertence ao teste', async () => {
  const f = fixture({ foreignObject: true });
  const result = await probeStorageResumable(f.bucket, storageProbePath(), f.fakeFetch);
  assert.equal(result.ok, false);
  assert.equal(result.cleanup, 'unknown');
  assert.equal(f.state().deleted, false);
});
