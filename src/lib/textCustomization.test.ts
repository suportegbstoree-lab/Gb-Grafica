import assert from 'node:assert/strict';
import test from 'node:test';
import {
  legacyTextCustomization,
  MAX_CUSTOM_TEXT_LENGTH,
  normalizeTextCustomization,
  productRequiresArtwork,
  productRequiresText,
  textCustomizationFingerprint,
  type PersonalizationFont,
} from './textCustomization';

const fonts: PersonalizationFont[] = [
  { id: 'georgia', nome: 'Georgia', cssFamily: 'Georgia, serif', ativo: true },
  { id: 'arial', nome: 'Arial', cssFamily: 'Arial, sans-serif', ativo: true },
];

test('normaliza texto, fonte e posição em porcentagem', () => {
  assert.deepEqual(normalizeTextCustomization({
    texto: '  Rise   Kujikawa  ',
    fonte: 'georgia',
    posicao: { x: 12.34, y: 87.66 },
  }, fonts), {
    texto: 'Rise Kujikawa',
    fonte: 'georgia',
    fonteNome: 'Georgia',
    fonteCssFamily: 'Georgia, serif',
    posicao: { x: 12.3, y: 87.7 },
  });
});

test('rejeita fonte, texto e coordenadas manipuladas', () => {
  assert.equal(normalizeTextCustomization({ texto: '', fonte: 'arial', posicao: { x: 50, y: 50 } }, fonts), null);
  assert.equal(normalizeTextCustomization({ texto: 'A', fonte: 'injetada', posicao: { x: 50, y: 50 } }, fonts), null);
  assert.equal(normalizeTextCustomization({ texto: 'A', fonte: 'arial', posicao: { x: -1, y: 50 } }, fonts), null);
  assert.equal(normalizeTextCustomization({ texto: 'A'.repeat(MAX_CUSTOM_TEXT_LENGTH + 1), fonte: 'arial', posicao: { x: 50, y: 50 } }, fonts), null);
});

test('converte personalização legada para fonte e posição padrão', () => {
  assert.deepEqual(legacyTextCustomization('  Nome antigo  ', fonts), {
    texto: 'Nome antigo',
    fonte: 'georgia',
    fonteNome: 'Georgia',
    fonteCssFamily: 'Georgia, serif',
    posicao: { x: 50, y: 50 },
  });
});

test('distingue requisitos de arte, texto e combinação', () => {
  assert.equal(productRequiresArtwork('arte'), true);
  assert.equal(productRequiresArtwork('texto_arte'), true);
  assert.equal(productRequiresArtwork('texto'), false);
  assert.equal(productRequiresText('texto'), true);
  assert.equal(productRequiresText('texto_arte'), true);
  assert.equal(productRequiresText('arte'), false);
});

test('fingerprint diferencia fonte e posição do mesmo texto', () => {
  const base = { texto: 'Rise', fonte: 'arial' as const, posicao: { x: 50, y: 50 } };
  assert.notEqual(
    textCustomizationFingerprint(base),
    textCustomizationFingerprint({ ...base, fonte: 'georgia' }),
  );
  assert.notEqual(
    textCustomizationFingerprint(base),
    textCustomizationFingerprint({ ...base, posicao: { x: 60, y: 50 } }),
  );
});
