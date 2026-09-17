import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCartItemId,
  formatBrazilianPhone,
  formatCpf,
  isValidBrazilianPhone,
  isValidCpf,
  parseMoneyToCents,
  slugifyDocumentId,
} from './commerce.js';

test('converte valores monetários brasileiros e decimais para centavos', () => {
  assert.equal(parseMoneyToCents('R$ 8,40'), 840);
  assert.equal(parseMoneyToCents('8.40'), 840);
  assert.equal(parseMoneyToCents('1.234,56'), 123456);
  assert.equal(parseMoneyToCents('1.234'), 123400);
  assert.equal(parseMoneyToCents('A partir de R$ 45,00'), 4500);
  assert.equal(parseMoneyToCents('-10'), null);
});

test('valida e formata CPF', () => {
  assert.equal(isValidCpf('199.912.380-85'), true);
  assert.equal(isValidCpf('111.111.111-11'), false);
  assert.equal(isValidCpf('199.912.380-84'), false);
  assert.equal(formatCpf('19991238085'), '199.912.380-85');
});

test('valida e formata telefone brasileiro', () => {
  assert.equal(isValidBrazilianPhone('(11) 98765-4321'), true);
  assert.equal(isValidBrazilianPhone('(11) 3456-7890'), true);
  assert.equal(isValidBrazilianPhone('(11) 88765-4321'), false);
  assert.equal(isValidBrazilianPhone('11111111111'), false);
  assert.equal(formatBrazilianPhone('11987654321'), '(11) 98765-4321');
});

test('gera IDs seguros para documentos e diferencia personalizações do carrinho', () => {
  assert.equal(slugifyDocumentId('Etiquetas p/ Objetos'), 'etiquetas-p-objetos');

  const base = createCartItemId('produto', { Tamanho: 'P' }, 'Ana', '');
  const same = createCartItemId('produto', { Tamanho: 'P' }, 'Ana', '');
  const different = createCartItemId('produto', { Tamanho: 'P' }, 'Bia', '');
  assert.equal(base, same);
  assert.notEqual(base, different);
});
