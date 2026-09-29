import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowedFulfillmentTransitions,
  legacyFulfillmentStatus,
  legacyStatusForFulfillment,
  ORDER_QUEUE_ORDER,
  orderQueueFor,
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

test('organiza as filas administrativas por prioridade operacional', () => {
  assert.deepEqual(ORDER_QUEUE_ORDER, [
    'aguardando_pagamento',
    'pagamento_confirmado',
    'em_producao',
    'pronto_retirada',
    'entregue',
  ]);
  assert.equal(orderQueueFor({ status: 'Pendente', paymentStatus: 'pendente' }), 'aguardando_pagamento');
  assert.equal(orderQueueFor({ status: 'Pago', paymentStatus: 'pago', fulfillmentStatus: 'em_producao' }), 'em_producao');
  assert.equal(orderQueueFor({ status: 'Enviado', paymentStatus: 'pago', fulfillmentStatus: 'enviado' }), 'pronto_retirada');
  assert.equal(orderQueueFor({ status: 'Entregue', paymentStatus: 'pago', fulfillmentStatus: 'entregue' }), 'entregue');
});
