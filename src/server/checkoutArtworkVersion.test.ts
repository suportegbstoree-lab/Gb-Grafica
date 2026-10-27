import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import test, { before, beforeEach, after, mock } from 'node:test';
import axios from 'axios';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { currentLegalAcceptance } from '../lib/legal.js';
import app from './app.js';

const env = {
  NODE_ENV: 'production', APP_URL: 'https://loja.example.com', LOG_LEVEL: 'silent',
  PAGBANK_ENV: 'sandbox', PAGBANK_TOKEN: 'token-ficticio-de-teste', FIREBASE_APP_CHECK_MODE: 'off',
  FIREBASE_FIRESTORE_DATABASE_ID: 'artwork-checkout-test',
  FIREBASE_STORAGE_BUCKET: 'demo-artwork-checkout.firebasestorage.app',
};
const oldEnv = new Map(Object.keys(env).map(key => [key, process.env[key]]));
const localFetch = globalThis.fetch;
const docs = new Map<string, Record<string, unknown>>();
const objects = new Map<string, { generation: number; bytes: Buffer; metadata: Record<string, string> }>();
let firebaseApp: App;
let server: Server;
let baseUrl = '';
let uid = '';
let sourcePath = '';
let scenario = 0;
let replaceAtCopy = false;
let replaceAtDelete = false;
let replaceAtDownload = false;
let providerCalls = 0;
let copiedGeneration: number | undefined;
let copiedMetadata: Record<string, unknown> | undefined;
let copiedPath = '';
let copies: Array<{ path: string; generation: number | undefined }> = [];

function ref(path: string) {
  return {
    path,
    async get() { const value = docs.get(path); return { exists: value !== undefined, data: () => value }; },
    async set(value: Record<string, unknown>) { docs.set(path, { ...docs.get(path), ...value }); },
    async create(value: Record<string, unknown>) {
      if (docs.has(path)) throw new Error('Documento já existe');
      docs.set(path, value);
    },
  };
}
type Ref = ReturnType<typeof ref>;
const tx = {
  get: (r: Ref) => r.get(),
  create(r: Ref, value: Record<string, unknown>) { docs.set(r.path, value); },
  set(r: Ref, value: Record<string, unknown>) { docs.set(r.path, { ...docs.get(r.path), ...value }); },
  update(r: Ref, value: Record<string, unknown>) { docs.set(r.path, { ...docs.get(r.path), ...value }); },
};
function replaceSource() {
  objects.set(sourcePath, { generation: 18, bytes: Buffer.from('substituto'), metadata: { ownerId: uid, kind: 'source-artwork' } });
}
const fakeBucket = {
  file(path: string, options?: { generation?: number; preconditionOpts?: { ifGenerationMatch?: number } }) {
    return {
      name: path,
      async getMetadata() {
        const obj = objects.get(path);
        if (!obj) throw Object.assign(new Error('Objeto ausente'), { code: 404 });
        return [{ size: String(obj.bytes.length), generation: String(obj.generation), contentType: 'image/png', metadata: obj.metadata }];
      },
      async download() {
        if (replaceAtDownload) replaceSource();
        const obj = objects.get(path);
        if (!obj || obj.generation !== options?.generation) throw Object.assign(new Error('Geração ausente'), { code: 404 });
        return [obj.bytes.subarray(0, 16)];
      },
      async copy(dest: { name: string }, copyOptions: Record<string, unknown>) {
        if (replaceAtCopy) replaceSource();
        const obj = objects.get(path);
        if (!obj || obj.generation !== options?.generation) throw Object.assign(new Error('Geração substituída'), { code: 404 });
        copiedGeneration = options.generation;
        copiedMetadata = copyOptions;
        copiedPath = dest.name;
        copies.push({ path: dest.name, generation: options.generation });
        objects.set(dest.name, { generation: 50, bytes: obj.bytes, metadata: copyOptions.metadata as Record<string, string> });
        return [];
      },
      async delete() {
        if (path === sourcePath && replaceAtDelete) replaceSource();
        const obj = objects.get(path);
        if (!obj || (options?.preconditionOpts?.ifGenerationMatch !== undefined &&
          obj.generation !== options.preconditionOpts.ifGenerationMatch)) {
          throw Object.assign(new Error('Geração mudou'), { code: 412 });
        }
        objects.delete(path);
      },
    };
  },
};

