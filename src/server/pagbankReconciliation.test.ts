import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseCheckoutResponse,
  parseOrderEvents,
  reconcilePagBankCheckout,
  selectReconciliationEvent,
  type PagBankLookupRequest,
} from './pagbankReconciliation.js';

const checkoutId = 'CHEC_7A816AD5-8EA3-4590-BA80-26DE9D7E4F65';
const referenceId = 'GB-4861A9396DD84E739195';
const providerOrderId = 'ORDE_68F69EA2-F827-46A1-A137-F2ADE9619CE1';

test('reconcilia checkout e cobrança paga consultando apenas URLs construídas pelo servidor', async () => {
  const requests: string[] = [];
  const fakeRequest: PagBankLookupRequest = async url => {
    requests.push(url);
    if (url.includes('/checkouts/')) {
      return {
        status: 200,
        data: {
          id: checkoutId,
          reference_id: referenceId,
          status: 'ACTIVE',
          orders: [{
            id: providerOrderId,
            links: [{ rel: 'GET', href: 'https://attacker.example/pedido' }],
          }],
        },
      };
    }
    return {
      status: 200,
      data: {
        id: providerOrderId,
        charges: [{
          id: 'CHAR_51DE83E4-2CC7-4F10-8494-8AFF281FD88E',
          status: 'PAID',
          amount: { value: 840, currency: 'BRL' },
          payment_method: { type: 'CREDIT_CARD' },
        }],
      },
    };
  };

  const result = await reconcilePagBankCheckout({
    baseUrl: 'https://sandbox.api.pagseguro.com',
    token: 'token-sandbox',
    checkoutId,
    referenceId,
  }, fakeRequest);

  assert.deepEqual(requests, [
    `https://sandbox.api.pagseguro.com/checkouts/${checkoutId}?limit=100`,
    `https://sandbox.api.pagseguro.com/orders/${providerOrderId}`,
  ]);
  assert.equal(result.event?.paymentStatus, 'pago');
  assert.equal(result.event?.amountCents, 840);
  assert.equal(result.event?.currency, 'BRL');
  assert.equal(result.event?.providerId, providerOrderId);
});

test('recusa checkout ou referência diferentes do pedido armazenado', () => {
  assert.throws(() => parseCheckoutResponse({
    id: 'CHEC_OUTRO-12345678',
    reference_id: referenceId,
    status: 'ACTIVE',
  }, checkoutId, referenceId), /checkout diferente/);

  assert.throws(() => parseCheckoutResponse({
    id: checkoutId,
    reference_id: 'GB-OUTROPEDIDO1234',
    status: 'ACTIVE',
  }, checkoutId, referenceId), /referência diferente/);
});

test('não segue links fornecidos pelo PagBank e ignora IDs de pedido inválidos', () => {
  const result = parseCheckoutResponse({
    id: checkoutId,
    reference_id: referenceId,
    status: 'ACTIVE',
    orders: [
      { id: providerOrderId, links: [{ href: 'https://attacker.example' }] },
      { id: '../../segredo' },
    ],
  }, checkoutId, referenceId);

  assert.deepEqual(result.providerOrderIds, [providerOrderId]);
});

test('seleciona pagamento confirmado acima de tentativas pendentes ou recusadas', () => {
  const events = parseOrderEvents({
    id: providerOrderId,
    charges: [
      { id: 'CHAR_WAITING', status: 'WAITING', amount: { value: 840, currency: 'BRL' } },
      { id: 'CHAR_DECLINED', status: 'DECLINED', amount: { value: 840, currency: 'BRL' } },
      { id: 'CHAR_PAID', status: 'PAID', amount: { value: 840, currency: 'BRL' } },
    ],
  }, providerOrderId, referenceId);

  assert.equal(selectReconciliationEvent(events)?.paymentStatus, 'pago');
});

test('propaga falha da API sem produzir confirmação local', async () => {
  await assert.rejects(reconcilePagBankCheckout({
    baseUrl: 'https://sandbox.api.pagseguro.com',
    token: 'token-sandbox',
    checkoutId,
    referenceId,
  }, async () => {
    throw new Error('API indisponível');
  }), /API indisponível/);
});
