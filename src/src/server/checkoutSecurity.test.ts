import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkoutRequestDocumentId,
  normalizeCheckoutRequestId,
  trustedPagBankPayLink,
} from './checkoutSecurity.js';

test('normaliza UUID e mantém a tentativa idempotente por usuário', () => {
  const requestId = normalizeCheckoutRequestId('98f3e381-4e94-4864-8a80-123456789abc');
  assert.equal(requestId, '98f3e3814e9448648a80123456789abc');
  assert.ok(requestId);
  assert.equal(
    checkoutRequestDocumentId('usuario-1', requestId),
    checkoutRequestDocumentId('usuario-1', requestId),
  );
  assert.notEqual(
    checkoutRequestDocumentId('usuario-1', requestId),
    checkoutRequestDocumentId('usuario-2', requestId),
  );
  assert.equal(normalizeCheckoutRequestId('não-é-uuid'), null);
});

test('aceita somente links hospedados nos domínios PagBank esperados', () => {
  assert.equal(
    trustedPagBankPayLink('https://pagamento.sandbox.pagbank.com.br/pagamento?code=abc', 'sandbox'),
    'https://pagamento.sandbox.pagbank.com.br/pagamento?code=abc',
  );
  assert.equal(
    trustedPagBankPayLink('https://pagamento.pagseguro.uol.com.br/pagamento?code=abc', 'production'),
    'https://pagamento.pagseguro.uol.com.br/pagamento?code=abc',
  );
  assert.equal(
    trustedPagBankPayLink('https://pagamento.pagseguro.uol.com.br.evil.example/pagamento', 'production'),
    null,
  );
  assert.equal(
    trustedPagBankPayLink('http://pagamento.pagseguro.uol.com.br/pagamento', 'production'),
    null,
  );
});