before(async () => {
  Object.assign(process.env, env);
  firebaseApp = initializeApp({ projectId: 'demo-artwork-checkout' });
  const auth = getAuth(firebaseApp);
  const db = getFirestore(firebaseApp, env.FIREBASE_FIRESTORE_DATABASE_ID);
  const storage = getStorage(firebaseApp);
  mock.method(auth, 'verifyIdToken', async (_token: string, checkRevoked?: boolean) => {
    assert.equal(checkRevoked, true);
    return { uid, sub: uid, email: 'comprador@example.test', name: 'Cliente Teste' } as unknown as DecodedIdToken;
  });
  mock.method(db, 'collection', ((name: string) => ({
    doc: (id: string) => ref(`${name}/${id}`),
    get: async () => ({ docs: [] }),
  })) as unknown as typeof db.collection);
  mock.method(db, 'runTransaction', (async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx)) as unknown as typeof db.runTransaction);
  mock.method(db, 'batch', (() => {
    const writes: Array<[Ref, Record<string, unknown>]> = [];
    return {
      set(r: Ref, value: Record<string, unknown>) { writes.push([r, value]); },
      async commit() { for (const [r, value] of writes) await r.set(value); },
    };
  }) as unknown as typeof db.batch);
  mock.method(storage, 'bucket', (() => fakeBucket) as unknown as typeof storage.bucket);
  mock.method(axios, 'post', async () => {
    providerCalls += 1;
    return { status: 201, data: { id: 'CHEC_TEST123456', status: 'ACTIVE', links: [{ rel: 'PAY', href: 'https://pagamento.sandbox.pagbank.com.br/pagamento?code=test' }] } };
  });
  server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Servidor de teste indisponível');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  scenario += 1; uid = `user${scenario}`;
  sourcePath = `artworks/${uid}/pending/00000000000000000000000000000000.png`;
  replaceAtCopy = false; replaceAtDelete = false; replaceAtDownload = false; providerCalls = 0;
  copiedGeneration = undefined; copiedMetadata = undefined; copiedPath = ''; copies = [];
  docs.clear(); objects.clear();
  docs.set('config/main', {});
  docs.set('anuncios/produto', { nome: 'Produto Teste', desc: 'Arte teste', categoria: 'teste', preco_base: '10.00', tipoInput: 'arte' });
  objects.set(sourcePath, {
    generation: 17, bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]),
    metadata: { ownerId: uid, kind: 'source-artwork', originalName: 'arte.png', firebaseStorageDownloadTokens: 'TOKEN-FICTICIO' },
  });
});
after(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  mock.restoreAll();
  if (firebaseApp) await deleteApp(firebaseApp);
  for (const [key, value] of oldEnv) value === undefined ? delete process.env[key] : process.env[key] = value;
});
async function checkout(extraItem: Record<string, unknown> = {}) {
  return localFetch(`${baseUrl}/api/checkout`, {
    method: 'POST', headers: { authorization: 'Bearer usuario-teste', 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: randomUUID(), legalAcceptance: currentLegalAcceptance(), customerName: 'Cliente Teste',
      cpf: '52998224725', phone: '11987654321', deliveryMethod: 'retirada',
      items: [{ productId: 'produto', selecoes: {}, quantidade: 1, arquivoPath: sourcePath, arquivoNome: 'arte.png', ...extraItem }],
    }),
  });
}

test('checkout legítimo copia a geração validada e preserva o fluxo de pagamento', async () => {
  const response = await checkout();
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  assert.equal(providerCalls, 1);
  assert.equal(copiedGeneration, 17);
  assert.equal(copiedMetadata?.contentType, 'image/png');
  assert.deepEqual(copiedMetadata?.metadata, { ownerId: uid, kind: 'source-artwork', originalName: 'arte.png' });
  assert.ok(objects.has(copiedPath));
  assert.equal(objects.has(sourcePath), false);
  const order = [...docs.entries()].find(([path]) => path.startsWith('orders/'))?.[1];
  assert.ok(order);
  assert.equal((order.itens as Array<{ arquivoPath: string }>)[0].arquivoPath, copiedPath);
});

test('não cria checkout quando o arquivo é substituído após a validação', async () => {
  replaceAtCopy = true;
  const response = await checkout();
  assert.equal(response.status, 422);
  assert.equal(providerCalls, 0);
  assert.equal(objects.get(sourcePath)?.generation, 18);
  assert.ok(![...docs.keys()].some(path => path.startsWith('orders/')));
});

test('não valida assinatura de uma versão substituta após ler os metadados', async () => {
  replaceAtDownload = true;
  const response = await checkout();
  assert.equal(response.status, 422);
  assert.equal(providerCalls, 0);
  assert.equal(objects.get(sourcePath)?.generation, 18);
  assert.ok(![...docs.keys()].some(path => path.startsWith('orders/')));
});

test('limpeza após checkout não exclui arquivo substituto enviado ao mesmo caminho', async () => {
  replaceAtDelete = true;
  const response = await checkout();
  assert.equal(response.status, 201);
  assert.equal(providerCalls, 1);
  assert.equal(objects.get(sourcePath)?.generation, 18);
  assert.ok(objects.has(copiedPath));
});

test('checkout com texto e imagem copia separadamente as versões da arte e do modelo', async () => {
  const modelPath = `artworks/${uid}/pending/11111111111111111111111111111111.png`;
  docs.set('config/main', { fontes_personalizacao: [{ id: 'arial', nome: 'Arial', cssFamily: 'Arial', ativo: true }] });
  docs.set('anuncios/produto', { nome: 'Produto Teste', desc: 'Arte teste', categoria: 'teste', preco_base: '10.00', tipoInput: 'texto_arte' });
  objects.set(modelPath, {
    generation: 25, bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]),
    metadata: { ownerId: uid, kind: 'personalization-model', originalName: 'modelo.png' },
  });
  const response = await checkout({
    modeloPath: modelPath, modeloNome: 'modelo.png',
    personalizacaoTexto: { texto: 'Nome', fonte: 'arial', posicao: { x: 50, y: 50 } },
  });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  assert.deepEqual(copies.map(copy => copy.generation), [17, 25]);
  assert.ok(copies.every(copy => objects.has(copy.path)));
  assert.equal(objects.has(sourcePath), false);
  assert.equal(objects.has(modelPath), false);
});
