import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import test, { before, beforeEach, after, mock } from 'node:test';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import app from './app.js';

const orderId = 'GB-ABCDEF0123456789';
const providerOrderId = 'ORDE_ABCDEF1234567890';
const checkoutId = 'CHEC_ABCDEF1234567890';
const chargeId = 'CHAR_ABCDEF1234567890';
const token = 'sandbox-test-token';
const env = {
  NODE_ENV: 'production', APP_URL: 'https://store.example.com', LOG_LEVEL: 'silent',
  PAGBANK_ENV: 'sandbox', PAGBANK_TOKEN: token, FIREBASE_APP_CHECK_MODE: 'off',
  FIREBASE_FIRESTORE_DATABASE_ID: 'refund-security-test',
  FIREBASE_STORAGE_BUCKET: 'demo-refund-security.firebasestorage.app',
};
const oldEnv = new Map(Object.keys(env).map(key => [key, process.env[key]]));
const docs = new Map<string, Record<string, unknown>>();
const localFetch = globalThis.fetch;
let firebaseApp: App;
let server: Server;
let baseUrl: string;
let providerRefund = 0;
let providerStatus = 'PAID';
let providerUnavailable = false;
let additionalCharges: ReturnType<typeof charge>[] = [];
let checkoutStatus = 'ACTIVE';
let checkoutHasOrders = true;
let tokenAdmin = true;
let currentAdmin = true;
let adminLookupUnavailable = false;

function ref(path: string) {
  return {
    path,
    collection(name: string) { return { doc: (id: string) => ref(`${path}/${name}/${id}`) }; },
    async get() { const value = docs.get(path); return { exists: value !== undefined, data: () => value }; },
    async set(value: Record<string, unknown>) { docs.set(path, { ...docs.get(path), ...value }); },
  };
}
type Ref = ReturnType<typeof ref>;
const tx = {
  get: (r: Ref) => r.get(),
  create(r: Ref, value: Record<string, unknown>) {
    if (docs.has(r.path)) throw new Error('Documento já existe');
    docs.set(r.path, value);
  },
  set(r: Ref, value: Record<string, unknown>) { docs.set(r.path, { ...docs.get(r.path), ...value }); },
  update(r: Ref, value: Record<string, unknown>) { docs.set(r.path, { ...docs.get(r.path), ...value }); },
};
function charge(refunded: number, status = refunded === 840 ? 'CANCELED' : 'PAID', id = chargeId) {
  return {
    id, status,
    amount: { value: 840, currency: 'BRL', summary: { total: 840, paid: 840, refunded } },
    payment_method: { type: 'CREDIT_CARD' },
  };
}
async function webhook(payload: unknown) {
  const body = JSON.stringify(payload);
  const signature = createHash('sha256').update(`${token}-${body}`).digest('hex');
  return localFetch(`${baseUrl}/api/webhook/pagbank`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-authenticity-token': signature }, body,
  });
}
function payload(refunded: number, status?: string, id?: string) {
  return { id: providerOrderId, reference_id: orderId, charges: [charge(refunded, status, id)] };
}

before(async () => {
  Object.assign(process.env, env);
  firebaseApp = initializeApp({ projectId: 'demo-refund-security' });
  const auth = getAuth(firebaseApp);
  const db = getFirestore(firebaseApp, env.FIREBASE_FIRESTORE_DATABASE_ID);
  mock.method(auth, 'verifyIdToken', async (_token: string, checkRevoked?: boolean) => {
    assert.equal(checkRevoked, true);
    return { uid: 'owner', sub: 'owner', admin: tokenAdmin } as unknown as DecodedIdToken;
  });
  mock.method(auth, 'getUser', async () => {
    if (adminLookupUnavailable) throw Object.assign(new Error('Falha simulada do Firebase'), { code: 'auth/internal-error' });
    return { disabled: false, customClaims: { admin: currentAdmin } } as unknown as Awaited<ReturnType<typeof auth.getUser>>;
  });
  mock.method(db, 'collection', ((name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) })) as unknown as typeof db.collection);
  mock.method(db, 'runTransaction', (async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx)) as unknown as typeof db.runTransaction);
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    if (providerUnavailable) throw new Error('Provedor de teste indisponível');
    if (url.includes('/checkouts/')) return Response.json({
      id: checkoutId, reference_id: orderId, status: checkoutStatus,
      orders: checkoutHasOrders ? [{ id: providerOrderId }] : [],
    });
    if (url.includes('/orders/')) return Response.json({ id: providerOrderId, charges: [...additionalCharges, charge(providerRefund, providerStatus)] });
    throw new Error('Chamada externa inesperada');
  });
  server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Servidor de teste indisponível');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  docs.clear(); docs.set('_adminAccess/owner', { schemaVersion: 1, enabled: true, epoch: 'legacy' }); providerRefund = 0; providerStatus = 'PAID'; providerUnavailable = false; additionalCharges = [];
  checkoutStatus = 'ACTIVE'; checkoutHasOrders = true;
  tokenAdmin = true; currentAdmin = true; adminLookupUnavailable = false;
  docs.set(`orders/${orderId}`, {
    userId: 'owner', paymentStatus: 'pago', status: 'Pago', fulfillmentStatus: 'pagamento_confirmado',
    totalCents: 840, metodoEntrega: 'retirada', pagbankCheckoutId: checkoutId, pagbankOrderId: providerOrderId,
    pagbankChargeId: chargeId, pagbankPayUrl: 'https://example.invalid/test',
  });
});

