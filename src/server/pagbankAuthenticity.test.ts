import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  pagBankAuthenticityFailureReason,
  verifyPagBankAuthenticity,
} from './pagbankAuthenticity.js';

test('valida a autenticidade e rejeita corpo adulterado', () => {
  const token = 'token-de-teste';
  const body = JSON.stringify({ id: 'ORDE_123', status: 'PAID' });
  const authenticity = createHash('sha256').update(`${token}-${body}`).digest('hex');
  assert.equal(verifyPagBankAuthenticity(token, body, authenticity), true);
  assert.equal(verifyPagBankAuthenticity(token, `${body} `, authenticity), false);
  assert.equal(verifyPagBankAuthenticity(token, body, 'invalido'), false);
});

test('classifica falhas de autenticidade sem registrar assinatura ou payload', () => {
  const token = 'token-de-teste';
  const body = JSON.stringify({ id: 'ORDE_123', status: 'PAID' });
  const authenticity = createHash('sha256').update(`${token}-${body}`).digest('hex');

  assert.equal(pagBankAuthenticityFailureReason(token, undefined, authenticity), 'raw_body_missing');
  assert.equal(pagBankAuthenticityFailureReason(token, body, undefined), 'header_missing');
  assert.equal(pagBankAuthenticityFailureReason(token, body, 'invalido'), 'header_format_invalid');
  assert.equal(pagBankAuthenticityFailureReason(token, `${body} `, authenticity), 'signature_mismatch');
  assert.equal(pagBankAuthenticityFailureReason(token, body, authenticity), null);
});
