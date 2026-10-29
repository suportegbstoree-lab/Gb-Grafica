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
  PAGBANK_ENV: 'sandbox', PAGBANK_TOKEN: 'pagbank-ficticio', FIREBASE_APP_CHECK_MODE: 'off',
  FIREBASE_FIRESTORE_DATABASE_ID: 'shipping-test', FIREBASE_STORAGE_BUCKET: 'demo-shipping.firebasestorage.app',
  CORREIOS_ENV: 'production', CORREIOS_ORIGIN_CEP: '14400000', CORREIOS_SERVICES: '03298:PAC,03220:SEDEX', CORREIOS_TOKEN: 'correios-ficticio',
  CORREIOS_USER: '', CORREIOS_ACCESS_CODE: '', CORREIOS_POSTING_CARD: '', CORREIOS_CONTRACT: '', CORREIOS_REGIONAL: '',
};
const oldEnv = new Map(Object.keys(env).map(key => [key, process.env[key]]));
const localFetch = globalThis.fetch;
const docs = new Map<string, Record<string, unknown>>();
const profile = { unitWeightGrams: 300, packagingWeightGrams: 150, lengthCm: 25, widthCm: 20, heightCm: 15, unitsPerParcel: 2 };
const items = [{ productId: 'produto', selecoes: {}, quantidade: 3 }];
let firebaseApp: App;
let server: Server;
let baseUrl = '';
let uid = '';
let scenario = 0;
let price = 1290;
let providerStatus = 200;
let rawPriceParameters: any[] = [];
let pagbankBodies: any[] = [];
let correiosCalls = 0;

function ref(path: string) {
  return {
    path,
    async get() { const value = docs.get(path); return { exists: value !== undefined, data: () => value }; },
    async set(value: Record<string, unknown>) { docs.set(path, { ...docs.get(path), ...value }); },
    async create(value: Record<string, unknown>) { assert.ok(!docs.has(path)); docs.set(path, value); },
  };
}
type Ref = ReturnType<typeof ref>;
const tx = {
  get: (r: Ref) => r.get(),
  create(r: Ref, value: Record<string, unknown>) { docs.set(r.path, value); },
  set(r: Ref, value: Record<string, unknown>) { docs.set(r.path, { ...docs.get(r.path), ...value }); },
};

