import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  allocateCoupon,
  couponAvailable,
  normalizeCouponCode,
  validCouponCode,
  type AppliedCoupon,
  type CouponLine,
  type SalesCoupon,
} from "../lib/salesCoupons.js";
import { OperationsError } from "../lib/operations.js";

export const COUPONS = "_salesCoupons";
export const COUPON_HOLDS = "_salesCouponHolds";
const FIRST_PURCHASES = "_salesFirstPurchases";

export class CouponError extends OperationsError {
  constructor(
    message: string,
    public readonly code = "COUPON_INVALID",
  ) {
    super(message, code === "COUPON_CHANGED" ? 409 : 422);
  }
}

export const couponChanged = () =>
  new CouponError(
    "O cupom mudou. Confira o desconto e o total antes de pagar.",
    "COUPON_CHANGED",
  );

interface Buyer {
  uid: string;
  email?: string;
  email_verified?: boolean;
}

interface CouponSelection {
  applied: AppliedCoupon;
  discounts: number[];
  coupon: SalesCoupon;
  buyerKeys: string[];
}

function paidOrder(data: FirebaseFirestore.DocumentData) {
  return (
    data.paymentStatus === "pago" ||
    Boolean(data.paymentConfirmedAt) ||
    Number(data.pagbankRefundedAmountCents) > 0 ||
    ["Pago", "Processando", "Enviado", "Entregue"].includes(data.status)
  );
}

export async function selectCoupon(
  db: Firestore,
  buyer: Buyer,
  lines: CouponLine[],
  requested: unknown,
  tx?: Transaction,
): Promise<CouponSelection | null> {
  if (requested !== undefined && typeof requested !== "string")
    throw new CouponError("Código de cupom inválido.");
  const code = normalizeCouponCode((requested as string | undefined) ?? "");
  const coupons = db.collection(COUPONS);
  let candidates: SalesCoupon[];
  if (code) {
    if (!validCouponCode(code))
      throw new CouponError("Código de cupom inválido.");
    const ref = coupons.doc(code);
    const data = (await (tx ? tx.get(ref) : ref.get())).data() as
      | SalesCoupon
      | undefined;
    candidates = data ? [data] : [];
  } else {
    const query = coupons
      .where("firstPurchase", "==", true)
      .where("active", "==", true);
    candidates = (await (tx ? tx.get(query) : query.get())).docs.map(
      (doc) => doc.data() as SalesCoupon,
    );
  }

  const applicable = candidates
    .filter((coupon) => couponAvailable(coupon, Date.now()))
    .map((coupon) => ({ coupon, discounts: allocateCoupon(coupon, lines) }))
    .map((row) => ({
      ...row,
      discountCents: row.discounts.reduce((sum, amount) => sum + amount, 0),
    }))
    .filter((row) => row.discountCents > 0)
    .sort(
      (a, b) =>
        b.discountCents - a.discountCents ||
        a.coupon.code.localeCompare(b.coupon.code),
    );
  const first = applicable[0];
  if (!first) {
    if (code)
      throw new CouponError(
        "Cupom inválido, indisponível ou sem itens elegíveis.",
      );
    return null;
  }

  const buyerKeys: string[] = [];
  if (first.coupon.firstPurchase) {
    const email = buyer.email?.trim().toLowerCase();
    if (!email || buyer.email_verified !== true) {
      if (code)
        throw new CouponError(
          "Confirme o e-mail da conta para usar o cupom de primeira compra.",
        );
      return null;
    }
    buyerKeys.push(
      ...["email:" + email, "uid:" + buyer.uid].map((value) =>
        createHash("sha256").update(value).digest("hex"),
      ),
    );
    const claims = await Promise.all(
      buyerKeys.map((key) => {
        const ref = db.collection(FIRST_PURCHASES).doc(key);
        return tx ? tx.get(ref) : ref.get();
      }),
    );
    const byEmail = db.collection("orders").where("clienteEmail", "==", email);
    const byAccount = db.collection("orders").where("userId", "==", buyer.uid);
    const history = claims.some((claim) => claim.exists)
      ? []
      : await Promise.all([
          tx ? tx.get(byEmail) : byEmail.get(),
          tx ? tx.get(byAccount) : byAccount.get(),
        ]);
    if (
      claims.some((claim) => claim.exists) ||
      history.some((rows) => rows.docs.some((doc) => paidOrder(doc.data())))
    ) {
      if (code)
        throw new CouponError(
          "O cupom vale para a primeira compra e já existe um pedido pago ou um checkout de primeira compra em aberto.",
        );
      return null;
    }
  }

  const { coupon, discounts, discountCents } = first;
  return {
    coupon,
    discounts,
    buyerKeys,
    applied: {
      code: coupon.code,
      description: coupon.description,
      discountCents,
      firstPurchase: coupon.firstPurchase,
    },
  };
}

