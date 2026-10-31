import assert from 'node:assert/strict';
import test from 'node:test';
import { promotionalPrice, promotionActiveAt, remainingPromotionTime } from './promotions';
import { repriceCart } from './cartPricing';
import type { Anuncio, CartItem, Promocao } from '../types';
const product: Anuncio = { id: 'p', nome: 'Produto', desc: '', imagem: '', categoria: 'Categoria', preco_base: '10.00', atributos: [], combinacoes: {} };
const promotion: Promocao = { id: 'flash', titulo: 'Oferta', ativa: true, alvoTipo: 'produto', alvoId: 'p', descontoTipo: 'percentual', descontoPercentual: 20, relampago: true, startsAt: 1000, endsAt: 2000 };
test('flash eligibility has exact inclusive start and exclusive expiration boundaries', () => {
  assert.equal(promotionActiveAt(promotion, 999), false); assert.equal(promotionActiveAt(promotion, 1000), true);
  assert.equal(promotionalPrice(1000, product, [promotion], 1999)?.finalCents, 800); assert.equal(promotionalPrice(1000, product, [promotion], 2000), null);
  assert.equal(promotionActiveAt({ ...promotion, endsAt: NaN }, 1500), false); assert.equal(promotionActiveAt({ ...promotion, startsAt: undefined }, 1500), false);
  assert.equal(remainingPromotionTime(86_401_000, 0), '1d 00:00:01'); assert.equal(remainingPromotionTime(1, 2), '00:00:00');
});
test('expired flash offers no longer beat valid promotions; cart repricing preserves artwork approval', () => {
  const fallback = { ...promotion, id: 'normal', relampago: false, startsAt: undefined, endsAt: undefined, descontoPercentual: 10 };
  assert.equal(promotionalPrice(1000, product, [promotion, fallback], 2000)?.promotion.id, 'normal');
  const item = { id: 'item', productId: 'p', nome: 'Produto', imagem: '', selecoes: {}, quantidade: 1, preco: '8.00', precoOriginal: '10.00', promocaoId: 'flash', modeloPath: 'private-path', aprovarArte: true } as CartItem;
  const [updated] = repriceCart([item], [product], [promotion], 2000);
  assert.equal(updated.preco, '10.00'); assert.equal(updated.promocaoId, undefined); assert.equal(updated.modeloPath, 'private-path'); assert.equal(updated.aprovarArte, true);
  const array = [updated]; assert.equal(repriceCart(array, [product], [promotion], 2000), array);
});
