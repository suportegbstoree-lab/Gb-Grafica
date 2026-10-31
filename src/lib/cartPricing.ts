import type { Anuncio, CartItem, Promocao } from '../types';
import { parseMoneyToCents } from './commerce';
import { promotionalPrice } from './promotions';

export function repriceCart(items: CartItem[], products: Anuncio[], promotions: Promocao[], now: number): CartItem[] {
  let changed = false;
  const updated = items.map(item => {
    const product = products.find(product => product.id === item.productId);
    if (!product) return item;
    const key = product.atributos.map(attribute => item.selecoes[attribute.nome] || '').join('|');
    const amount = parseMoneyToCents(product.atributos.length ? product.combinacoes[key] : product.preco_base);
    if (amount === null || amount <= 0) return item;
    const price = promotionalPrice(amount, product, promotions, now);
    const preco = ((price?.finalCents ?? amount) / 100).toFixed(2);
    if (parseMoneyToCents(item.preco) === (price?.finalCents ?? amount) && item.promocaoId === price?.promotion.id && item.precoOriginal === (price ? (amount / 100).toFixed(2) : undefined) && item.descontoPercentual === price?.percentage) return item;
    changed = true;
    const { precoOriginal: _, promocaoId: _promotion, descontoPercentual: _discount, ...rest } = item;
    return { ...rest, preco, ...(price ? { precoOriginal: (amount / 100).toFixed(2), promocaoId: price.promotion.id, descontoPercentual: price.percentage } : {}) };
  });
  return changed ? updated : items;
}
