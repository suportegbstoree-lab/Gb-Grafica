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

export function promotionAppliesToProduct(promotion: Promocao, product: Pick<Anuncio, 'id' | 'categoria'>, now = Date.now()): boolean {
  if (!promotionActiveAt(promotion, now)) return false;
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
  now = Date.now(),
): PromotionPrice | null {
  if (!Number.isInteger(originalCents) || originalCents <= 1) return null;

  let best: PromotionPrice | null = null;
  for (const promotion of promotions) {
    if (!promotionAppliesToProduct(promotion, product, now)) continue;
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

export function validPromotionWindow(promotion: Pick<Promocao, 'relampago' | 'startsAt' | 'endsAt'>): boolean {
  if (promotion.relampago !== undefined && typeof promotion.relampago !== 'boolean') return false;
  if (!promotion.relampago && promotion.startsAt === undefined && promotion.endsAt === undefined) return true;
  return Number.isSafeInteger(promotion.startsAt) && Number.isSafeInteger(promotion.endsAt) && promotion.startsAt! >= 0 &&
    promotion.endsAt! > promotion.startsAt! && promotion.endsAt! <= 4_102_444_800_000;
}
export function promotionActiveAt(promotion: Pick<Promocao, 'ativa' | 'relampago' | 'startsAt' | 'endsAt'>, now = Date.now()): boolean {
  return promotion.ativa && validPromotionWindow(promotion) && (promotion.startsAt === undefined || now >= promotion.startsAt) && (promotion.endsAt === undefined || now < promotion.endsAt);
}
export function remainingPromotionTime(end: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((end - now) / 1000));
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return `${days ? `${days}d ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
