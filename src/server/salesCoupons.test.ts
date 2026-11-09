import test from "node:test";
import assert from "node:assert/strict";
import { memoryFirestore } from "../../test/helpers/memoryFirestore.js";
import {
  allocateCoupon,
  discountedCheckoutItems,
  normalizeCouponDraft,
  type SalesCoupon,
} from "../lib/salesCoupons.js";
import {
  COUPONS,
  COUPON_HOLDS,
  markCouponProviderAttempt,
  reserveCoupon,
  selectCoupon,
  settleCoupon,
} from "./salesCoupons.js";

const code = "GB-123456ABCDEF";
const coupon: SalesCoupon = {
  code,
  revision: "v1",
  description: "Lançamento",
  scope: "products",
  targets: ["agenda"],
  kind: "fixed",
  amount: 301,
  used: 0,
  limit: 1,
  expiresOn: "2099-01-31",
  active: true,
  firstPurchase: false,
};
const lines = [
  { productId: "agenda", category: "Agendas", quantity: 2, unitCents: 2000 },
  { productId: "caderno", category: "Cadernos", quantity: 1, unitCents: 2000 },
];
const buyer = {
  uid: "conta",
  email: "cliente@example.test",
  email_verified: true,
};

test("checkout allocation retains cents, quantity and full value of noneligible items", () => {
  const discounts = allocateCoupon(coupon, lines);
  assert.deepEqual(discounts, [301, 0]);
  const items = discountedCheckoutItems(
    lines.map((line) => ({
      reference_id: line.productId,
      unit_amount: line.unitCents,
      quantity: line.quantity,
    })),
    discounts,
  );
  assert.deepEqual(
    items.map((item) => [item.reference_id, item.unit_amount, item.quantity]),
    [
      ["agenda", 1850, 1],
      ["agenda", 1849, 1],
      ["caderno", 2000, 1],
    ],
  );
  assert.equal(
    items.reduce((sum, item) => sum + item.unit_amount * item.quantity, 0),
    5699,
  );
});

test("percentage applies to eligible category only and every payment unit remains positive", () => {
  const category = {
    ...coupon,
    kind: "percent" as const,
    scope: "categories" as const,
    targets: ["Cadernos"],
    amount: 1250,
  };
  assert.deepEqual(allocateCoupon(category, lines), [0, 250]);
  const maximum = allocateCoupon(
    { ...category, scope: "cart", amount: 10_000 },
    lines,
  );
  assert.deepEqual(maximum, [3998, 1999]);
});

test("coupon inputs reject out of range rates, missing scope targets and invalid dates", () => {
  const draft = { ...coupon, kind: "percent", value: "100,01" };
  assert.throws(() => normalizeCouponDraft(draft));
  assert.throws(() =>
    normalizeCouponDraft({ ...draft, value: "15", expiresOn: "2099-02-31" }),
  );
  assert.throws(() =>
    normalizeCouponDraft({ ...draft, value: "15", targets: [] }),
  );
});

test("a use is reserved atomically, retained after payment and released only once after definitive failure", async () => {
  const { db, docs } = memoryFirestore([[`${COUPONS}/${code}`, { ...coupon }]]);
  const reserve = async (id: string) =>
    db.runTransaction(async (tx) => {
      const selected = await selectCoupon(db, buyer, lines, code, tx);
      reserveCoupon(
        db,
        tx,
        id,
        selected!,
        new Date(Date.now() + 60_000).toISOString(),
      );
      tx.create(db.collection("orders").doc(id), {
        clienteEmail: buyer.email,
        paymentStatus: "pendente",
      });
    });
  const attempts = await Promise.allSettled([
    reserve("order-one"),
    reserve("order-two"),
  ]);
  assert.deepEqual(
    attempts.map((result) => result.status),
    ["fulfilled", "rejected"],
  );
  assert.equal(docs.get(`${COUPONS}/${code}`)?.used, 1);
  await markCouponProviderAttempt(db, "order-one");
  await settleCoupon(db, "order-one", "unsent");
  assert.ok(docs.has(`${COUPON_HOLDS}/order-one`));
  await Promise.all([
    settleCoupon(db, "order-one", "release"),
    settleCoupon(db, "order-one", "release"),
  ]);
  assert.equal(docs.get(`${COUPONS}/${code}`)?.used, 0);
  assert.equal(docs.get("orders/order-one")?.cupomLiberado, true);
  await reserve("order-two");
  docs.set("orders/order-two", {
    clienteEmail: buyer.email,
    paymentStatus: "pago",
  });
  await settleCoupon(db, "order-two", "paid");
  await settleCoupon(db, "order-two", "release");
  assert.equal(docs.get(`${COUPONS}/${code}`)?.used, 1);
  assert.ok(!docs.has(`${COUPON_HOLDS}/order-two`));
});

