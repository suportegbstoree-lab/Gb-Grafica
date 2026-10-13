import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { productionCaptureUserId, sanitizeProductionEvidence } from './pagbankProductionCapture.js';
import { buildPagBankCheckoutEvidence, formatPagBankHomologationReport, savePagBankCheckoutEvidence, savePagBankWebhookEvidence } from './pagbankHomologation.js';

const now = Date.parse('2026-10-08T18:00:00.000Z');
const userId = 'production-test-user';
const orderId = 'GB-PRODUCTION1234';
const checkoutId = 'CHEC_PRODUCTION1234';
const environment = {
  PAGBANK_ENV: 'production',
  PAGBANK_HOMOLOGATION_CAPTURE: 'true',
  PAGBANK_PRODUCTION_CAPTURE_USER_ID: userId,
  PAGBANK_PRODUCTION_CAPTURE_START_AT: new Date(now - 60_000).toISOString(),
  PAGBANK_PRODUCTION_CAPTURE_END_AT: new Date(now + 60 * 60_000).toISOString(),
  APP_URL: 'https://www.gblgrafica.com.br',
};
const checkout = {
  orderId, userId, checkoutId,
  requestId: '5d879765-ec35-49db-809e-1bed15b0da01',
  requestUrl: 'https://api.pagseguro.com/checkouts',
  requestSentAt: new Date(now).toISOString(),
  responseReceivedAt: new Date(now + 500).toISOString(),
  responseStatus: 201,
  requestBody: {
    reference_id: orderId,
    customer: { name: 'Pessoa de Teste', tax_id: '12345678901', email: 'privado@example.com' },
    items: [{ name: 'Nome personalizado privado', quantity: 1, unit_amount: 1199 }],
    payment_methods: [{ type: 'PIX' }],
    shipping: { type: 'FIXED', amount: 0, address: { street: 'Endereco privado' } },
    notification_urls: ['https://www.gblgrafica.com.br/api/webhook/pagbank'],
  },
  responseBody: {
    id: checkoutId, status: 'ACTIVE',
    access_token: 'token-privado',
    links: [{ rel: 'PAY', href: 'https://pagamento.pagbank.com.br/pagamento?code=privado' }],
  },
};
const webhook = {
  orderId, eventHash: 'a'.repeat(64),
  requestUrl: 'https://www.gblgrafica.com.br/api/webhook/pagbank',
  contentType: 'application/json',
  requestReceivedAt: new Date(now + 1000).toISOString(),
  responseSentAt: new Date(now + 1100).toISOString(),
  requestBody: {
    id: 'ORDE_PRODUCTION1234', reference_id: orderId,
    customer: checkout.requestBody.customer,
    charges: [{ id: 'CHAR_PRODUCTION1234', status: 'PAID', amount: { value: 1199, currency: 'BRL' }, payment_method: { type: 'PIX' } }],
  },
  responseStatus: 200,
  responseBody: { received: true, duplicate: false, applied: true },
};

