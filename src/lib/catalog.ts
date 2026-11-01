import type { Anuncio, Promocao } from '../types.js';
import { minimumPrice, bundleMinimum, parseBundle } from './bundles.js';
import { promotionalPrice } from './promotions.js';
export type CatalogSection = 'todos' | 'destaques' | 'promocoes' | 'lancamentos' | 'pacotes';
export interface ProductRating {
  count: number;
  sum: number;
  average: number;
}
export const normalizeSearch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
export function displayPrice(product: Anuncio, products: Anuncio[], promotions: Promocao[], now: number) {
  try {
    const bundle = parseBundle(product.pacote);
    const base = bundle ? bundleMinimum(bundle, products, product.id) : minimumPrice(product);
    return base === null
      ? null
      : bundle
        ? base
        : (promotionalPrice(base, product, promotions, now)?.finalCents ?? base);
  } catch {
    return null;
  }
}
export function filterCatalog(
  products: Anuncio[],
  promotions: Promocao[],
  ratings: Record<string, ProductRating>,
  filters: { section: CatalogSection; category?: string; query?: string; min?: number; max?: number; rating?: number },
  now = Date.now(),
) {
  const terms = normalizeSearch(filters.query || '')
    .split(/\s+/)
    .filter(Boolean);
  return products.filter((p) => {
    const base = minimumPrice(p),
      promo = !p.pacote && base !== null ? promotionalPrice(base, p, promotions, now) : null;
    if (
      (filters.section === 'destaques' && !p.destaque) ||
      (filters.section === 'promocoes' &&
        !promo &&
        !(p.pacote && p.pacote.discountType !== 'none' && p.pacote.discountValue > 0)) ||
      (filters.section === 'lancamentos' && !p.lancamento) ||
      (filters.section === 'pacotes' && !p.pacote)
    )
      return false;
    if (filters.category && p.categoria !== filters.category) return false;
    const text = normalizeSearch([p.nome, p.desc, p.categoria, ...(p.tags || [])].join(' '));
    if (!terms.every((term) => text.includes(term))) return false;
    const price = displayPrice(p, products, promotions, now);
    if (
      (filters.min !== undefined && (price === null || price < filters.min)) ||
      (filters.max !== undefined && (price === null || price > filters.max))
    )
      return false;
    if (filters.rating && (ratings[p.id]?.average || 0) < filters.rating) return false;
    return true;
  });
}
export function publicPageUrl(location: Pick<Location, 'origin' | 'pathname' | 'search'>, productId?: string) {
  const url = new URL(productId ? `/produto/${encodeURIComponent(productId)}` : location.pathname, location.origin);
  if (!productId) {
    const source = new URLSearchParams(location.search);
    for (const key of ['q', 'categoria', 'min', 'max', 'avaliacao'])
      if (source.has(key)) url.searchParams.set(key, source.get(key)!);
  }
  return url.href;
}
