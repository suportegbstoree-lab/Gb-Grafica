import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import {
  copyArtworkVersion,
  deleteArtworkVersion,
  parseArtworkObjectGeneration,
  readArtworkPrefix,
  type ArtworkObjectVersion,
  type ArtworkBucket,
} from './artworkObjectVersion.js';

const source: ArtworkObjectVersion = {
  path: 'artworks/user/pending/00000000000000000000000000000000.png',
  generation: 17,
  contentType: 'image/png',
  kind: 'source-artwork',
  originalName: 'arte.png',
};
const destination = 'artworks/user/orders/GB-123/item/00000000000000000000000000000000.png';

test('aceita somente gerações inteiras, positivas e sem perda de precisão', () => {
  assert.equal(parseArtworkObjectGeneration('1234567890123456'), 1234567890123456);
  assert.equal(parseArtworkObjectGeneration(17), 17);
  for (const invalid of ['', '0', '-1', '1.5', '001', '9007199254740992', null, undefined, Infinity]) {
    assert.equal(parseArtworkObjectGeneration(invalid), null);
  }
});

test('usa a geração validada na leitura e na limpeza, mesmo que outra seja enviada depois', async () => {
  const versions = new Map<number, Buffer>([[17, Buffer.from('versão original')]]);
  let current = 17;
  const fakeBucket = {
    file(_path: string, options?: { generation?: number; preconditionOpts?: { ifGenerationMatch: number } }) {
      const generation = options?.generation ?? current;
      return {
        async download() {
          const data = versions.get(generation);
          if (!data) throw new Error('Versão ausente');
          return [data];
        },
        async delete() {
          if (current !== options?.preconditionOpts?.ifGenerationMatch) throw new Error('Versão substituída');
          versions.delete(current);
        },
      };
    },
  } as unknown as ArtworkBucket;

  assert.equal((await readArtworkPrefix(fakeBucket, source.path, source.generation)).toString(), 'versão original');
  versions.set(18, Buffer.from('arquivo substituto'));
  current = 18;
  await assert.rejects(deleteArtworkVersion(fakeBucket, source), /Versão substituída/);
  assert.equal(versions.get(18)?.toString(), 'arquivo substituto');
  assert.equal(versions.has(17), true);
});

test('falha ao tentar copiar uma versão validada que já não existe', async () => {
  const fakeBucket = {
    file(path: string, options?: { generation?: number }) {
      if (path === destination) return { name: path };
      return {
        async copy() {
          assert.equal(options?.generation, 17);
          throw Object.assign(new Error('Geração removida'), { code: 404 });
        },
      };
    },
  } as unknown as ArtworkBucket;
  await assert.rejects(copyArtworkVersion(fakeBucket, source, destination, 'user'), /Geração removida/);
});

test('SDK do Storage envia a geração de origem e somente metadados permitidos na cópia', async () => {
  const app = initializeApp({ projectId: 'demo-artwork-test' }, 'artwork-object-version-test');
  const bucket = getStorage(app).bucket('demo-artwork-bucket');
  let captured: { qs?: Record<string, unknown>; json?: Record<string, unknown> } | undefined;
  const stub = mock.method(bucket, 'request', ((options: typeof captured, callback: (error: null, value: object) => void) => {
    captured = options;
    callback(null, { done: true });
  }) as unknown as typeof bucket.request);
  try {
    await copyArtworkVersion(bucket, source, destination, 'user');
    assert.equal(captured?.qs?.sourceGeneration, 17);
    assert.equal(captured?.json?.contentType, 'image/png');
    assert.equal(captured?.json?.cacheControl, 'private, no-store');
    assert.deepEqual(captured?.json?.metadata, {
      ownerId: 'user', kind: 'source-artwork', originalName: 'arte.png',
    });
    assert.ok(!JSON.stringify(captured).includes('firebaseStorageDownloadTokens'));
  } finally {
    stub.mock.restore();
    await deleteApp(app);
  }
});

test('SDK do Storage só remove o arquivo temporário se a geração atual for a validada', async () => {
  const app = initializeApp({ projectId: 'demo-artwork-test' }, 'artwork-object-delete-test');
  const bucket = getStorage(app).bucket('demo-artwork-bucket');
  let captured: { qs?: Record<string, unknown>; method?: string } | undefined;
  const stub = mock.method(bucket, 'request', ((options: typeof captured, callback: (error: null, value: object, response: object) => void) => {
    captured = options;
    callback(null, {}, {});
  }) as unknown as typeof bucket.request);
  try {
    await deleteArtworkVersion(bucket, source);
    assert.equal(captured?.method, 'DELETE');
    assert.equal(captured?.qs?.ifGenerationMatch, 17);
    assert.equal(captured?.qs?.generation, undefined);
  } finally {
    stub.mock.restore();
    await deleteApp(app);
  }
});