test('claim antiga não concede acesso administrativo quando o privilégio atual e o papel legado foram removidos', async () => {
  currentAdmin = false;
  docs.set('users/owner', { role: 'user' });
  const response = await localFetch(`${baseUrl}/api/admin/orders/${orderId}/fulfillment`, {
    method: 'POST', headers: { authorization: 'Bearer admin-test', 'content-type': 'application/json' },
    body: JSON.stringify({ fulfillmentStatus: 'em_producao' }),
  });
  assert.equal(response.status, 403);
  assert.equal(docs.get(`orders/${orderId}`)!.fulfillmentStatus, 'pagamento_confirmado');
});

test('compatibilidade administrativa pelo papel legado continua funcionando', async () => {
  tokenAdmin = false;
  docs.set('users/owner', { role: 'admin' });
  const response = await localFetch(`${baseUrl}/api/admin/orders/${orderId}/fulfillment`, {
    method: 'POST', headers: { authorization: 'Bearer admin-test', 'content-type': 'application/json' },
    body: JSON.stringify({ fulfillmentStatus: 'pagamento_confirmado' }),
  });
  assert.equal(response.status, 200);
});

test('remover só a claim preserva o acesso administrativo legado enquanto o papel persistir', async () => {
  currentAdmin = false;
  docs.set('users/owner', { role: 'admin' });
  const response = await localFetch(`${baseUrl}/api/admin/orders/${orderId}/fulfillment`, {
    method: 'POST', headers: { authorization: 'Bearer admin-test', 'content-type': 'application/json' },
    body: JSON.stringify({ fulfillmentStatus: 'pagamento_confirmado' }),
  });
  assert.equal(response.status, 200);
});

test('consulta indisponível da claim atual não autoriza nem derruba a sessão', async () => {
  adminLookupUnavailable = true;
  const response = await localFetch(`${baseUrl}/api/admin/orders/${orderId}/fulfillment`, {
    method: 'POST', headers: { authorization: 'Bearer admin-test', 'content-type': 'application/json' },
    body: JSON.stringify({ fulfillmentStatus: 'em_producao' }),
  });
  assert.equal(response.status, 503);
  assert.equal(docs.get(`orders/${orderId}`)!.fulfillmentStatus, 'pagamento_confirmado');
});

test('claim administrativa removida também impede acesso a arte de outro usuário', async () => {
  currentAdmin = false;
  docs.set('users/owner', { role: 'user' });
  docs.set(`orders/${orderId}`, { userId: 'outro', itens: [] });
  const response = await localFetch(`${baseUrl}/api/orders/${orderId}/artwork/item123`, {
    headers: { authorization: 'Bearer admin-test' },
  });
  assert.equal(response.status, 403);
});

test('webhook assinado com estado PAID apenas no checkout não confirma pedido', async () => {
  docs.set(`orders/${orderId}`, {
    ...docs.get(`orders/${orderId}`), paymentStatus: 'pendente', status: 'Pendente',
    fulfillmentStatus: 'aguardando_pagamento',
  });
  const response = await webhook({ id: checkoutId, reference_id: orderId, status: 'PAID' });
  assert.equal(response.status, 422);
  assert.equal(docs.get(`orders/${orderId}`)!.paymentStatus, 'pendente');
  assert.equal(docs.get(`orders/${orderId}`)!.fulfillmentStatus, 'aguardando_pagamento');
});

test('consulta autenticada sem cobrança não confirma pagamento a partir do estado do checkout', async () => {
  checkoutStatus = 'PAID'; checkoutHasOrders = false;
  docs.set(`orders/${orderId}`, {
    ...docs.get(`orders/${orderId}`), paymentStatus: 'pendente', status: 'Pendente',
    fulfillmentStatus: 'aguardando_pagamento', pagbankChargeId: '',
  });
  const response = await localFetch(`${baseUrl}/api/payment-status/${orderId}`, {
    headers: { authorization: 'Bearer test-token' },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, 'pendente');
  assert.equal(docs.get(`orders/${orderId}`)!.paymentStatus, 'pendente');
});
after(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  mock.restoreAll();
  if (firebaseApp) await deleteApp(firebaseApp);
  for (const [key, value] of oldEnv) value === undefined ? delete process.env[key] : process.env[key] = value;
});

