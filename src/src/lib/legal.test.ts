import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentLegalAcceptance,
  hasCompleteLegalBusinessData,
  isCurrentLegalAcceptance,
  LEGAL_VERSIONS,
  missingLegalBusinessFields,
} from './legal.js';

test('aceita somente a versão jurídica atualmente publicada', () => {
  const acceptance = currentLegalAcceptance();
  assert.equal(isCurrentLegalAcceptance(acceptance), true);
  assert.equal(isCurrentLegalAcceptance({ ...acceptance, accepted: false }), false);
  assert.equal(isCurrentLegalAcceptance({ ...acceptance, termsVersion: 'anterior' }), false);
  assert.equal(acceptance.privacyVersion, LEGAL_VERSIONS.privacy);
});

test('identifica dados comerciais obrigatórios ausentes', () => {
  const complete = {
    razao_social: 'GB Gráfica Ltda.',
    documento_fiscal: '00.000.000/0001-00',
    endereco_comercial: 'Rua Exemplo, 123, Franca/SP',
    email_atendimento: 'atendimento@example.com',
    email_privacidade: 'privacidade@example.com',
    prazo_producao: '2 a 5 dias úteis',
  };

  assert.equal(hasCompleteLegalBusinessData(complete), true);
  assert.deepEqual(missingLegalBusinessFields({ ...complete, documento_fiscal: '  ' }), ['documento_fiscal']);
});
