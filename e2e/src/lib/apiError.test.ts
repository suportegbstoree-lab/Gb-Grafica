import assert from 'node:assert/strict';
import test from 'node:test';
import { apiErrorMessage } from './apiError.js';

test('acrescenta a referência segura retornada pela API', () => {
  assert.equal(
    apiErrorMessage({ error: 'Não foi possível concluir.', request_id: 'trace-checkout-1234' }, 'Falha padrão.'),
    'Não foi possível concluir. Referência: trace-checkout-1234',
  );
});

test('ignora referência inválida e usa mensagem pública ou fallback', () => {
  assert.equal(apiErrorMessage({ error: 'Falha.', request_id: 'quebra\nlinha' }, 'Padrão.'), 'Falha.');
  assert.equal(apiErrorMessage({}, 'Padrão.'), 'Padrão.');
});