async function inProduction(t: TestContext, callback: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.mock.method(Date, 'now', () => now);
  try { await callback(); } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function fakeDatabase() {
  let document: Record<string, any> | undefined;
  let writes = 0;
  const reference = {
    set: async (data: Record<string, any>) => { document = { ...document, ...structuredClone(data) }; writes++; },
  };
  const db = {
    collection: (name: string) => {
      assert.equal(name, '_pagbankHomologation');
      return { doc: (id: string) => { assert.equal(id, orderId); return reference; } };
    },
    runTransaction: async (callback: (transaction: any) => Promise<void>) => callback({
      get: async () => ({ exists: Boolean(document), data: () => structuredClone(document) }),
      update: (_reference: unknown, data: Record<string, any>) => {
        assert.ok(document);
        for (const [key, value] of Object.entries(data)) {
          if (key.startsWith('webhooks.')) document.webhooks = { ...document.webhooks, [key.slice(9)]: structuredClone(value) };
          else document[key] = structuredClone(value);
        }
        writes++;
      },
      set: () => { throw new Error('Produção não cria evidência apenas com webhook.'); },
    }),
  };
  return { db: db as never, document: () => document, writes: () => writes };
}

test('produção exige conta e janela explícitas de até duas horas', () => {
  assert.equal(productionCaptureUserId(environment, now), userId);
  for (const change of [
    { PAGBANK_ENV: 'sandbox' }, { PAGBANK_ENV: 'prod' },
    { PAGBANK_PRODUCTION_CAPTURE_USER_ID: '' },
    { PAGBANK_PRODUCTION_CAPTURE_START_AT: '' },
    { PAGBANK_PRODUCTION_CAPTURE_END_AT: 'inválida' },
    { PAGBANK_PRODUCTION_CAPTURE_END_AT: new Date(now + 3 * 60 * 60_000).toISOString() },
  ]) assert.equal(productionCaptureUserId({ ...environment, ...change }, now), null);
  assert.equal(productionCaptureUserId(environment, Date.parse(environment.PAGBANK_PRODUCTION_CAPTURE_START_AT) - 1), null);
  assert.equal(productionCaptureUserId(environment, Date.parse(environment.PAGBANK_PRODUCTION_CAPTURE_END_AT)), null);
});

test('conta diferente e tentativa de se identificar pelo body não acessam a coleção', async t => {
  await inProduction(t, async () => {
    const db = { collection: () => { throw new Error('Acesso indevido ao banco.'); } } as never;
    assert.equal(await savePagBankCheckoutEvidence(db, { ...checkout, userId: 'another-user', requestBody: { userId } }), false);
    assert.equal(await savePagBankCheckoutEvidence(db, { ...checkout, userId: undefined }), false);
  });
});

test('janela encerrada interrompe checkout e webhook antes do Firestore', async t => {
  await inProduction(t, async () => {
    process.env.PAGBANK_PRODUCTION_CAPTURE_END_AT = new Date(now).toISOString();
    const db = { collection: () => { throw new Error('Captura expirada não acessa o banco.'); } } as never;
    assert.equal(await savePagBankCheckoutEvidence(db, checkout), false);
    assert.equal(await savePagBankWebhookEvidence(db, webhook), false);
  });
});

test('mascara dados antes de gravar e mantém valores financeiros e correlação', async t => {
  await inProduction(t, async () => {
    const fake = fakeDatabase();
    assert.equal(await savePagBankCheckoutEvidence(fake.db, checkout), true);
    const document = fake.document()!;
    assert.equal(document.environment, 'production');
    assert.equal(document.capture_user_id, userId);
    assert.equal(document.checkout.request.body.reference_id, orderId);
    assert.equal(document.checkout.request.body.items[0].unit_amount, 1199);
    assert.equal(document.checkout.request.body.customer, '[REDACTED]');
    assert.equal(document.checkout.request.body.items[0].name, '[REDACTED]');
    assert.equal(document.checkout.request.body.shipping.address, '[REDACTED]');
    assert.deepEqual(document.checkout.request.body.notification_urls, checkout.requestBody.notification_urls);
    assert.equal(document.checkout.response.body.id, checkoutId);
    assert.equal(document.checkout.response.body.links, '[REDACTED]');
    assert.doesNotMatch(JSON.stringify(document), /privado|Pessoa de Teste|12345678901/);
    assert.equal(await savePagBankWebhookEvidence(fake.db, webhook), true);
    const evidence = fake.document()!.webhooks[webhook.eventHash];
    assert.equal(evidence.request.body.charges[0].status, 'PAID');
    assert.equal(evidence.request.body.charges[0].amount.value, 1199);
    assert.equal(evidence.request.body.customer, '[REDACTED]');
    assert.equal(await savePagBankWebhookEvidence(fake.db, webhook), false);
    assert.equal(fake.writes(), 2);
  });
});

test('webhook não inicia captura de pedidos alheios, antigos ou do Sandbox', async t => {
  await inProduction(t, async () => {
    const fake = fakeDatabase();
    assert.equal(await savePagBankWebhookEvidence(fake.db, webhook), false);
    assert.equal(fake.writes(), 0);
    await savePagBankCheckoutEvidence(fake.db, checkout);
    fake.document()!.capture_user_id = 'another-user';
    assert.equal(await savePagBankWebhookEvidence(fake.db, webhook), false);
    fake.document()!.capture_user_id = userId;
    fake.document()!.capture_window_start_at = '2026-10-07T18:00:00.000Z';
    assert.equal(await savePagBankWebhookEvidence(fake.db, webhook), false);
    fake.document()!.capture_window_start_at = environment.PAGBANK_PRODUCTION_CAPTURE_START_AT;
    fake.document()!.environment = 'sandbox';
    assert.equal(await savePagBankWebhookEvidence(fake.db, webhook), false);
    assert.equal(fake.writes(), 1);
  });
});

test('produção recusa endpoint Sandbox e URL com credenciais ou parâmetros extras', () => {
  for (const requestUrl of [
    'https://sandbox.api.pagseguro.com/checkouts',
    'https://user:password@api.pagseguro.com/checkouts',
    'https://api.pagseguro.com/checkouts?token=privado',
  ]) assert.throws(() => buildPagBankCheckoutEvidence({ ...checkout, requestUrl }, 'production'), /Checkout Produção/);
});

test('campos desconhecidos, textos livres, cartões e URLs com segredo ficam mascarados', () => {
  const body = JSON.parse('{"constructor":"segredo","__proto__":{"token":"segredo"},"unknown":{"value":"segredo"},"message":"Pessoa privada","card":{"number":"4111111111111111"},"notification_urls":["https://www.gblgrafica.com.br/api/webhook/pagbank?token=segredo"]}');
  const sanitized = JSON.stringify(sanitizeProductionEvidence(body));
  assert.doesNotMatch(sanitized, /segredo|Pessoa privada|4111111111111111/);
});

test('exportação identifica produção, preserva HTTP real e recusa mistura de ambientes', async t => {
  await inProduction(t, async () => {
    const fake = fakeDatabase();
    await savePagBankCheckoutEvidence(fake.db, checkout);
    await savePagBankWebhookEvidence(fake.db, webhook);
    const report = formatPagBankHomologationReport([fake.document()], new Date(now).toISOString(), 'production');
    assert.match(report, /AMBIENTE: Produção/);
    assert.match(report, /CORPOS SANITIZADOS/);
    assert.match(report, /POST https:\/\/api.pagseguro.com\/checkouts/);
    assert.match(report, /HTTP 201/);
    assert.match(report, /WEBHOOK 1/);
    assert.doesNotMatch(report, /production-test-user|privado|12345678901/);
    assert.throws(() => formatPagBankHomologationReport([fake.document()]), /outro ambiente/);
    const sandbox = buildPagBankCheckoutEvidence({ ...checkout, requestUrl: 'https://sandbox.api.pagseguro.com/checkouts' });
    assert.throws(() => formatPagBankHomologationReport([fake.document(), sandbox], new Date(now).toISOString(), 'production'), /outro ambiente/);
  });
});

test('erro HTTP e ausência de resposta não viram evidência fictícia de sucesso', async t => {
  await inProduction(t, async () => {
    const fake = fakeDatabase();
    await savePagBankCheckoutEvidence(fake.db, { ...checkout, responseStatus: 401, responseBody: { error_messages: [{ code: 'UNAUTHORIZED', message: 'Bearer segredo' }] } });
    assert.equal(fake.document()!.checkout.response.status, 401);
    assert.equal(fake.document()!.checkout.response.body.error_messages[0].code, 'UNAUTHORIZED');
    assert.doesNotMatch(JSON.stringify(fake.document()), /segredo/);
    await savePagBankCheckoutEvidence(fake.db, { ...checkout, responseStatus: null, responseBody: null });
    const report = formatPagBankHomologationReport([fake.document()], new Date(now).toISOString(), 'production');
    assert.match(report, /HTTP SEM RESPOSTA HTTP/);
  });
});