test('webhook autenticado registra estorno parcial e impede que evento antigo o reverta', async () => {
  assert.equal((await webhook(payload(300))).status, 200);
  const partial = docs.get(`orders/${orderId}`)!;
  assert.equal(partial.paymentStatus, 'em_analise');
  assert.equal(partial.pagbankRefundedAmountCents, 300);
  assert.equal(partial.fulfillmentStatus, 'pagamento_confirmado');
  assert.equal((await webhook(payload(0))).status, 200);
  assert.equal(docs.get(`orders/${orderId}`)!.paymentStatus, 'em_analise');
  assert.equal(docs.get(`orders/${orderId}`)!.pagbankRefundedAmountCents, 300);
  assert.equal((await webhook(payload(840))).status, 200);
  assert.equal(docs.get(`orders/${orderId}`)!.paymentStatus, 'cancelado');
  assert.equal(docs.get(`orders/${orderId}`)!.pagbankRefundedAmountCents, 840);
  assert.equal((await webhook(payload(300))).status, 200);
  assert.equal(docs.get(`orders/${orderId}`)!.paymentStatus, 'cancelado');
});

test('bloqueia estorno incompatível ou de outra cobrança, mesmo com assinatura válida', async () => {
  assert.equal((await webhook(payload(841))).status, 422);
  assert.equal((await webhook(payload(200, 'PAID', 'CHAR_OUTRA12345678'))).status, 422);
  assert.equal(docs.get(`orders/${orderId}`)!.paymentStatus, 'pago');
});

test('consulta de pedido já pago detecta estornos parciais sucessivos com mesmo status PAID', async () => {
  const consult = () => localFetch(`${baseUrl}/api/payment-status/${orderId}`, { headers: { authorization: 'Bearer test-token' } });
  providerRefund = 200;
  assert.equal((await consult()).status, 200);
  assert.equal(docs.get(`orders/${orderId}`)!.pagbankRefundedAmountCents, 200);
  providerRefund = 500;
  assert.equal((await consult()).status, 200);
  assert.equal(docs.get(`orders/${orderId}`)!.pagbankRefundedAmountCents, 500);
  providerRefund = 840; providerStatus = 'CANCELED';
  assert.equal((await consult()).status, 200);
  assert.equal(docs.get(`orders/${orderId}`)!.paymentStatus, 'cancelado');
});

test('avanço operacional reconcilia e bloqueia pedido com estorno parcial', async () => {
  providerRefund = 200;
  const response = await localFetch(`${baseUrl}/api/admin/orders/${orderId}/fulfillment`, {
    method: 'POST', headers: { authorization: 'Bearer admin-test', 'content-type': 'application/json' },
    body: JSON.stringify({ fulfillmentStatus: 'em_producao' }),
  });
  assert.equal(response.status, 409);
  assert.equal(docs.get(`orders/${orderId}`)!.paymentStatus, 'em_analise');
  assert.equal(docs.get(`orders/${orderId}`)!.fulfillmentStatus, 'pagamento_confirmado');
});

test('avanço operacional segue disponível para pagamento íntegro confirmado', async () => {
  const response = await localFetch(`${baseUrl}/api/admin/orders/${orderId}/fulfillment`, {
    method: 'POST', headers: { authorization: 'Bearer admin-test', 'content-type': 'application/json' },
    body: JSON.stringify({ fulfillmentStatus: 'em_producao' }),
  });
  assert.equal(response.status, 200);
  assert.equal(docs.get(`orders/${orderId}`)!.fulfillmentStatus, 'em_producao');
});

test('avanço operacional aguarda quando o PagBank está indisponível', async () => {
  providerUnavailable = true;
  const response = await localFetch(`${baseUrl}/api/admin/orders/${orderId}/fulfillment`, {
    method: 'POST', headers: { authorization: 'Bearer admin-test', 'content-type': 'application/json' },
    body: JSON.stringify({ fulfillmentStatus: 'em_producao' }),
  });
  assert.equal(response.status, 503);
  assert.equal(docs.get(`orders/${orderId}`)!.fulfillmentStatus, 'pagamento_confirmado');
});

test('uma tentativa recusada anterior não impede a conciliação de uma nova cobrança paga', async () => {
  docs.set(`orders/${orderId}`, {
    ...docs.get(`orders/${orderId}`), paymentStatus: 'pendente', status: 'Pendente',
    fulfillmentStatus: 'aguardando_pagamento', pagbankChargeId: 'CHAR_ANTERIOR123456',
  });
  additionalCharges = [charge(0, 'DECLINED', 'CHAR_ANTERIOR123456')];
  const response = await localFetch(`${baseUrl}/api/payment-status/${orderId}`, {
    headers: { authorization: 'Bearer test-token' },
  });
  assert.equal(response.status, 200);
  assert.equal(docs.get(`orders/${orderId}`)!.paymentStatus, 'pago');
  assert.equal(docs.get(`orders/${orderId}`)!.pagbankChargeId, chargeId);
});
