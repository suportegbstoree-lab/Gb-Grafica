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
      async exists() { return [objects.has(path)]; },
      async getSignedUrl() { return [`https://storage.example.test/${path}`]; },
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
      items: [{ productId: 'produto', selecoes: {}, quantidade: 1, arquivoPath: sourcePath, arquivoNome: 'arte.png', aprovarArte: true, ...extraItem }],
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
    personalizacaoTexto: { texto: 'Nome\nSobrenome', fonte: 'arial', tamanhoFonte: 8.5, cor: '#00aaff', posicao: { x: 50, y: 50 } },
  });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const order = [...docs.entries()].find(([path]) => path.startsWith('orders/'))?.[1];
  const style = (order?.itens as Array<{ personalizacaoTexto: { texto: string; tamanhoFonte: number; cor: string } }>)[0].personalizacaoTexto;
  assert.equal(style.texto, 'Nome\nSobrenome'); assert.equal(style.tamanhoFonte, 8.5); assert.equal(style.cor, '#00aaff');
  assert.deepEqual(copies.map(copy => copy.generation), [17, 25]);
  assert.ok(copies.every(copy => objects.has(copy.path)));
  assert.equal(objects.has(sourcePath), false);
  assert.equal(objects.has(modelPath), false);
});

function addModel(digit: string, generation: number, metadata: Record<string, string> = {}) {
  const path = `artworks/${uid}/pending/${digit.repeat(32)}.png`;
  objects.set(path, {
    generation, bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]),
    metadata: { ownerId: uid, kind: 'personalization-model', originalName: 'modelo.png', ...metadata },
  });
  return path;
}

test('caderno sem texto preserva capa e contracapa no pedido e copia as três versões', async () => {
  const front = addModel('1', 25);
  const back = addModel('2', 26);
  const response = await checkout({ modeloPath: front, contracapaPath: back, contracapaNome: 'contracapa.png', contracapaModo: 'custom' });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  assert.deepEqual(copies.map(copy => copy.generation), [17, 25, 26]);
  const order = [...docs.entries()].find(([path]) => path.startsWith('orders/'))?.[1];
  const item = (order?.itens as Array<Record<string, unknown>>)[0];
  assert.equal(item.contracapaPath, copies[2].path);
  assert.equal(item.contracapaNome, 'contracapa.png');
  assert.equal(item.contracapaModo, 'custom');
  assert.equal(objects.has(back), false);
});

test('recusa contracapa pertencente a outro usuário antes de chamar PagBank', async () => {
  const response = await checkout({ modeloPath: addModel('1', 25), contracapaPath: 'artworks/outro/pending/22222222222222222222222222222222.png', contracapaModo: 'custom' });
  assert.equal(response.status, 422);
  assert.equal(providerCalls, 0);
});

test('recusa contracapa com metadados de proprietário incompatíveis', async () => {
  const response = await checkout({ modeloPath: addModel('1', 25), contracapaPath: addModel('2', 26, { ownerId: 'outro' }), contracapaModo: 'automatic' });
  assert.equal(response.status, 422);
  assert.equal(providerCalls, 0);
});

test('recusa o mesmo objeto usado para as duas faces', async () => {
  const front = addModel('1', 25);
  const response = await checkout({ modeloPath: front, contracapaPath: front, contracapaModo: 'automatic' });
  assert.equal(response.status, 422);
  assert.equal(providerCalls, 0);
});

test('recusa contracapa sem capa', async () => {
  const response = await checkout({ contracapaPath: addModel('2', 26), contracapaModo: 'custom' });
  assert.equal(response.status, 422);
  assert.equal(providerCalls, 0);
});

test('recusa modo desconhecido de contracapa', async () => {
  const response = await checkout({ modeloPath: addModel('1', 25), contracapaPath: addModel('2', 26), contracapaModo: 'invalid' });
  assert.equal(response.status, 422);
  assert.equal(providerCalls, 0);
});

test('consulta autenticada entrega a face correta sem abrir acesso a outro proprietário', async () => {
  const orderId = 'GB-TEST123456'; const itemId = 'item123';
  const back = `artworks/${uid}/orders/${orderId}/${itemId}/${'2'.repeat(32)}.png`;
  objects.set(back, { generation: 26, bytes: Buffer.from('conteudo-ficticio'), metadata: {} });
  docs.set(`orders/${orderId}`, { userId: uid, itens: [{ id: itemId, contracapaPath: back, contracapaNome: 'contracapa.png' }] });
  const request = (query = '') => localFetch(`${baseUrl}/api/orders/${orderId}/model/${itemId}${query}`, { headers: { authorization: 'Bearer usuario-teste' } });
  const response = await request('?face=back');
  assert.equal(response.status, 200);
  const result = await response.json() as { url: string; filename: string };
  assert.equal(result.url, `https://storage.example.test/${back}`);
  assert.equal(result.filename, 'contracapa.png');
  assert.equal((await request('?face=wrong')).status, 400);
  docs.set(`orders/${orderId}`, { userId: 'outro', itens: [{ id: itemId, contracapaPath: back }] });
  assert.equal((await request('?face=back')).status, 403);
});

