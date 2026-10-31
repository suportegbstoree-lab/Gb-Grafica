import type { Anuncio, Promocao } from '../types';
import { parseMoneyToCents, formatMoney } from '../lib/commerce';
import { promotionalPrice, remainingPromotionTime } from '../lib/promotions';

export default function FlashOffers({ products, promotions, now }: { products: Anuncio[]; promotions: Promocao[]; now: number }) {
  const offers = products.flatMap(product => {
    const candidates = product.atributos.length ? Object.entries(product.combinacoes) : [['', product.preco_base]];
    const prices = candidates.flatMap(([combination, value]) => {
      const cents = parseMoneyToCents(value), price = cents ? promotionalPrice(cents, product, promotions, now) : null;
      return price?.promotion.relampago && price.promotion.endsAt ? [{ product, combination, price }] : [];
    }).sort((a, b) => a.price.finalCents - b.price.finalCents);
    return prices.slice(0, 1);
  });
  if (!offers.length) return null;
  return <section aria-label="Promoções relâmpago" className="mx-auto mb-12 max-w-7xl px-4 sm:px-6">
    <h2 className="mb-5 text-2xl font-black text-gray-900">Promoções relâmpago</h2>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{offers.map(({ product, combination, price }) => <article key={product.id} className="min-w-0 rounded-2xl border border-pink-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-3"><img src={product.imagem} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl object-cover" /><div className="min-w-0"><h3 className="break-words font-bold text-gray-900">{product.nome}</h3>{combination && <p className="text-xs text-gray-500">Preço para {combination.replaceAll('|', ' · ')}</p>}</div></div>
      <dl className="space-y-1 text-sm"><div className="flex justify-between gap-2 text-gray-500"><dt>Valor original</dt><dd>{formatMoney(price.originalCents / 100)}</dd></div><div className="flex justify-between gap-2 text-green-700"><dt>Desconto</dt><dd>− {formatMoney(price.discountCents / 100)}</dd></div><div className="flex justify-between gap-2 font-black text-pink-600"><dt>Com desconto</dt><dd>{formatMoney(price.finalCents / 100)}</dd></div></dl>
      <p role="timer" aria-label={`Tempo restante da promoção de ${product.nome}`} className="mt-4 rounded-lg bg-pink-50 px-3 py-2 text-center font-mono text-sm font-bold text-pink-700">Termina em {remainingPromotionTime(price.promotion.endsAt!, now)}</p>
      <a href={`#produto-${product.id}`} className="mt-3 block rounded-lg bg-gray-900 px-4 py-3 text-center text-xs font-bold text-white">Ver produto</a>
    </article>)}</div>
  </section>;
}
