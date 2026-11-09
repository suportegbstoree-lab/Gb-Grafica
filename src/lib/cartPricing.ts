import { parseBundle, validateBundleItems, selectedPrice, discountBundle } from './bundles';
import type { Anuncio, CartItem, Promocao } from '../types';
import { parseMoneyToCents } from './commerce';
import { promotionalPrice } from './promotions';

export function repriceCart(items: CartItem[], products: Anuncio[], promotions: Promocao[], now: number): CartItem[] {
  let changed = false;
  const updated = items.map(item => {
    const product = products.find(product => product.id === item.productId);
    if (!product) return item;
    if(product.pacote || item.bundleItems) {
      try {
        const definition=parseBundle(product.pacote); if(!definition || definition.revision!==item.bundleRevision) return item;
        const children=validateBundleItems(product,item.bundleItems,item.quantidade).map(child=>{ const p=products.find(p=>p.id===child.productId && !p.pacote); if(!p) throw new Error('Produto removido'); const amount=selectedPrice(p,child.selecoes); if(!amount || amount<=0) throw new Error('Preço inválido'); return {...child,preco:(amount/100).toFixed(2)}; });
        const amount=discountBundle(children.reduce((sum,c)=>sum+parseMoneyToCents(c.preco)!*c.quantidade,0),definition);
        if(item.preco===(amount/100).toFixed(2) && children.every((c,i)=>c.preco===item.bundleItems![i].preco)) return item;
        changed=true; return {...item,preco:(amount/100).toFixed(2),bundleItems:children};
      } catch {return item;}
    }
    const amount = selectedPrice(product, item.selecoes);
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
