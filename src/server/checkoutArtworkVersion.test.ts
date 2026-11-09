import { defaultPdfLayout } from '../lib/staffPdf';
import { initialReference } from '../lib/decorativeInitial';
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
let providerPayload: any;
let copiedGeneration: number | undefined;
let copiedMetadata: Record<string, unknown> | undefined;
let copiedPath = '';
let accessAdmin = false;
let accessStaff = false;
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
  name:env.FIREBASE_STORAGE_BUCKET,
  file(path: string, options?: { generation?: number; preconditionOpts?: { ifGenerationMatch?: number } }) {
    return {
      name: path,
      async exists() { return [objects.has(path)]; },
      async getSignedUrl() { return [`https://storage.example.test/${path}`]; },
      async getMetadata() {
        const obj = objects.get(path);
        if (!obj) throw Object.assign(new Error('Objeto ausente'), { code: 404 });
        return [{ size: String(obj.bytes.length), generation: String(obj.generation), contentType: path.endsWith('.pdf') ? 'application/pdf' : 'image/png', metadata: obj.metadata }];
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
    return { uid, sub: uid, admin: accessAdmin, ...(accessStaff ? { gbStaffEpoch: 'a'.repeat(32), staffRole: 'designer' } : {}), email: 'comprador@example.test', name: 'Cliente Teste' } as unknown as DecodedIdToken;
  });
  mock.method(auth, 'getUser', async () => ({ uid, disabled: false, customClaims: { admin: accessAdmin, ...(accessStaff ? { gbStaffEpoch: 'a'.repeat(32), staffRole: 'designer' } : {}) } }) as never);
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
  mock.method(axios, 'post', async (_url, payload) => {
    providerPayload=payload;
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
  accessAdmin = false; accessStaff = false;
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
async function checkout(extraItem: Record<string, unknown> = {}, extraOrder: Record<string, unknown> = {}) {
  return localFetch(`${baseUrl}/api/checkout`, {
    method: 'POST', headers: { authorization: 'Bearer usuario-teste', 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: randomUUID(), legalAcceptance: currentLegalAcceptance(), customerName: 'Cliente Teste',
      cpf: '52998224725', phone: '11987654321', deliveryMethod: 'retirada', ...extraOrder,
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

function initialProduct() {
  const id = 'c'.repeat(32), letterPath = `catalog/products/produto/${'d'.repeat(32)}.png`;
  const template = { id, path: `catalog/templates/produto/${id}.pdf`, name: 'Alfabeto.pdf', pages: ['https://example.test/front.png'], alphabet: { folderName: 'Alfabeto', sizePercent: 60, letters: { A: { path: letterPath, url: 'https://example.test/A.png' } } } };
  docs.set('config/main', { fontes_personalizacao: [{ id: 'arial', nome: 'Arial', cssFamily: 'Arial', ativo: true }] });
  docs.set('anuncios/produto', { ...docs.get('anuncios/produto'), imagem: template.pages[0], modelosPdf: [template], tipoInput: 'texto' });
  objects.set(template.path, { generation: 44, bytes: Buffer.from('%PDF-1.7'), metadata: {} });
  objects.set(letterPath, { generation: 31, bytes: Buffer.from([137,80,78,71,13,10,26,10]), metadata: { firebaseStorageDownloadTokens: 'public-catalog-token' } });
  return { template, letterPath, item: { arquivoPath: '', templateId: id, modeloPath: addModel('1', 25), contracapaPath: addModel('2', 26), contracapaModo: 'automatic', inicialReferencia: initialReference(template, 'Ana'), personalizacaoTexto: { texto: 'Ana', fonte: 'arial', posicao: { x: 50, y: 50 } } } };
}

test('pedido copia a inicial canônica e conserva o PDF e o alfabeto do catálogo', async () => {
  const { template, letterPath, item } = initialProduct();
  const response = await checkout({ ...item, inicialPath: 'artworks/outro/pending/falso.png', inicialLetra: 'Z', inicialTamanho: 99 });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  assert.deepEqual(copies.map(copy => copy.generation), [44, 25, 26, 31]);
  const order = [...docs.entries()].find(([path]) => path.startsWith('orders/'))?.[1];
  const stored = (order!.itens as Array<Record<string, unknown>>)[0];
  assert.equal(stored.inicialPath, copies[3].path); assert.equal(stored.inicialLetra, 'A'); assert.equal(stored.inicialTamanho, 60);
  assert.equal(objects.has(template.path), true); assert.equal(objects.has(letterPath), true);
  assert.equal(objects.has(item.modeloPath), false); assert.equal(objects.has(item.contracapaPath), false);
  assert.equal(objects.get(copies[3].path)?.metadata.firebaseStorageDownloadTokens, undefined);
  objects.delete(letterPath); docs.set('anuncios/produto', {});
  assert.equal(objects.get(copies[3].path)?.bytes[0], 137, 'o pedido mantém uma cópia independente do catálogo');
});

test('referência antiga da inicial impede o checkout antes de copiar ou chamar o provedor', async () => {
  const { item } = initialProduct(); const response = await checkout({ ...item, inicialReferencia: 'null' });
  assert.equal(response.status, 422); assert.equal(providerCalls, 0); assert.equal(copies.length, 0);
});

test('download da inicial é exclusivo de orders.artwork, inclusive quando o cliente é dono do pedido', async () => {
  const orderId = 'GB-INITIAL123', itemId = 'item123', path = `artworks/${uid}/orders/${orderId}/${itemId}/${'d'.repeat(32)}.png`;
  const order = { userId: uid, itens: [{ id: itemId, inicialPath: path }] };
  docs.set(`orders/${orderId}`, order);
  const request = () => localFetch(`${baseUrl}/api/admin/orders/${orderId}/initial/${itemId}`, { headers: { authorization: 'Bearer usuario-teste' } });
  assert.equal((await request()).status, 403);
  accessStaff = true;
  docs.set(`_staffAccess/${uid}`, { schemaVersion: 1, enabled: true, roleId: 'designer', epoch: 'a'.repeat(32) });
  docs.set('_staffRoles/designer', { schemaVersion: 1, enabled: true, revision: 'b'.repeat(32), permissions: ['orders.read'] });
  assert.equal((await request()).status, 403);
  docs.set('_staffRoles/designer', { schemaVersion: 1, enabled: true, revision: 'b'.repeat(32), permissions: ['orders.read', 'orders.artwork'] });
  assert.equal((await request()).status, 200);
  docs.set(`orders/${orderId}`, { ...order, itens: [{ id: itemId, inicialPath: path.replace('/item123/', '/otheritem/') }] });
  assert.equal((await request()).status, 404);
});

function bundleSetup() {
  docs.set('anuncios/bundle', {nome:'Kit com arte',desc:'Composição fixa',categoria:'teste',tipoInput:'nenhum',atributos:[],combinacoes:{},pacote:{components:[{productId:'produto',quantity:2,allowQuantity:false,configurable:false,selections:{}}],allowQuantity:true,discountType:'percent',discountValue:10,revision:'a'.repeat(32)}});
  return {productId:'bundle',quantidade:2,selecoes:{},bundleRevision:'a'.repeat(32),expectedUnitAmountCents:1800,bundleItems:[{productId:'produto',quantidade:2,selecoes:{},arquivoPath:sourcePath,arquivoNome:'arte.png',aprovarArte:true,expectedUnitAmountCents:1000}]};
}
test('bundle checkout charges server prices and preserves private component artwork in the order',async()=>{
  const response=await checkout(bundleSetup());assert.equal(response.status,201,JSON.stringify(await response.clone().json()));assert.equal(providerCalls,1);const order=[...docs].find(([p])=>p.startsWith('orders/'))![1] as any;assert.equal(order.totalCents,3600);assert.equal(providerPayload.items.length,1);assert.equal(providerPayload.items[0].unit_amount,1800);assert.equal(providerPayload.items[0].quantity,2);assert.equal(order.itens.length,1);assert.equal(order.itens[0].preco,'18.00');assert.equal(order.itens[0].quantidade,2);assert.equal(order.itens[0].bundleItems[0].quantidade,2);assert.match(order.itens[0].bundleItems[0].arquivoPath,/\/orders\//);assert.equal(copiedGeneration,17);
});
for(const [name,change,status] of [
  ['forged bundle total',(value:any)=>({...value,expectedUnitAmountCents:1}),409],
  ['changed bundle revision',(value:any)=>({...value,bundleRevision:'b'.repeat(32)}),409],
  ['replaced composition',(value:any)=>({...value,bundleItems:[{...value.bundleItems[0],productId:'forged'}]}),422],
  ['changed fixed quantity',(value:any)=>({...value,bundleItems:[{...value.bundleItems[0],quantidade:1}]}),422],
  ['another customer artwork',(value:any)=>({...value,bundleItems:[{...value.bundleItems[0],arquivoPath:'artworks/victim/pending/00000000000000000000000000000000.png'}]}),422],
] as const) test(`bundle checkout rejects ${name} before contacting payment provider`,async()=>{const response=await checkout(change(bundleSetup()));assert.equal(response.status,status,JSON.stringify(await response.clone().json()));assert.equal(providerCalls,0);});

function linkedProduct() {
 const pdfId='a'.repeat(32),path=`catalog/templates/produto/${pdfId}.pdf`,model=`artworks/${uid}/pending/${'b'.repeat(32)}.png`;
 const binding={revision:'c'.repeat(32),baseId:'d'.repeat(32),baseRevision:'e'.repeat(32),layoutId:'f'.repeat(32),layoutRevision:'1'.repeat(32),layout:{...defaultPdfLayout(),font_size:91},fonts:[],pdf:{id:pdfId,path,name:'Base.pdf',pages:['https://example.com/front.png']}};
 docs.set('anuncios/produto',{...docs.get('anuncios/produto'),moldePdf:binding,tipoInput:'texto_arte',preco_base:'20.00',precificacao:'adicionais',combinacoes:{},atributos:[{nome:'Imagem',opcoes:['Com','Sem'],configuracao:{Com:{adicional:'10.00',imagem:true},Sem:{adicional:'5.00',imagem:false}}},{nome:'Nome',opcoes:['Com','Sem'],configuracao:{Com:{adicional:'2.00',texto:true},Sem:{adicional:'0',texto:false}}}]});
 objects.set(path,{generation:22,bytes:Buffer.from('%PDF-1.7\ntest base'),metadata:{}});
 objects.set(model,{generation:23,bytes:Buffer.from([137,80,78,71,13,10,26,10,0]),metadata:{ownerId:uid,kind:'personalization-model',originalName:'modelo.png'}});
 return {arquivoPath:'',selecoes:{Imagem:'Com',Nome:'Com'},textoMolde:'ANA',moldeRevisao:binding.revision,modeloPath:model,expectedUnitAmountCents:3200};
}
test('linked checkout accepts the default with no customer upload and stores the locked workshop recipe',async()=>{
 const input=linkedProduct(),response=await checkout({...input,moldePedido:{job:{lines:[{fontSize:999}]}}});
 assert.equal(response.status,201,JSON.stringify(await response.clone().json()));assert.equal(providerPayload.items[0].unit_amount,3200);
 const order=[...docs].find(([p])=>p.startsWith('orders/'))![1] as any,item=order.itens[0];
 assert.match(item.arquivoPath,/orders.*[.]pdf$/);assert.equal(item.moldePedido.job.lines[0].fontSize,91);assert.equal(item.moldePedido.job.lines[0].text,'ANA');assert.equal(item.imagemClientePath,undefined);assert.equal(copies.length,2);
 assert.ok(objects.has(`catalog/templates/produto/${'a'.repeat(32)}.pdf`));
});
test('linked checkout copies a private customer image independently from the immutable PDF base',async()=>{
 const response=await checkout({...linkedProduct(),imagemClientePath:sourcePath});assert.equal(response.status,201,JSON.stringify(await response.clone().json()));
 const order=[...docs].find(([p])=>p.startsWith('orders/'))![1] as any,item=order.itens[0];assert.match(item.imagemClientePath,/orders.*[.]png$/);assert.notEqual(item.imagemClientePath,item.modeloPath);assert.equal(copies.length,3);
 const denied=await localFetch(`${baseUrl}/api/orders/${order.id || [...docs].find(([p])=>p.startsWith('orders/'))![0].slice(7)}/artwork/${item.id}?source=customer-image`,{headers:{authorization:'Bearer usuario-teste'}});assert.equal(denied.status,403);
});
test('choices without name or image discard hidden client values and charge only selected additions',async()=>{
 const response=await checkout({...linkedProduct(),selecoes:{Imagem:'Sem',Nome:'Sem'},textoMolde:'HIDDEN',imagemClientePath:'artworks/victim/pending/'+ '0'.repeat(32)+'.png',expectedUnitAmountCents:2500});assert.equal(response.status,201,JSON.stringify(await response.clone().json()));
 const order=[...docs].find(([p])=>p.startsWith('orders/'))![1] as any;assert.equal(order.itens[0].moldePedido.job.lines[0].text,'');assert.equal(order.itens[0].imagemClientePath,undefined);assert.equal(providerPayload.items[0].unit_amount,2500);
});
for(const [name,change,status] of [
 ['a stale published mold',{moldeRevisao:'0'.repeat(32)},409],
 ['a forged additive total',{expectedUnitAmountCents:1},409],
 ['a missing required name',{textoMolde:''},422],
 ['an unapproved model',{aprovarArte:false},422],
 ['another customer image',{imagemClientePath:'artworks/victim/pending/'+ '0'.repeat(32)+'.png'},422],
] as const) test(`linked checkout rejects ${name} before contacting the provider`,async()=>{const response=await checkout({...linkedProduct(),...change});assert.equal(response.status,status,JSON.stringify(await response.clone().json()));assert.equal(providerCalls,0);});
test('an independent image-base is accepted instead of a mandatory upload and never deleted after checkout',async()=>{
 const path=`catalog/products/produto/${'a'.repeat(32)}.png`,model=`artworks/${uid}/pending/${'b'.repeat(32)}.png`;
 docs.set('anuncios/produto',{...docs.get('anuncios/produto'),imagemBase:`https://firebasestorage.googleapis.com/v0/b/${env.FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(path)}?alt=media`});
 objects.set(path,{...objects.get(sourcePath)!,metadata:{}});objects.set(model,{...objects.get(sourcePath)!,metadata:{ownerId:uid,kind:'personalization-model'}});
 const response=await checkout({arquivoPath:'',modeloPath:model});assert.equal(response.status,201,JSON.stringify(await response.clone().json()));assert.ok(objects.has(path));assert.equal(copies.length,2);
});

test('four-page linked models copy every preview and serve only owned order pages',async()=>{
 const input=linkedProduct(),p=docs.get('anuncios/produto') as any;p.moldePdf.pdf.pages=Array.from({length:4},(_,i)=>`https://example.com/p${i+1}.png`);
 const extras=Array.from({length:3},(_,i)=>`artworks/${uid}/pending/${String(i+4).repeat(32)}.png`);
 for(const path of extras)objects.set(path,{...objects.get(String(input.modeloPath))!,generation:30,metadata:{ownerId:uid,kind:'personalization-model'}});
 const response=await checkout({...input,contracapaPath:extras[0],contracapaModo:'automatic',paginasModelo:extras.slice(1)});assert.equal(response.status,201,JSON.stringify(await response.clone().json()));
 const [path,order]=[...docs].find(([p])=>p.startsWith('orders/'))! as [string,any];const item=order.itens[0];assert.equal(copies.length,5);assert.equal(item.paginasModelo.length,2);assert.match(item.paginasModelo[1],/orders.*[.]png$/);
 const own=await localFetch(`${baseUrl}/api/orders/${path.slice(7)}/model/${item.id}?page=3`,{headers:{authorization:'Bearer usuario-teste'}});assert.equal(own.status,200);
 const invalid=await localFetch(`${baseUrl}/api/orders/${path.slice(7)}/model/${item.id}?page=99`,{headers:{authorization:'Bearer usuario-teste'}});assert.equal(invalid.status,422);
});
test('linked models reject an incomplete set of preview pages',async()=>{
 const input=linkedProduct(),p=docs.get('anuncios/produto') as any;p.moldePdf.pdf.pages=Array.from({length:4},(_,i)=>`https://example.com/p${i+1}.png`);
 const response=await checkout(input);assert.equal(response.status,422);assert.equal(providerCalls,0);
});

const salesCouponCode = 'GB-A1B2C3D4E5F6';
function seedSalesCoupon() {
  docs.set('_salesCoupons/' + salesCouponCode, {
    code: salesCouponCode, description: 'Agendas', kind: 'fixed', amount: 301, limit: 1, used: 0,
    scope: 'products', targets: ['produto'], expiresOn: '2099-12-31', firstPurchase: false, active: true, revision: 'rev1',
  });
}

test('coupon quote skips artwork validation and checkout reserves one use with the exact discounted PagBank amount', async () => {
  seedSalesCoupon();
  const selecoes = { Estampa: 'Floral 1', Customização: 'Nome' };
  docs.set('anuncios/produto', {
    ...docs.get('anuncios/produto'), sku: 'AGENDA',
    atributos: [{ nome: 'Estampa', opcoes: ['Floral 1'] }, { nome: 'Customização', opcoes: ['Nome'] }],
    combinacoes: { 'Floral 1|Nome': '10.00' },
    skuPorCombinacao: { 'Floral 1|Nome': 'AGENDA-FL1-NOME' },
  });
  const preview = await localFetch(`${baseUrl}/api/checkout/coupon`, {
    method: 'POST', headers: { authorization: 'Bearer usuario-teste', 'content-type': 'application/json' },
    body: JSON.stringify({ couponCode: salesCouponCode, items: [{ productId: 'produto', selecoes, quantidade: 2 }] }),
  });
  assert.equal(preview.status, 200, JSON.stringify(await preview.clone().json()));
  assert.equal((await preview.json()).coupon.discountCents, 301);
  assert.equal(docs.get('_salesCoupons/' + salesCouponCode)?.used, 0);
  const response = await checkout({ quantidade: 2, selecoes, sku: 'IGNORAR-ESTE-VALOR' }, {
    couponCode: salesCouponCode, expectedCouponCode: salesCouponCode, expectedCouponCents: 301,
  });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  assert.equal(providerPayload.items.reduce((sum: number, item: any) => sum + item.unit_amount * item.quantity, 0), 1699);
  const order = [...docs].find(([path]) => path.startsWith('orders/'))![1] as any;
  assert.equal(order.totalCents, 1699);
  assert.equal(order.subtotal, '20.00');
  assert.equal(order.itens[0].sku, 'AGENDA-FL1-NOME');
  assert.equal(order.cupom.code, salesCouponCode);
  assert.equal(order.cupom.discountCents, 301);
  assert.equal(docs.get('_salesCoupons/' + salesCouponCode)?.used, 1);
  assert.equal(docs.get('_salesCouponHolds/' + order.id)?.providerAttempted, true);
});

test('an altered expected coupon total is rejected before reserving a use or calling PagBank', async () => {
  seedSalesCoupon();
  const response = await checkout({}, {
    couponCode: salesCouponCode, expectedCouponCode: salesCouponCode, expectedCouponCents: 999,
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'COUPON_CHANGED');
  assert.equal(providerCalls, 0);
  assert.equal(docs.get('_salesCoupons/' + salesCouponCode)?.used, 0);
});

function optionProductionProduct() {
 const input = linkedProduct();
 const product = docs.get('anuncios/produto') as any;
 const defaultBinding = product.moldePdf;
 const id = '9'.repeat(32);
 const binding = {
   ...defaultBinding, revision: '8'.repeat(32), layout: { ...defaultBinding.layout, font_size: 120 },
   pdf: { ...defaultBinding.pdf, id, path: `catalog/templates/produto/${id}.pdf`, name: 'Opção.pdf' },
 };
 const imagePath = `catalog/products/produto/${'6'.repeat(32)}.png`;
 const image = `https://firebasestorage.googleapis.com/v0/b/${env.FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(imagePath)}?alt=media`;
 objects.set(binding.pdf.path, { generation: 40, bytes: Buffer.from('%PDF-1.7\noption base'), metadata: {} });
 objects.set(imagePath, { ...objects.get(sourcePath)!, generation: 41, metadata: {} });
 product.atributos[0].opcoes.push('Foto');
 product.atributos[0].configuracao.Com.moldePdf = binding;
 product.atributos[0].configuracao.Foto = { imagemBase: image, imagem: false, texto: false };
 return { input, binding, image, defaultBinding };
}

test('checkout freezes the option PDF and layout even when the customer uploads an image', async () => {
 const { input, binding } = optionProductionProduct();
 const response = await checkout({ ...input, moldeRevisao: binding.revision, imagemClientePath: sourcePath });
 assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
 const item = ([...docs].find(([path]) => path.startsWith('orders/'))![1] as any).itens[0];
 assert.equal(item.moldePedido.job.lines[0].fontSize, 120);
 assert.equal(item.arquivoNome, 'Opção.pdf');
 assert.ok(copies.some(copy => copy.generation === 40));
 assert.ok(copies.some(copy => copy.generation === 17));
 assert.ok(!copies.some(copy => copy.generation === 22));
});

test('checkout rejects the default revision when the selected option has its own PDF', async () => {
 const { input } = optionProductionProduct();
 const response = await checkout(input);
 assert.equal(response.status, 409);
 assert.equal(providerCalls, 0);
});

test('checkout uses the default for an option without its own art', async () => {
 const { input } = optionProductionProduct();
 const response = await checkout({ ...input, selecoes: { Imagem: 'Sem', Nome: 'Com' }, expectedUnitAmountCents: 2700 });
 assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
 assert.ok(copies.some(copy => copy.generation === 22));
});

test('checkout rejects an old image reference for the selected option', async () => {
 const { input, image } = optionProductionProduct();
 const response = await checkout({
   ...input, selecoes: { Imagem: 'Foto', Nome: 'Com' }, moldeRevisao: undefined,
   expectedUnitAmountCents: 2200, imagemBaseReferencia: image + '-old',
 });
 assert.equal(response.status, 409);
 assert.equal(providerCalls, 0);
});

test('checkout accepts the option image instead of the product PDF', async () => {
 const { input, image } = optionProductionProduct();
 const photo = { ...input, selecoes: { Imagem: 'Foto', Nome: 'Com' }, moldeRevisao: undefined, expectedUnitAmountCents: 2200 };
 const response = await checkout({ ...photo, imagemBaseReferencia: image });
 assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
 const item = ([...docs].find(([path]) => path.startsWith('orders/'))![1] as any).itens[0];
 assert.equal(item.baseImagemPedido, true);
 assert.equal(item.moldePedido, undefined);
 assert.ok(copies.some(copy => copy.generation === 41));
 assert.ok(!copies.some(copy => copy.generation === 22));
});

for (const [label, selections, cents, revision, sku] of [
  ['base', {}, 2000, 'c', 'Produto Teste'],
  ['uma variação', { Imagem: 'Com' }, 3000, '8', 'Produto Teste Com'],
] as const) test(`checkout aceita ${label} e conserva o molde correspondente`, async () => {
 const { input } = optionProductionProduct();
 const response = await checkout({
   ...input, selecoes: selections, expectedUnitAmountCents: cents, moldeRevisao: revision.repeat(32),
 });
 assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
 assert.equal(providerPayload.items[0].unit_amount, cents);
 const item = ([...docs].find(([path]) => path.startsWith('orders/'))![1] as any).itens[0];
 assert.equal(item.moldeRevisao, revision.repeat(32));
 assert.equal(item.sku, sku);
 assert.deepEqual(item.selecoes, selections);
});

test('checkout aceita opção avulsa com seu preço cadastrado em modo por combinação', async () => {
 docs.set('anuncios/produto', {
   ...docs.get('anuncios/produto'), tipoInput: 'nenhum', precificacao: 'combinacoes',
   atributos: [
     { nome: 'Cor', opcoes: ['Azul'] },
     { nome: 'Nome', opcoes: ['Sim'], configuracao: { Sim: { precoIndividual: '18,00' } } },
   ],
   combinacoes: { 'Azul|Sim': '30,00' },
 });
 const response = await checkout({ arquivoPath: '', selecoes: { Nome: 'Sim' }, expectedUnitAmountCents: 1800 });
 assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
 assert.equal(providerPayload.items[0].unit_amount, 1800);
});

test('checkout não confunde uma seleção explícita inválida com a base', async () => {
 const { input } = optionProductionProduct();
 const response = await checkout({ ...input, selecoes: { Imagem: '' }, expectedUnitAmountCents: 2000 });
 assert.equal(response.status, 422);
 assert.equal(providerCalls, 0);
});
