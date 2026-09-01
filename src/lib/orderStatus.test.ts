import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowedFulfillmentTransitions,
  legacyFulfillmentStatus,
  legacyStatusForFulfillment,
} from './orderStatus.js';

test('não permite produção ou envio antes do pagamento', () => {
  assert.deepEqual(
    allowedFulfillmentTransitions('aguardando_pagamento', 'pendente', 'entrega'),
    ['aguardando_pagamento'],
  );
});

test('aplica o fluxo operacional conforme a entrega', () => {
  assert.deepEqual(
    allowedFulfillmentTransitions('pagamento_confirmado', 'pago', 'entrega'),
    ['pagamento_confirmado', 'em_producao'],
  );
  assert.deepEqual(
    allowedFulfillmentTransitions('em_producao', 'pago', 'entrega'),
    ['em_producao', 'enviado'],
  );
  assert.deepEqual(
    allowedFulfillmentTransitions('em_producao', 'pago', 'retirada'),
    ['em_producao', 'pronto_retirada'],
  );
});

test('mantém compatibilidade com pedidos antigos', () => {
  assert.equal(legacyFulfillmentStatus('Pago', 'pago'), 'pagamento_confirmado');
  assert.equal(legacyFulfillmentStatus('Processando', 'pago'), 'em_producao');
  assert.equal(legacyStatusForFulfillment('pronto_retirada'), 'Processando');
});