/** Called inside the order creation transaction after rechecking eligibility and the use limit. */
export function reserveCoupon(
  db: Firestore,
  tx: Transaction,
  orderId: string,
  selection: CouponSelection,
  expiresAt: string,
) {
  const { coupon, buyerKeys } = selection;
  tx.update(db.collection(COUPONS).doc(coupon.code), { used: coupon.used + 1 });
  tx.create(db.collection(COUPON_HOLDS).doc(orderId), {
    code: coupon.code,
    buyerKeys,
    ...(coupon.instanceId ? { instanceId: coupon.instanceId } : {}),
    expiresAt: Date.parse(expiresAt),
    providerAttempted: false,
    reviewAt: Date.parse(expiresAt) + 10 * 60_000,
  });
  for (const key of buyerKeys)
    tx.create(db.collection(FIRST_PURCHASES).doc(key), { orderId });
}

/** Persist the boundary before any remote charge can be created. */
export async function markCouponProviderAttempt(
  db: Firestore,
  orderId: string,
) {
  const ref = db.collection(COUPON_HOLDS).doc(orderId);
  await db.runTransaction(async (tx) => {
    const hold = (await tx.get(ref)).data();
    if (!hold || hold.providerAttempted || hold.expiresAt <= Date.now())
      throw couponChanged();
    tx.update(ref, { providerAttempted: true });
  });
}

/** Release only a rejected creation or a confirmed expired checkout with no PagBank order. */
export async function settleCoupon(
  db: Firestore,
  orderId: string,
  outcome: "paid" | "release" | "unsent",
) {
  const holdRef = db.collection(COUPON_HOLDS).doc(orderId);
  await db.runTransaction(async (tx) => {
    const hold = (await tx.get(holdRef)).data();
    if (!hold) return;
    const orderRef = db.collection("orders").doc(orderId);
    const order = (await tx.get(orderRef)).data();
    if (!order) return;
    if (outcome !== "paid" && paidOrder(order)) return;
    if (outcome === "unsent" && hold.providerAttempted !== false) return;
    if (outcome === "paid" && !paidOrder(order)) return;
    if (outcome !== "paid") {
      const couponRef = db.collection(COUPONS).doc(hold.code);
      const coupon = (await tx.get(couponRef)).data();
      const keys = (hold.buyerKeys as string[]).map((key) =>
        db.collection(FIRST_PURCHASES).doc(key),
      );
      const claims = await Promise.all(keys.map((ref) => tx.get(ref)));
      if (coupon && coupon.used > 0 && coupon.instanceId === hold.instanceId)
        tx.update(couponRef, { used: coupon.used - 1 });
      claims.forEach((claim, i) => {
        if (claim.data()?.orderId === orderId) tx.delete(keys[i]);
      });
      tx.update(orderRef, { cupomLiberado: true });
    }
    tx.delete(holdRef);
  });
}

export async function reviewCouponHolds(
  db: Firestore,
  reconcile: (
    id: string,
    order: FirebaseFirestore.DocumentData,
  ) => Promise<void>,
) {
  const due = await db
    .collection(COUPON_HOLDS)
    .where("reviewAt", "<=", Date.now())
    .limit(4)
    .get();
  const results = await Promise.allSettled(
    due.docs.map(async (hold) => {
      // Move the item to the back of the queue even if its provider cannot answer today.
      await db.runTransaction(async (tx) => {
        if ((await tx.get(hold.ref)).exists)
          tx.update(hold.ref, { reviewAt: Date.now() + 24 * 60 * 60_000 });
      });
      const order = (await db.collection("orders").doc(hold.id).get()).data();
      if (order) {
        if (paidOrder(order)) await settleCoupon(db, hold.id, "paid");
        else if (order.pagbankCheckoutId) await reconcile(hold.id, order);
        else if (hold.data().providerAttempted === false)
          await settleCoupon(db, hold.id, "unsent");
      }
    }),
  );
  return {
    checked: due.size,
    failed: results.filter((result) => result.status === "rejected").length,
  };
}
