import type { Anuncio, Promocao } from '../types';

export interface PromotionPrice {
  promotion: Promocao;
  originalCents: number;
  finalCents: number;
  discountCents: number;
  percentage: number;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export function promotionAppliesToProduct(promotion: Promocao, product: Pick<Anuncio, 'id' | 'categoria'>): boolean {
  if (!promotion.ativa) return false;
  if (promotion.alvoTipo === 'produto') return promotion.alvoId === product.id;
  if (promotion.alvoTipo === 'categoria') {
    return Boolean(promotion.alvoNome) && promotion.alvoNome === product.categoria;
  }
  return false;
}

export function promotionalPrice(
  originalCents: number,
  product: Pick<Anuncio, 'id' | 'categoria'>,
  promotions: Promocao[],
): PromotionPrice | null {
  if (!Number.isInteger(originalCents) || originalCents <= 1) return null;

  let best: PromotionPrice | null = null;
  for (const promotion of promotions) {
    if (!promotionAppliesToProduct(promotion, product)) continue;
    let discountCents: number | null = null;

    if (promotion.descontoTipo === 'percentual') {
      const percentage = typeof promotion.descontoPercentual === 'number'
        ? promotion.descontoPercentual
        : NaN;
      if (!Number.isFinite(percentage) || percentage <= 0 || percentage >= 100) continue;
      discountCents = Math.round(originalCents * percentage / 100);
    } else if (promotion.descontoTipo === 'valor_fixo') {
      discountCents = positiveInteger(promotion.descontoFixoCentavos);
    }

    if (!discountCents || discountCents >= originalCents) continue;
    const finalCents = originalCents - discountCents;
    const resolved: PromotionPrice = {
      promotion,
      originalCents,
      finalCents,
      discountCents,
      percentage: Math.round((discountCents / originalCents) * 10_000) / 100,
    };
    if (!best || resolved.finalCents < best.finalCents) best = resolved;
  }
  return best;
}

export function formattedDiscountPercentage(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
