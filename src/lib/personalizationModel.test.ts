import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isComposablePersonalizationImage,
  MAX_PERSONALIZATION_MODEL_BYTES,
  personalizationModelDimensions,
  personalizationModelName,
  personalizationTextScale,
} from './personalizationModel';

test('aceita apenas imagem raster segura para compor o modelo', () => {
  assert.equal(isComposablePersonalizationImage('image/png', 1024), true);
  assert.equal(isComposablePersonalizationImage('image/jpeg', 1024), true);
  assert.equal(isComposablePersonalizationImage('image/webp', 1024), true);
  assert.equal(isComposablePersonalizationImage('application/pdf', 1024), false);
  assert.equal(isComposablePersonalizationImage('image/png', MAX_PERSONALIZATION_MODEL_BYTES + 1), false);
});

test('reduz imagens enormes preservando a proporção', () => {
  assert.deepEqual(personalizationModelDimensions(1200, 800), { width: 1200, height: 800 });
  const reduced = personalizationModelDimensions(12_000, 8_000);
  assert.ok(reduced);
  assert.ok(reduced.width <= 3200);
  assert.ok(reduced.width * reduced.height <= 10_000_000);
  assert.equal(Number((reduced.width / reduced.height).toFixed(2)), 1.5);
  assert.equal(personalizationModelDimensions(0, 800), null);
});

test('gera nome seguro e reduz o texto conforme o comprimento', () => {
  assert.equal(personalizationModelName('Livro de Receitas', 'arte final.jpeg'), 'arte-final-modelo.webp');
  assert.ok(personalizationTextScale('Nome') > personalizationTextScale('x'.repeat(150)));
});

