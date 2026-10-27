import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test, { after, before, beforeEach, mock } from 'node:test';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import app from './app.js';

const aliceOrderId = 'GB-ALICE12345678';
const bobOrderId = 'GB-BOB12345678';
const bobCheckoutId = 'CHEC_B0B01234';
const testEnvironment = {
  NODE_ENV: 'production',
  APP_URL: 'https://loja.example.com',
  LOG_LEVEL: 'silent',
  PAGBANK_ENV: 'sandbox',
  PAGBANK_TOKEN: 'sandbox-unit-test-only',
  FIREBASE_APP_CHECK_MODE: 'off',
  FIREBASE_FIRESTORE_DATABASE_ID: 'payment-access-tests',
  FIREBASE_STORAGE_BUCKET: 'demo-gb-payment-access.firebasestorage.app',
};
const originalEnvironment = new Map(
  Object.keys(testEnvironment).map(key => [key, process.env[key]]),
);
const localFetch = globalThis.fetch;
const documents = new Map<string, Record<string, unknown>>();
const documentReads: string[] = [];
const documentWrites: string[] = [];
const verifiedTokens: string[] = [];
const providerRequests: string[] = [];
let firebaseApp: App;
let server: Server;
let baseUrl = '';

function documentReference(path: string) {
  return {
    path,
    async get() {
      documentReads.push(path);
      const data = documents.get(path);
      return { exists: data !== undefined, data: () => data };
    },
  };
}

type TestDocumentReference = ReturnType<typeof documentReference>;
const transaction = {
  get: (reference: TestDocumentReference) => reference.get(),
  set(reference: TestDocumentReference, data: Record<string, unknown>) {
    documentWrites.push(reference.path);
    documents.set(reference.path, data);
  },
  update(reference: TestDocumentReference, data: Record<string, unknown>) {
    documentWrites.push(reference.path);
    documents.set(reference.path, { ...documents.get(reference.path), ...data });
  },
};

function paymentStatusRequest(orderId: string, authorization?: string) {
  return localFetch(`${baseUrl}/api/payment-status/${orderId}`, {
    headers: authorization ? { Authorization: authorization } : {},
  });
}

async function expectError(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ['code', 'error', 'request_id']);
  assert.equal(body.code, code);
  assert.equal(typeof body.error, 'string');
  assert.equal(body.request_id, response.headers.get('x-request-id'));
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.deepEqual(providerRequests, [], 'uma rejeição não deve consultar o PagBank');
  assert.ok(documentWrites.every(path => path.startsWith('_rateLimits/')));
  return body;
}

