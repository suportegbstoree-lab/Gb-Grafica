import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPagBankCheckoutEvidence,
  buildPagBankWebhookEvidence,
  formatPagBankHomologationReport,
  isPagBankHomologationCaptureEnabled,
  savePagBankCheckoutEvidence,
  savePagBankWebhookEvidence,
} from './pagbankHomologation.js';

const orderId = 'GB-1234567890ABCDEF';
const checkoutId = 'CHEC_12345678-1234-1234-1234-123456789ABC';
const checkoutUrl = 'https://sandbox.api.pagseguro.com/checkouts';

test('captura de homologação só pode ser ativada em Sandbox', () => {
  assert.equal(isPagBankHomologationCaptureEnabled({
    PAGBANK_ENV: 'sandbox',
    PAGBANK_HOMOLOGATION_CAPTURE: 'true',
  }), true);
  assert.equal(isPagBankHomologationCaptureEnabled({
    PAGBANK_ENV: 'production',
    PAGBANK_HOMOLOGATION_CAPTURE: 'true',
  }), false);
  assert.equal(isPagBankHomologationCaptureEnabled({
    PAGBANK_ENV: 'sandbox',
    PAGBANK_HOMOLOGATION_CAPTURE: 'false',
  }), false);
});

test('não toca no Firestore quando a aplicação está em produção', async () => {
  const previousEnvironment = process.env.PAGBANK_ENV;
  const previousCapture = process.env.PAGBANK_HOMOLOGATION_CAPTURE;
  process.env.PAGBANK_ENV = 'production';
  process.env.PAGBANK_HOMOLOGATION_CAPTURE = 'true';

  try {
    const result = await savePagBankCheckoutEvidence({
      collection: () => {
        throw new Error('O Firestore não deveria ser acessado.');
      },
    } as never, {
      orderId,
      requestId: '5d879765-ec35-49db-809e-1bed15b0da01',
      requestUrl: 'https://api.pagseguro.com/checkouts',
      requestBody: {},
      requestSentAt: '2026-09-09T12:00:00.000Z',
      responseStatus: 200,
      responseBody: {},
      responseReceivedAt: '2026-09-09T12:00:01.000Z',
    });
    assert.equal(result, false);
  } finally {
    restoreEnvironment('PAGBANK_ENV', previousEnvironment);
    restoreEnvironment('PAGBANK_HOMOLOGATION_CAPTURE', previousCapture);
  }
});

test('grava checkout e primeiro webhook somente na coleção técnica', async () => {
  const previousEnvironment = process.env.PAGBANK_ENV;
  const previousCapture = process.env.PAGBANK_HOMOLOGATION_CAPTURE;
  process.env.PAGBANK_ENV = 'sandbox';
  process.env.PAGBANK_HOMOLOGATION_CAPTURE = 'true';
  const writes: Array<{ operation: string; data: Record<string, unknown> }> = [];
  const reference = {
    set: async (data: Record<string, unknown>) => {
      writes.push({ operation: 'set-checkout', data });
    },
  };
  const db = {
    collection: (name: string) => {
      assert.equal(name, '_pagbankHomologation');
      return {
        doc: (id: string) => {
          assert.equal(id, orderId);
          return reference;
        },
      };
    },
    runTransaction: async (callback: (transaction: Record<string, unknown>) => Promise<void>) => callback({
      get: async () => ({ exists: false, data: () => undefined }),
      set: (_target: unknown, data: Record<string, unknown>) => {
        writes.push({ operation: 'set-webhook', data });
      },
      update: () => {
        throw new Error('Documento inexistente deve usar set.');
      },
    }),
  };

  try {
    assert.equal(await savePagBankCheckoutEvidence(db as never, {
      orderId,
      checkoutId,
      requestId: '5d879765-ec35-49db-809e-1bed15b0da01',
      requestUrl: checkoutUrl,
      requestBody: { reference_id: orderId },
      requestSentAt: '2026-09-09T12:00:00.000Z',
      responseStatus: 201,
      responseBody: { id: checkoutId },
      responseReceivedAt: '2026-09-09T12:00:01.000Z',
    }), true);
    assert.equal(await savePagBankWebhookEvidence(db as never, {
      orderId,
      eventHash: 'c'.repeat(64),
      requestUrl: 'https://www.gblgrafica.com.br/api/webhook/pagbank',
      contentType: 'application/json',
      requestBody: { id: 'ORDE_123', reference_id: orderId },
      requestReceivedAt: '2026-09-09T12:05:00.000Z',
      responseStatus: 200,
      responseBody: { received: true },
      responseSentAt: '2026-09-09T12:05:00.100Z',
    }), true);
    assert.deepEqual(writes.map(write => write.operation), ['set-checkout', 'set-webhook']);
  } finally {
    restoreEnvironment('PAGBANK_ENV', previousEnvironment);
    restoreEnvironment('PAGBANK_HOMOLOGATION_CAPTURE', previousCapture);
  }
});

