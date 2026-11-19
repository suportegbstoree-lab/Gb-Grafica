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
  return <section aria-labelledby="store-offers-heading" className="store-offers mx-auto max-w-7xl px-4 pt-2 sm:px-6 md:pt-8">
    <div className="mb-1 flex flex-wrap md:mb-3 items-center justify-between gap-2">
      <h2 id="store-offers-heading" className="font-black text-gray-900 md:text-2xl">Produtos em promoção</h2>
      <Link to="/promocoes" aria-label="Ver todas as promoções" className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-bold text-pink-600 hover:underline md:min-h-0 md:p-2">
        <span className="hidden md:inline">Ver todas as promoções</span>
        <span className="md:hidden" aria-hidden="true">Ver todas</span>
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </div>
    <div className="grid auto-cols-[minmax(14rem,85%)] grid-flow-col grid-rows-1 gap-3 overflow-x-auto p-1 snap-x snap-mandatory sm:auto-cols-[minmax(15rem,52%)] lg:grid-cols-3">
      {offers.map(({ product, price }) => (
        <article key={product.id} className="min-w-0 snap-start">
          <Link to={`/produto/${encodeURIComponent(product.id)}`} className="group flex h-full items-center gap-2.5 rounded-xl border border-gray-200 bg-white p-2 md:gap-3 md:p-3 transition-colors hover:border-pink-400">
            <img src={product.imagem} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-lg object-cover md:h-14 md:w-14" />
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