before(async () => {
  Object.assign(process.env, env);
  firebaseApp = initializeApp({ projectId: 'demo-shipping' });
  const auth = getAuth(firebaseApp);
  const db = getFirestore(firebaseApp, env.FIREBASE_FIRESTORE_DATABASE_ID);
  mock.method(auth, 'verifyIdToken', async (_token: string, checkRevoked?: boolean) => {
    assert.equal(checkRevoked, true);
    return { uid, sub: uid, email: 'comprador@example.test', name: 'Cliente Teste' } as unknown as DecodedIdToken;
  });
  mock.method(db, 'collection', ((name: string) => ({ doc: (id: string) => ref(`${name}/${id}`), get: async () => ({ docs: [] }) })) as unknown as typeof db.collection);
  mock.method(db, 'runTransaction', (async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx)) as unknown as typeof db.runTransaction);
  mock.method(db, 'batch', (() => {
    const writes: Array<[Ref, Record<string, unknown>]> = [];
    return { set(r: Ref, value: Record<string, unknown>) { writes.push([r, value]); }, async commit() { for (const [r, value] of writes) await r.set(value); } };
  }) as unknown as typeof db.batch);
  mock.method(getStorage(firebaseApp), 'bucket', (() => ({})) as unknown as ReturnType<typeof getStorage>['bucket']);
  mock.method(axios, 'get', async () => ({ data: { logradouro: 'Rua Teste', bairro: 'Centro', localidade: 'São Paulo', uf: 'SP' } }));
  mock.method(axios, 'post', async (url: string, body: any, config: any) => {
    if (url.startsWith('https://api.correios.com.br/')) {
      correiosCalls++;
      assert.equal(config.headers.Authorization, 'Bearer correios-ficticio');
      assert.equal(config.maxRedirects, 0);
      assert.equal(config.timeout, 6000);
      if (providerStatus !== 200) return { status: providerStatus, data: { msgs: ['CORREIOS-SEGREDO-NAO-EXIBIR'] } };
      if (url.includes('/preco/')) {
        rawPriceParameters = body.parametrosProduto;
        return { status: 200, data: body.parametrosProduto.map((p: any) => ({
          coProduto: p.coProduto, nuRequisicao: p.nuRequisicao,
          pcFinal: ((p.coProduto === '03298' ? price : 2500) / 100).toFixed(2).replace('.', ','),
        })) };
      }
      return { status: 200, data: body.parametrosPrazo.map((p: any) => ({
        coProduto: p.coProduto, nuRequisicao: p.nuRequisicao, prazoEntrega: 4, entregaDomiciliar: 'S', entregaSabado: 'N',
      })) };
    }
    assert.ok(url.endsWith('/checkouts'));
    pagbankBodies.push(body);
    return { status: 201, data: { id: 'CHEC_TEST', status: 'ACTIVE', links: [{ rel: 'PAY', href: 'https://pagamento.sandbox.pagbank.com.br/pagamento?code=test' }] } };
  });
  server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  scenario++; uid = `shipping-user-${scenario}`;
  docs.clear(); pagbankBodies = []; rawPriceParameters = []; price = 1290; providerStatus = 200; correiosCalls = 0;
  docs.set('config/main', {});
  docs.set('anuncios/produto', { nome: 'Produto Teste', desc: 'Produto', categoria: 'teste', preco_base: '10.00', tipoInput: 'nenhum', shipping: profile });
});
after(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  mock.restoreAll();
  if (firebaseApp) await deleteApp(firebaseApp);
  for (const [key, value] of oldEnv) value === undefined ? delete process.env[key] : process.env[key] = value;
});
function post(path: string, body: unknown) {
  return localFetch(`${baseUrl}${path}`, { method: 'POST', headers: { authorization: 'Bearer firebase-ficticio', 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
function checkout(extra: Record<string, unknown> = {}) {
  return post('/api/checkout', { requestId: randomUUID(), legalAcceptance: currentLegalAcceptance(),
    customerName: 'Cliente Teste', cpf: '52998224725', phone: '11987654321', deliveryMethod: 'entrega',
    cep: '01001000', addressNumber: '10', items, shippingServiceCode: '03298', shippingAmountCents: 2580, ...extra });
}

test('HTTP: cotação usa perfil do catálogo e retorna opções sem expor credenciais', async () => {
  const response = await post('/api/shipping-quote', { cep: '01001000', items, weightGrams: 1, amount_cents: 1 });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.parcel_count, 2);
  assert.equal(body.amount_cents, 2580);
  assert.deepEqual(body.options.map((o: any) => o.service_name), ['PAC', 'SEDEX']);
  assert.deepEqual(rawPriceParameters.filter(p => p.coProduto === '03298').map(p => p.psObjeto), ['750', '450']);
  assert.ok(!JSON.stringify(body).includes('ficticio'));
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.ok(Date.parse(body.expires_at) > Date.parse(body.quoted_at));
});

test('HTTP: checkout recalcula e envia o serviço escolhido e o preço real ao PagBank', async () => {
  const response = await checkout({ shippingServiceCode: '03220', shippingAmountCents: 5000 });
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal(pagbankBodies.length, 1);
  assert.equal(pagbankBodies[0].shipping.service_type, 'SEDEX');
  assert.equal(pagbankBodies[0].shipping.amount, 5000);
  const order = [...docs.entries()].find(([path]) => path.startsWith('orders/'))![1] as any;
  assert.equal(order.frete, '50.00');
  assert.equal(order.totalCents, 8000);
  assert.equal(order.shipping.service_code, '03220');
  assert.equal(order.shipping.parcels.length, 2);
});

test('HTTP: preço alterado ou adulterado não cria pedido nem checkout', async () => {
  price = 1490;
  const response = await checkout();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'SHIPPING_QUOTE_CHANGED');
  assert.equal(pagbankBodies.length, 0);
  assert.ok(![...docs.keys()].some(path => path.startsWith('orders/')));
});

test('HTTP: serviço não autorizado não é aceito', async () => {
  const response = await checkout({ shippingServiceCode: '99999' });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, 'SHIPPING_SELECTION_REQUIRED');
  assert.equal(pagbankBodies.length, 0);
});

test('HTTP: token recusado devolve erro controlado sem detalhe do provedor', async () => {
  providerStatus = 401;
  const response = await checkout();
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'CORREIOS_TOKEN_EXPIRED');
  assert.ok(!JSON.stringify(body).includes('CORREIOS-SEGREDO'));
  assert.equal(pagbankBodies.length, 0);
});

test('HTTP: falha de rede do Correios não aparece como erro do PagBank nem vaza AxiosError', async () => {
  const originalMock = axios.post;
  const tokenError = Object.assign(new Error('CORREIOS-SEGREDO-NAO-EXIBIR'), { isAxiosError: true, config: { headers: { Authorization: 'token-privado' } } });
  mock.method(axios, 'post', async () => { throw tokenError; });
  try {
    const response = await post('/api/shipping-quote', { cep: '01001000', items });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.code, 'CORREIOS_UNAVAILABLE');
    assert.ok(!JSON.stringify(body).includes('SEGREDO'));
    assert.ok(!JSON.stringify(body).includes('token-privado'));
  } finally { mock.method(axios, 'post', originalMock); }
});

test('HTTP: produto sem peso não recebe frete fictício; retirada continua funcionando', async () => {
  docs.set('anuncios/produto', { ...docs.get('anuncios/produto'), shipping: undefined });
  const response = await post('/api/shipping-quote', { cep: '01001000', items });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, 'SHIPPING_PRODUCT_NOT_CONFIGURED');
  assert.equal(correiosCalls, 0);
  const pickup = await checkout({ deliveryMethod: 'retirada' });
  assert.equal(pickup.status, 201, await pickup.clone().text());
  assert.equal(pagbankBodies[0].shipping, undefined);
});