test('checkout preserva tamanho, cor, fonte e posição de cada linha', async () => {
  docs.set('config/main', { fontes_personalizacao: [{ id: 'arial', nome: 'Arial', cssFamily: 'Arial', ativo: true }] });
  docs.set('anuncios/produto', { nome: 'Produto Teste', desc: 'Arte teste', categoria: 'teste', preco_base: '10.00', tipoInput: 'texto_arte' });
  const response = await checkout({ modeloPath: addModel('1', 25), personalizacaoTexto: {
    texto: 'A\nB', fonte: 'arial', cor: '#ffffff', posicao: { x: 50, y: 50 }, corCompartilhada: false, linhas: [
      { id: 'line-a', texto: 'A', tamanhoFonte: 5, cor: '#ff0000', posicao: { x: 10, y: 20 } },
      { id: 'line-b', texto: 'B', tamanhoFonte: 9, cor: '#00ff00', posicao: { x: 70, y: 80 } },
    ],
  } });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const order = [...docs.entries()].find(([path]) => path.startsWith('orders/'))?.[1];
  const item = (order?.itens as Array<Record<string, unknown>>)[0];
  const style = item.personalizacaoTexto as { linhas: Array<{ tamanhoFonte: number; cor: string; posicao: unknown }> };
  assert.deepEqual(style.linhas.map(line => [line.tamanhoFonte, line.cor, line.posicao]), [[5, '#ff0000', { x: 10, y: 20 }], [9, '#00ff00', { x: 70, y: 80 }]]);
});

test('checkout recusa estilo inválido por linha antes de chamar o provedor', async () => {
  docs.set('config/main', { fontes_personalizacao: [{ id: 'arial', nome: 'Arial', cssFamily: 'Arial', ativo: true }] });
  docs.set('anuncios/produto', { nome: 'Produto Teste', desc: 'Arte teste', categoria: 'teste', preco_base: '10.00', tipoInput: 'texto_arte' });
  const response = await checkout({ modeloPath: addModel('1', 25), personalizacaoTexto: { texto: 'A', fonte: 'arial', posicao: { x: 50, y: 50 }, linhas: [{ id: 'line-a', texto: 'A', tamanhoFonte: 999, posicao: { x: 50, y: 50 } }] } });
  assert.equal(response.status, 422); assert.equal(providerCalls, 0);
});

const printProfile = { widthMm: 100, heightMm: 150, bleedMm: 2, safeMarginMm: 5, targetDpi: 300 };
function configurePrintProduct() {
  docs.set('anuncios/produto', { ...docs.get('anuncios/produto'), printProfile });
}

test('salva formato e aprovação vinculados às gerações validadas das duas faces', async () => {
  configurePrintProduct();
  const front = addModel('1', 25), back = addModel('2', 26);
  const response = await checkout({ modeloPath: front, contracapaPath: back, contracapaModo: 'custom', printProfile,
    aprovacaoArte: { acceptedAt: '1900-01-01', userId: 'outro', modelGeneration: 999, designFingerprint: 'forjado' },
  });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const order = [...docs.entries()].find(([path]) => path.startsWith('orders/'))?.[1];
  const item = (order?.itens as Array<Record<string, unknown>>)[0];
  assert.deepEqual(item.printProfile, printProfile);
  const approval = item.aprovacaoArte as { userId: string; acceptedAt: string; modelGeneration: number; backGeneration: number; designFingerprint: string };
  assert.equal(approval.userId, uid); assert.equal(approval.modelGeneration, 25); assert.equal(approval.backGeneration, 26);
  assert.match(approval.designFingerprint, /^[a-f0-9]{64}$/); assert.ok(Date.now() - Date.parse(approval.acceptedAt) < 10_000);
  assert.deepEqual(copies.map(copy => copy.generation), [17, 25, 26]);
  docs.set('anuncios/produto', { ...docs.get('anuncios/produto'), printProfile: { ...printProfile, widthMm: 200 } });
  assert.deepEqual(item.printProfile, printProfile, 'o pedido conserva o formato da compra');
});

test('aprovação explícita é obrigatória para o modelo, inclusive sem formato novo', async () => {
  const response = await checkout({ modeloPath: addModel('1', 25), aprovarArte: false });
  assert.equal(response.status, 422); assert.equal(providerCalls, 0);
  assert.match((await response.json() as { error: string }).error, /aprove a arte/);
  assert.equal(copies.length, 0);
});

test('não confunde texto truthy com aprovação explícita', async () => {
  const response = await checkout({ modeloPath: addModel('1', 25), aprovarArte: 'true' });
  assert.equal(response.status, 422); assert.equal(providerCalls, 0);
});

test('recusa formato do carrinho desatualizado ou adulterado antes de copiar arquivos', async () => {
  configurePrintProduct();
  const response = await checkout({ modeloPath: addModel('1', 25), printProfile: { ...printProfile, bleedMm: 0 } });
  assert.equal(response.status, 422); assert.equal(providerCalls, 0); assert.equal(copies.length, 0);
  assert.match((await response.json() as { error: string }).error, /formato de impressão.*mudou/);
});

test('não aceita formato ausente em produto com formato cadastrado', async () => {
  configurePrintProduct();
  assert.equal((await checkout({ modeloPath: addModel('1', 25) })).status, 422);
  assert.equal(providerCalls, 0);
});

test('recusa configuração de impressão inválida no catálogo', async () => {
  docs.set('anuncios/produto', { ...docs.get('anuncios/produto'), printProfile: { ...printProfile, safeMarginMm: 80 } });
  const response = await checkout();
  assert.equal(response.status, 422); assert.equal(providerCalls, 0);
});

test('produto com formato exige modelo composto antes da compra', async () => {
  configurePrintProduct();
  const response = await checkout({ printProfile });
  assert.equal(response.status, 422); assert.equal(providerCalls, 0);
});