before(async () => {
  Object.assign(process.env, testEnvironment);
  firebaseApp = initializeApp({ projectId: 'demo-gb-payment-access' });
  const auth = getAuth(firebaseApp);
  const database = getFirestore(firebaseApp, testEnvironment.FIREBASE_FIRESTORE_DATABASE_ID);

  // Somente o SDK é simulado: middleware, autorização e rota Express são reais.
  mock.method(auth, 'verifyIdToken', async (token: string, checkRevoked?: boolean) => {
    assert.equal(checkRevoked, true, 'a API deve consultar a revogação de cada sessão');
    verifiedTokens.push(token);
    const uid = token === 'alice-test-token' ? 'alice' : token === 'bob-test-token' ? 'bob' : null;
    if (!uid) {
      const code = token === 'revoked-test-token' ? 'auth/id-token-revoked'
        : token === 'disabled-test-token' ? 'auth/user-disabled'
        : token === 'unavailable-test-token' ? 'auth/internal-error'
        : token === 'expired-test-token' ? 'auth/id-token-expired'
        : 'auth/invalid-id-token';
      throw Object.assign(new Error('Falha simulada de autenticação.'), { code });
    }
    return { uid, sub: uid } as DecodedIdToken;
  });
  mock.method(database, 'collection', ((path: string) => {
    assert.ok(['orders', '_rateLimits'].includes(path), `Coleção inesperada: ${path}`);
    return { doc: (id: string) => documentReference(`${path}/${id}`) };
  }) as typeof database.collection);
  mock.method(database, 'runTransaction', (
    async (callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction)
  ) as typeof database.runTransaction);

  // Nenhuma chamada ao provedor sai do processo, mesmo se a autorização regredir.
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    providerRequests.push(input instanceof Request ? input.url : String(input));
    return new Response('{"error":"provider-test-unavailable"}', {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Servidor HTTP de teste indisponível.');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  documents.clear();
  documentReads.length = 0;
  documentWrites.length = 0;
  verifiedTokens.length = 0;
  providerRequests.length = 0;
  documents.set(`orders/${aliceOrderId}`, {
    userId: 'alice', paymentStatus: 'pago', pagbankStatus: 'PAID',
    clienteEmail: 'alice@example.com', totalCents: 840,
  });
  documents.set(`orders/${bobOrderId}`, {
    userId: 'bob', paymentStatus: 'pendente', pagbankStatus: 'WAITING',
    pagbankCheckoutId: bobCheckoutId, clienteEmail: 'bob@example.com', totalCents: 1200,
  });
});

after(async () => {
  try {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
  } finally {
    mock.restoreAll();
    if (firebaseApp) await deleteApp(firebaseApp);
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('consulta de pagamento exige autenticação antes de ler o banco', async () => {
  await expectError(await paymentStatusRequest(aliceOrderId), 401, 'AUTHENTICATION_REQUIRED');
  assert.deepEqual(verifiedTokens, []);
  assert.deepEqual(documentReads, []);
});

test('consulta de pagamento rejeita esquema de autenticação diferente de Bearer', async () => {
  await expectError(await paymentStatusRequest(aliceOrderId, 'Basic alice-test-token'), 401, 'AUTHENTICATION_REQUIRED');
  assert.deepEqual(verifiedTokens, []);
  assert.deepEqual(documentReads, []);
});

test('a API rejeita token excessivamente grande antes de consultar o Firebase', async () => {
  await expectError(await paymentStatusRequest(aliceOrderId, `Bearer ${'a'.repeat(8193)}`), 401, 'AUTHENTICATION_REQUIRED');
  assert.deepEqual(verifiedTokens, []);
  assert.deepEqual(documentReads, []);
});

for (const token of ['invalid-test-token', 'expired-test-token', 'revoked-test-token', 'disabled-test-token']) {
  test(`consulta de pagamento rejeita token recusado pelo Firebase: ${token}`, async () => {
    await expectError(await paymentStatusRequest(aliceOrderId, `Bearer ${token}`), 401, 'AUTHENTICATION_REQUIRED');
    assert.deepEqual(verifiedTokens, [token]);
    assert.deepEqual(documentReads, []);
  });
}

test('falha do Firebase Auth não é apresentada como sessão inválida', async () => {
  await expectError(await paymentStatusRequest(aliceOrderId, 'Bearer unavailable-test-token'), 503, 'SERVICE_UNAVAILABLE');
  assert.deepEqual(verifiedTokens, ['unavailable-test-token']);
  assert.deepEqual(documentReads, []);
});

for (const [token, otherOrderId] of [
  ['alice-test-token', bobOrderId],
  ['bob-test-token', aliceOrderId],
]) {
  test(`consulta de pagamento impede ${token} de acessar pedido alheio`, async () => {
    const body = await expectError(await paymentStatusRequest(otherOrderId, `Bearer ${token}`), 403, 'ACCESS_DENIED');
    assert.equal(body.error, 'Você não pode consultar este pedido.');
    assert.doesNotMatch(JSON.stringify(body), /alice@example|bob@example|totalCents|pagbankCheckoutId/);
    assert.deepEqual(verifiedTokens, [token]);
  });
}

test('parâmetros do cliente não substituem a identidade autenticada', async () => {
  await expectError(
    await paymentStatusRequest(`${bobOrderId}?userId=bob&uid=bob&admin=true`, 'Bearer alice-test-token'),
    403,
    'ACCESS_DENIED',
  );
  assert.deepEqual(verifiedTokens, ['alice-test-token']);
});

test('proprietário consulta pagamento confirmado sem receber dados pessoais do pedido', async () => {
  const response = await paymentStatusRequest(aliceOrderId, 'Bearer alice-test-token');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    order_id: aliceOrderId, status: 'pago', pagbank_status: 'PAID', reconciled: false,
  });
  assert.deepEqual(verifiedTokens, ['alice-test-token']);
  assert.deepEqual(providerRequests, []);
  assert.ok(documentWrites.every(path => path.startsWith('_rateLimits/')));
});

test('somente o proprietário chega à consulta externa e recebe fallback sem detalhes internos', async () => {
  const response = await paymentStatusRequest(bobOrderId, 'Bearer bob-test-token');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    order_id: bobOrderId, status: 'pendente', pagbank_status: 'WAITING', reconciled: false,
  });
  assert.deepEqual(providerRequests, [
    `https://sandbox.api.pagseguro.com/checkouts/${bobCheckoutId}?limit=100`,
  ]);
  assert.ok(documentWrites.every(path => path.startsWith('_rateLimits/')));
});

test('pedido inexistente retorna erro sem consultar o provedor', async () => {
  await expectError(await paymentStatusRequest('GB-NOTFOUND1234', 'Bearer alice-test-token'), 404, 'NOT_FOUND');
});

test('App Check em enforce também protege a consulta de pagamento', async () => {
  process.env.FIREBASE_APP_CHECK_MODE = 'enforce';
  try {
    await expectError(await paymentStatusRequest(aliceOrderId, 'Bearer alice-test-token'), 401, 'APP_CHECK_REQUIRED');
    assert.deepEqual(verifiedTokens, []);
    assert.deepEqual(documentReads, []);
  } finally {
    process.env.FIREBASE_APP_CHECK_MODE = testEnvironment.FIREBASE_APP_CHECK_MODE;
  }
});