test("automatic first-order coupon uses verified registration email and excludes historic paid and refunded orders", async () => {
  const { db, docs } = memoryFirestore([
    [`${COUPONS}/${code}`, { ...coupon, limit: 5, firstPurchase: true }],
  ]);
  assert.equal(
    (
      await selectCoupon(
        db,
        { ...buyer, email: " CLIENTE@EXAMPLE.TEST " },
        lines,
        undefined,
      )
    )?.applied.code,
    code,
  );
  assert.equal(
    await selectCoupon(
      db,
      { ...buyer, email_verified: false },
      lines,
      undefined,
    ),
    null,
  );
  docs.set("orders/legacy", {
    userId: "older-account",
    clienteEmail: buyer.email,
    status: "Entregue",
  });
  assert.equal(await selectCoupon(db, buyer, lines, undefined), null);
  docs.set("orders/legacy", {
    userId: "older-account",
    clienteEmail: buyer.email,
    paymentStatus: "cancelado",
    pagbankRefundedAmountCents: 2500,
  });
  assert.equal(await selectCoupon(db, buyer, lines, undefined), null);
});

test("one verified email cannot reserve two simultaneous first purchases across accounts", async () => {
  const { db } = memoryFirestore([
    [`${COUPONS}/${code}`, { ...coupon, limit: 5, firstPurchase: true }],
  ]);
  const first = await db.runTransaction(async (tx) => {
    const selected = await selectCoupon(db, buyer, lines, undefined, tx);
    reserveCoupon(
      db,
      tx,
      "first",
      selected!,
      new Date(Date.now() + 60_000).toISOString(),
    );
    tx.create(db.collection("orders").doc("first"), {
      clienteEmail: buyer.email,
      paymentStatus: "pendente",
    });
    return selected?.applied.code;
  });
  assert.equal(first, code);
  assert.equal(
    await selectCoupon(db, { ...buyer, uid: "outro" }, lines, undefined),
    null,
  );
  await settleCoupon(db, "first", "unsent");
  assert.equal(
    (await selectCoupon(db, { ...buyer, uid: "outro" }, lines, undefined))
      ?.applied.code,
    code,
  );
});

test("a hold from a deleted coupon cannot release a use on a new coupon with the same code", async () => {
  const code = "GRAFICA_10";
  const ref = `${COUPONS}/${code}`;
  const { db, docs } = memoryFirestore([
    [ref, { ...coupon, code, instanceId: "old" }],
  ]);
  await db.runTransaction(async (tx) => {
    const selection = await selectCoupon(
      db,
      buyer,
      lines,
      "  grafica_10  ",
      tx,
    );
    assert.equal(selection?.applied.code, code);
    reserveCoupon(
      db,
      tx,
      "old-order",
      selection!,
      new Date(Date.now() + 60_000).toISOString(),
    );
    tx.create(db.collection("orders").doc("old-order"), {
      paymentStatus: "pendente",
    });
  });
  docs.set(ref, { ...coupon, code, used: 1, instanceId: "new" });
  await settleCoupon(db, "old-order", "release");
  assert.equal(docs.get(ref)?.used, 1);
  assert.ok(!docs.has(`${COUPON_HOLDS}/old-order`));
});
