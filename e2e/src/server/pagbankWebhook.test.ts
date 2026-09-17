import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pagBankBuyerFeeCents,
  parsePagBankWebhookEvent,
  shouldApplyPaymentStatus,
  validatePagBankWebhookEvent,
} from './pagbankWebhook.js';

const paidPayload = {
  id: 'ORDE_123',
  reference_id: 'GB-123',
  charges: [{
    id: 'CHAR_123',
    status: 'PAID',
    amount: { value: 840, currency: 'BRL' },
    payment_method: { type: 'CREDIT_CARD' },
  }],
};

test('interpreta uma notificação de pagamento do PagBank', () => {
  const event = parsePagBankWebhookEvent(paidPayload);
  assert.ok(event);
  assert.equal(event.referenceId, 'GB-123');
  assert.equal(event.paymentStatus, 'pago');
  assert.equal(event.amountCents, 840);
  assert.equal(event.paymentMethod, 'CREDIT_CARD');
});

test('rejeita confirmação com valor ou moeda divergentes', () => {
  const event = parsePagBankWebhookEvent(paidPayload);
  assert.ok(event);
  assert.equal(validatePagBankWebhookEvent(event, { totalCents: 900 }), 'Valor pago diverge do pedido.');
  assert.equal(
    validatePagBankWebhookEvent({ ...event, currency: 'USD' }, { totalCents: 840 }),
    'Moeda do pagamento diverge do pedido.',
  );
});

test('aceita somente o acréscimo exato do boleto hospedado', () => {
  const boletoEvent = parsePagBankWebhookEvent({
    ...paidPayload,
    charges: [{
      ...paidPayload.charges[0],
      amount: { value: 940, currency: 'BRL' },
      payment_method: { type: 'BOLETO' },
    }],
  });
  assert.ok(boletoEvent);
  assert.equal(validatePagBankWebhookEvent(boletoEvent, { totalCents: 840 }), null);
  assert.equal(pagBankBuyerFeeCents(boletoEvent, { totalCents: 840 }), 100);

  assert.equal(
    validatePagBankWebhookEvent({ ...boletoEvent, amountCents: 939 }, { totalCents: 840 }),
    'Valor pago diverge do pedido.',
  );
  assert.equal(
    validatePagBankWebhookEvent({ ...boletoEvent, amountCents: 941 }, { totalCents: 840 }),
    'Valor pago diverge do pedido.',
  );
});

test('não aceita acréscimo nem subpagamento em cartão ou PIX', () => {
  const event = parsePagBankWebhookEvent(paidPayload);
  assert.ok(event);
  assert.equal(
    validatePagBankWebhookEvent({ ...event, amountCents: 940 }, { totalCents: 840 }),
    'Valor pago diverge do pedido.',
  );
  assert.equal(
    validatePagBankWebhookEvent({ ...event, amountCents: 800, paymentMethod: 'PIX' }, { totalCents: 840 }),
    'Valor pago diverge do pedido.',
  );
  assert.equal(pagBankBuyerFeeCents({ ...event, amountCents: 940 }, { totalCents: 840 }), null);
});

test('rejeita identificador PagBank diferente do pedido salvo', () => {
  const event = parsePagBankWebhookEvent(paidPayload);
  assert.ok(event);
  assert.equal(
    validatePagBankWebhookEvent(event, { totalCents: 840, pagbankOrderId: 'ORDE_OUTRO' }),
    'Pedido PagBank informado não corresponde ao registro.',
  );
});

test('pagamento confirmado não pode regredir por evento atrasado', () => {
  assert.equal(shouldApplyPaymentStatus('pago', 'pendente'), false);
  assert.equal(shouldApplyPaymentStatus('pago', 'recusado'), false);
  assert.equal(shouldApplyPaymentStatus('em_analise', 'pago'), true);
});

test('interpreta expiração do checkout sem fingir pagamento', () => {
  const event = parsePagBankWebhookEvent({
    id: 'CHEC_123',
    reference_id: 'GB-123',
    status: 'EXPIRED',
  });
  assert.ok(event);
  assert.equal(event.kind, 'checkout');
  assert.equal(event.paymentStatus, 'expirado');
});
