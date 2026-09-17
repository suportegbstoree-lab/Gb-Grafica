import assert from 'node:assert/strict';
import test from 'node:test';
import type { Anuncio, Promocao } from '../types';
import { promotionAppliesToProduct, promotionalPrice } from './promotions';

const product = {
  id: 'produto-1',
  categoria: 'Livros',
} as Pick<Anuncio, 'id' | 'categoria'>;

function promotion(overrides: Partial<Promocao>): Promocao {
  return {
    id: 'promo-1',
    titulo: 'Oferta',
    ativa: true,
    alvoTipo: 'produto',
    alvoId: product.id,
    alvoNome: 'Produto',
    descontoTipo: 'percentual',
    descontoPercentual: 10,
    ...overrides,
  };
}

test('aplica promoção por produto ou categoria somente quando ativa', () => {
  assert.equal(promotionAppliesToProduct(promotion({}), product), true);
  assert.equal(promotionAppliesToProduct(promotion({ alvoTipo: 'categoria', alvoId: 'livros', alvoNome: 'Livros' }), product), true);
  assert.equal(promotionAppliesToProduct(promotion({ ativa: false }), product), false);
  assert.equal(promotionAppliesToProduct(promotion({ alvoId: 'outro' }), product), false);
});

test('calcula percentual e valor fixo em centavos', () => {
  assert.deepEqual(promotionalPrice(5000, product, [promotion({ descontoPercentual: 20 })]), {
    promotion: promotion({ descontoPercentual: 20 }),
    originalCents: 5000,
    finalCents: 4000,
    discountCents: 1000,
    percentage: 20,
  });
  const fixed = promotionalPrice(5000, product, [promotion({
    descontoTipo: 'valor_fixo',
    descontoPercentual: undefined,
    descontoFixoCentavos: 1250,
  })]);
  assert.equal(fixed?.finalCents, 3750);
  assert.equal(fixed?.percentage, 25);
});

test('seleciona o menor preço sem acumular promoções', () => {
  const result = promotionalPrice(10000, product, [
    promotion({ id: 'dez', descontoPercentual: 10 }),
    promotion({ id: 'vinte', descontoPercentual: 20 }),
  ]);
  assert.equal(result?.promotion.id, 'vinte');
  assert.equal(result?.finalCents, 8000);
});

test('ignora desconto inválido ou maior que o preço', () => {
  assert.equal(promotionalPrice(1000, product, [promotion({ descontoPercentual: 100 })]), null);
  assert.equal(promotionalPrice(1000, product, [promotion({
    descontoTipo: 'valor_fixo',
    descontoPercentual: undefined,
    descontoFixoCentavos: 1000,
  })]), null);
});