test('monta evidência real do checkout sem armazenar Authorization', () => {
  const evidence = buildPagBankCheckoutEvidence({
    orderId,
    checkoutId,
    requestId: '5d879765-ec35-49db-809e-1bed15b0da01',
    requestUrl: checkoutUrl,
    requestSentAt: '2026-09-09T12:00:00.000Z',
    requestBody: {
      reference_id: orderId,
      customer: { name: 'Cliente Sandbox', tax_id: '19991238085' },
      payment_methods: [{ type: 'CREDIT_CARD' }, { type: 'BOLETO' }, { type: 'PIX' }],
    },
    responseStatus: 201,
    responseBody: {
      id: checkoutId,
      status: 'ACTIVE',
      access_token: 'segredo-que-nao-pode-ser-gravado',
    },
    responseReceivedAt: '2026-09-09T12:00:01.000Z',
  });

  const checkout = evidence.checkout as Record<string, Record<string, unknown>>;
  const request = checkout.request;
  const response = checkout.response;
  assert.equal((request.headers as Record<string, string>).Authorization, 'Bearer [REDACTED]');
  assert.equal((response.body as Record<string, string>).access_token, '[REDACTED]');
  assert.equal(
    ((request.body as Record<string, Record<string, string>>).customer).tax_id,
    '19991238085',
  );
});

test('recusa captura de checkout fora do endpoint Sandbox', () => {
  assert.throws(() => buildPagBankCheckoutEvidence({
    orderId,
    requestId: '5d879765-ec35-49db-809e-1bed15b0da01',
    requestUrl: 'https://api.pagseguro.com/checkouts',
    requestSentAt: '2026-09-09T12:00:00.000Z',
    requestBody: {},
    responseStatus: 200,
    responseBody: {},
    responseReceivedAt: '2026-09-09T12:00:01.000Z',
  }), /somente o endpoint de Checkout Sandbox/);
});

test('monta evidência do webhook com assinatura removida', () => {
  const evidence = buildPagBankWebhookEvidence({
    orderId,
    eventHash: 'a'.repeat(64),
    requestUrl: 'https://www.gblgrafica.com.br/api/webhook/pagbank',
    contentType: 'application/json',
    requestBody: {
      id: 'ORDE_123',
      reference_id: orderId,
      charges: [{ status: 'PAID', payment_method: { type: 'PIX' } }],
    },
    requestReceivedAt: '2026-09-09T12:05:00.000Z',
    responseStatus: 200,
    responseBody: { received: true, duplicate: false, applied: true },
    responseSentAt: '2026-09-09T12:05:00.100Z',
  });

  const request = evidence.request as Record<string, unknown>;
  assert.equal(
    (request.headers as Record<string, string>)['x-authenticity-token'],
    '[REDACTED]',
  );
  assert.equal(evidence.verification, 'signature');
});

test('identifica webhook confirmado por consulta sem inventar header ausente', () => {
  const evidence = buildPagBankWebhookEvidence({
    orderId,
    eventHash: 'd'.repeat(64),
    requestUrl: 'https://www.gblgrafica.com.br/api/webhook/pagbank',
    contentType: 'application/json',
    requestBody: { id: 'ORDE_123', reference_id: orderId, charges: [{ status: 'PAID' }] },
    requestReceivedAt: '2026-09-09T12:05:00.000Z',
    responseStatus: 200,
    responseBody: { received: true, verified_by: 'provider_lookup', applied: true },
    responseSentAt: '2026-09-09T12:05:00.100Z',
    verification: 'provider_lookup',
    authenticityHeaderPresent: false,
  });

  const request = evidence.request as Record<string, unknown>;
  assert.equal(evidence.verification, 'provider_lookup');
  assert.equal(
    (request.headers as Record<string, string>)['x-authenticity-token'],
    '[NOT PROVIDED]',
  );
});

test('formata anexo com request, response, meios e webhook reais', () => {
  const checkout = buildPagBankCheckoutEvidence({
    orderId,
    checkoutId,
    requestId: '5d879765-ec35-49db-809e-1bed15b0da01',
    requestUrl: checkoutUrl,
    requestSentAt: '2026-09-09T12:00:00.000Z',
    requestBody: {
      reference_id: orderId,
      payment_methods: [{ type: 'CREDIT_CARD' }, { type: 'BOLETO' }, { type: 'PIX' }],
    },
    responseStatus: 201,
    responseBody: { id: checkoutId, status: 'ACTIVE' },
    responseReceivedAt: '2026-09-09T12:00:01.000Z',
  });
  const webhook = buildPagBankWebhookEvidence({
    orderId,
    eventHash: 'b'.repeat(64),
    requestUrl: 'https://www.gblgrafica.com.br/api/webhook/pagbank',
    contentType: 'application/json',
    requestBody: { id: 'ORDE_123', reference_id: orderId, charges: [{ status: 'PAID' }] },
    requestReceivedAt: '2026-09-09T12:05:00.000Z',
    responseStatus: 200,
    responseBody: { received: true, duplicate: false, applied: true },
    responseSentAt: '2026-09-09T12:05:00.100Z',
  });
  const report = formatPagBankHomologationReport([{
    ...checkout,
    webhooks: { ['b'.repeat(64)]: webhook },
  }], '2026-09-09T13:00:00.000Z');

  assert.match(report, /MEIOS DISPONIBILIZADOS: CREDIT_CARD, BOLETO, PIX/);
  assert.match(report, /POST https:\/\/sandbox\.api\.pagseguro\.com\/checkouts/);
  assert.match(report, /HTTP 201/);
  assert.match(report, new RegExp(checkoutId));
  assert.match(report, /WEBHOOK 1 — REQUEST RECEBIDO DO PAGBANK/);
  assert.match(report, /Verificação: assinatura SHA-256 válida/);
  assert.match(report, /Authorization: Bearer \[REDACTED\]/);
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
