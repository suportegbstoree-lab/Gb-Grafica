import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { Anuncio, Promocao } from '../types';
import { formatMoney } from '../lib/commerce';
import { minimumPrice } from '../lib/bundles';
import { promotionActiveAt, promotionalPrice, remainingPromotionTime } from '../lib/promotions';

export default function FlashOffers({ products, promotions, now }: { products: Anuncio[]; promotions: Promocao[]; now: number }) {
  const candidates = useMemo(() => {
    const items = products.filter(product => !product.pacote);
    for (let index = items.length - 1; index > 0; index--) {
      const random = Math.floor(Math.random() * (index + 1));
      [items[index], items[random]] = [items[random], items[index]];
    }
    return items;
  }, [products]);

  const activePromotions = promotions.filter(promotion => promotionActiveAt(promotion, now));
  const offers: { product: Anuncio; price: NonNullable<ReturnType<typeof promotionalPrice>> }[] = [];
  if (activePromotions.length) for (const product of candidates) {
    const cents = minimumPrice(product);
    const price = cents ? promotionalPrice(cents, product, activePromotions, now) : null;
    if (price) offers.push({ product, price });
    if (offers.length === 3) break;
  }
  if (!offers.length) return null;
  return <section aria-labelledby="store-offers-heading" className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 id="store-offers-heading" className="text-xl font-black text-gray-900 sm:text-2xl">Produtos em promoção</h2>
      <Link to="/promocoes" className="inline-flex items-center gap-1.5 rounded-md p-2 text-sm font-bold text-pink-600 hover:underline">
        Ver todas as promoções <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </div>
    <div className="grid auto-cols-[minmax(14rem,85%)] grid-flow-col grid-rows-1 gap-3 overflow-x-auto p-1 snap-x snap-mandatory sm:auto-cols-[minmax(15rem,52%)] lg:grid-cols-3">
      {offers.map(({ product, price }) => (
        <article key={product.id} className="min-w-0 snap-start">
          <Link to={`/produto/${encodeURIComponent(product.id)}`} className="group flex h-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 transition-colors hover:border-pink-400">
            <img src={product.imagem} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-lg object-cover sm:h-16 sm:w-16" />
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-sm font-bold text-gray-900 group-hover:text-pink-600">{product.nome}</h3>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-gray-500">
                <span><span className="sr-only">Valor original </span><s>{formatMoney(price.originalCents / 100)}</s></span>
                <strong className="text-sm text-pink-600">
                  {product.atributos.length > 0 && 'A partir de '}{formatMoney(price.finalCents / 100)}
                </strong>
              </p>
              {price.promotion.endsAt && <p role="timer" className="mt-1 text-xs font-semibold text-gray-600">Termina em {remainingPromotionTime(price.promotion.endsAt, now)}</p>}
            </div>
          </Link>
        </article>
      ))}
    </div>
  </section>;
}
