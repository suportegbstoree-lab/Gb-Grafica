import { parseMoneyToCents } from "./commerce.js";

export interface CouponDraft {
  description: string;
  kind: "percent" | "fixed";
  value: string;
  expiresOn: string;
  limit: number;
  active: boolean;
  firstPurchase: boolean;
  scope: "cart" | "products" | "categories";
  targets: string[];
}

export interface SalesCoupon extends Omit<CouponDraft, "value"> {
  code: string;
  amount: number;
  used: number;
  revision: string;
}

export interface AppliedCoupon {
  code: string;
  description: string;
  discountCents: number;
  firstPurchase: boolean;
}

export interface CouponLine {
  productId: string;
  category: string;
  quantity: number;
  unitCents: number;
}

export function normalizeCouponDraft(
  input: unknown,
): Omit<SalesCoupon, "code" | "used" | "revision"> {
  const value = input as Partial<CouponDraft> | null;
  if (
    !value ||
    typeof value.description !== "string" ||
    !value.description.trim() ||
    value.description.length > 160
  ) {
    throw new Error("Informe uma descrição de até 160 caracteres.");
  }
  const expiration = Date.parse(String(value.expiresOn) + "T12:00:00Z");
  if (
    typeof value.expiresOn !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.expiresOn) ||
    !Number.isFinite(expiration) ||
    new Date(expiration).toISOString().slice(0, 10) !== value.expiresOn
  ) {
    throw new Error("Informe uma data de validade válida.");
  }
  if (
    !Number.isSafeInteger(value.limit) ||
    value.limit! < 1 ||
    value.limit! > 100_000
  ) {
    throw new Error("Informe entre 1 e 100.000 usos.");
  }
  if (
    !["cart", "products", "categories"].includes(value.scope!) ||
    !Array.isArray(value.targets) ||
    value.targets.length > 50 ||
    value.targets.some(
      (target) =>
        typeof target !== "string" ||
        !target.trim() ||
        target.length > 100 ||
        (value.scope === "products" && !/^[A-Za-z0-9_-]+$/.test(target)),
    ) ||
    (value.scope !== "cart" && !value.targets.length)
  ) {
    throw new Error("Escolha o alcance e até 50 produtos ou categorias.");
  }
  if (
    typeof value.active !== "boolean" ||
    typeof value.firstPurchase !== "boolean"
  ) {
    throw new Error("Selecione o status e o tipo de público do cupom.");
  }
  const amount = parseMoneyToCents(value.value);
  if (
    !["fixed", "percent"].includes(value.kind!) ||
    amount === null ||
    amount <= 0 ||
    amount > (value.kind === "percent" ? 10_000 : 999_999_900)
  ) {
    throw new Error(
      "Informe um desconto válido. O percentual deve ser maior que zero e de até 100%.",
    );
  }
  return {
    description: value.description.trim(),
    kind: value.kind!,
    amount,
    expiresOn: value.expiresOn,
    limit: value.limit!,
    active: value.active,
    firstPurchase: value.firstPurchase,
    scope: value.scope!,
    targets:
      value.scope === "cart"
        ? []
        : [...new Set(value.targets.map((target) => target.trim()))],
  };
}

export function couponAvailable(coupon: SalesCoupon, now: number): boolean {
  return (
    coupon.active === true &&
    coupon.used < coupon.limit &&
    now <= Date.parse(coupon.expiresOn + "T23:59:59.999-03:00")
  );
}

/** Distribute the discount in cents across eligible lines, keeping every payable unit positive. */
export function allocateCoupon(
  coupon: SalesCoupon,
  lines: CouponLine[],
): number[] {
  const eligible = lines.map(
    (line) =>
      coupon.scope === "cart" ||
      coupon.targets.includes(
        coupon.scope === "products" ? line.productId : line.category,
      ),
  );
  const subtotal = lines.reduce(
    (sum, line, i) => sum + (eligible[i] ? line.unitCents * line.quantity : 0),
    0,
  );
  let remaining =
    coupon.kind === "percent"
      ? Math.round((subtotal * coupon.amount) / 10_000)
      : coupon.amount;
  return lines.map((line, i) => {
    const discount = eligible[i]
      ? Math.min(remaining, (line.unitCents - 1) * line.quantity)
      : 0;
    remaining -= discount;
    return discount;
  });
}

/** PagBank receives its existing positive unit prices. At most one discounted line is split. */
export function discountedCheckoutItems<
  T extends { quantity: number; unit_amount: number },
>(items: T[], discounts: number[]): T[] {
  return items.flatMap((item, i) => {
    const discount = discounts[i] || 0;
    const remainder = discount % item.quantity;
    const unit = item.unit_amount - Math.floor(discount / item.quantity);
    if (!remainder) return [{ ...item, unit_amount: unit }];
    return [
      { ...item, quantity: item.quantity - remainder, unit_amount: unit },
      { ...item, quantity: remainder, unit_amount: unit - 1 },
    ];
  });
}
