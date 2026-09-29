import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pagBankNotificationMatchesProviderEvent,
  parsePagBankNotificationForProviderLookup,
} from './pagbankWebhookFallback.js';

const rawPayment = JSON.stringify({
  id: 'ORDE_41F7962E-D545-464A-BD72-C322E123A782',
  reference_id: 'GB-A0475D5CB5E94508A82D',
  charges: [{
    id: 'CHAR_EDAFFEE0-BE15-4214-935B-F3600E4886EA',
    status: 'PAID',
    amount: { value: 940, currency: 'BRL' },
    payment_method: { type: 'BOLETO' },
  }],
});

test('extrai somente uma referência e um evento PagBank plausíveis', () => {
  const parsed = parsePagBankNotificationForProviderLookup(rawPayment);
  assert.ok(parsed);
  assert.equal(parsed.event.referenceId, 'GB-A0475D5CB5E94508A82D');
  assert.equal(parsed.event.providerStatus, 'PAID');

  assert.equal(parsePagBankNotificationForProviderLookup('{'), null);
  assert.equal(parsePagBankNotificationForProviderLookup('[]'), null);
  assert.equal(parsePagBankNotificationForProviderLookup(JSON.stringify({
    id: '../../segredo',
    reference_id: 'GB-A0475D5CB5E94508A82D',
    status: 'PAID',
  })), null);
  assert.equal(parsePagBankNotificationForProviderLookup(JSON.stringify({
    id: 'ORDE_41F7962E-D545-464A-BD72-C322E123A782',
    reference_id: '../outro',
    status: 'PAID',
  })), null);
});

test('só confirma o payload recebido quando ele coincide com o evento consultado', () => {
  const received = parsePagBankNotificationForProviderLookup(rawPayment)?.event;
  assert.ok(received);
  assert.equal(pagBankNotificationMatchesProviderEvent(received, { ...received }), true);
  assert.equal(pagBankNotificationMatchesProviderEvent(received, {
    ...received,
    providerStatus: 'WAITING',
    paymentStatus: 'pendente',
  }), false);
  assert.equal(pagBankNotificationMatchesProviderEvent(received, {
    ...received,
    amountCents: 840,
  }), false);
  assert.equal(pagBankNotificationMatchesProviderEvent(received, {
    ...received,
    providerId: 'ORDE_00000000-0000-0000-0000-000000000000',
  }), false);
});
