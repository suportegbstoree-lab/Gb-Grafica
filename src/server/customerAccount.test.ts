import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { memoryFirestore } from '../../test/helpers/memoryFirestore';
import { createCustomerAccountRouters } from './customerAccount';
import { OperationsError } from '../lib/operations';
import { EMPTY_PROFILE } from '../lib/customerProfile';
async function scenario(
  run: (c: {
    docs: Map<string, any>;
    call: (path: string, body?: unknown, uid?: string) => Promise<Response>;
  }) => Promise<void>,
) {
  const memory = memoryFirestore([
      ['anuncios/product', { nome: 'Caderno' }],
      [
        'orders/paid',
        { userId: 'alice', paymentStatus: 'pago', data: '2026-11-01', itens: [{ productId: 'product' }] },
      ],
      ['orders/other', { userId: 'bob', paymentStatus: 'pago', data: '2026-11-01', itens: [{ productId: 'product' }] }],
    ]),
    app = express();
  app.use(express.json());
  const routers = createCustomerAccountRouters({
    db: () => memory.db,
    user: async (req) => {
      const uid = req.get('authorization');
      if (!['alice', 'bob'].includes(uid || '')) throw new OperationsError('Sem sessão', 401);
      return { uid: uid!, name: 'Ana Cliente' };
    },
    limit() {},
  });
  app.use('/account', routers.account);
  app.use('/products', routers.products);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    await run({
      docs: memory.docs,
      call: (path, body, uid = 'alice') =>
        fetch(base + path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { Authorization: uid, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}
test('account data is authenticated, scoped to UID and profile round-trips without internal metadata', () =>
  scenario(async (c) => {
    assert.equal((await c.call('/account/profile', undefined, '')).status, 401);
    const initial = await (await c.call('/account/profile')).json();
    assert.deepEqual(initial, EMPTY_PROFILE);
    const saved = await (
      await c.call('/account/profile', { ...initial, fullName: 'Ana Cliente', expectedRevision: null })
    ).json();
    assert.ok(saved.revision);
    assert.equal(saved.updatedAt, undefined);
    const { revision, ...data } = saved;
    assert.equal((await c.call('/account/profile', { ...data, expectedRevision: revision })).status, 200);
    assert.equal((await c.call('/account/profile', { ...data, expectedRevision: null })).status, 409);
    assert.equal((await c.call('/account/profile', { ...data, uid: 'bob', expectedRevision: revision })).status, 422);
    assert.equal(c.docs.has('_customerProfiles/bob'), false);
    const orders = await (await c.call('/account/orders')).json();
    assert.deepEqual(
      orders.orders.map((o: any) => o.id),
      ['paid'],
    );
  }));
test('reviews require a real paid purchase belonging to the authenticated customer', () =>
  scenario(async (c) => {
    for (const [orderId, uid] of [
      ['paid', 'bob'],
      ['other', 'alice'],
      ['missing', 'alice'],
    ])
      assert.equal(
        (await c.call('/products/product/reviews', { orderId, rating: 5, comment: 'Boa' }, uid)).status,
        403,
      );
    c.docs.set('orders/paid', { ...c.docs.get('orders/paid'), paymentStatus: 'pendente' });
    assert.equal(
      (await c.call('/products/product/reviews', { orderId: 'paid', rating: 5, comment: 'Boa' })).status,
      403,
    );
    c.docs.set('orders/paid', { ...c.docs.get('orders/paid'), paymentStatus: 'pago', pagbankRefundedAmountCents: 100 });
    assert.equal(
      (await c.call('/products/product/reviews', { orderId: 'paid', rating: 5, comment: 'Boa' })).status,
      403,
    );
    assert.equal(c.docs.has('productRatings/product'), false);
  }));
test('review updates are transactional, one per customer/product, with public identity minimized', () =>
  scenario(async (c) => {
    const input = { orderId: 'paid', rating: 5, comment: '<img src=x onerror=alert(1)>' };
    assert.equal((await c.call('/products/product/reviews', input)).status, 200);
    assert.equal((await c.call('/products/product/reviews', { ...input, rating: 3 })).status, 200);
    const publicRows = await (await c.call('/products/product/reviews', undefined, '')).json();
    assert.equal(publicRows.reviews.length, 1);
    assert.equal(publicRows.reviews[0].comment, input.comment);
    assert.equal(publicRows.reviews[0].authorName, 'Ana');
    for (const key of ['uid', 'email', 'orderId']) assert.equal(publicRows.reviews[0][key], undefined);
    assert.deepEqual(publicRows.rating, { count: 1, sum: 3, average: 3 });
    const totals = await (await c.call('/products/ratings', undefined, '')).json();
    assert.equal(totals.ratings.product.average, 3);
    assert.equal([...c.docs.keys()].filter((k) => k.startsWith('_reviewOwners/')).length, 1);
  }));
test('review validation rejects malformed ratings, oversized comments and products outside the order', () =>
  scenario(async (c) => {
    for (const rating of [0, 6, 1.5, '5'])
      assert.equal((await c.call('/products/product/reviews', { orderId: 'paid', rating, comment: '' })).status, 422);
    assert.equal(
      (await c.call('/products/product/reviews', { orderId: 'paid', rating: 5, comment: 'a'.repeat(2001) })).status,
      422,
    );
    c.docs.set('anuncios/unrelated', { nome: 'Outro' });
    assert.equal(
      (await c.call('/products/unrelated/reviews', { orderId: 'paid', rating: 5, comment: '' })).status,
      403,
    );
  }));
test('paid package components qualify for reviews without exposing the private order proof', () =>
  scenario(async (c) => {
    c.docs.set('orders/paid', {
      userId: 'alice',
      paymentStatus: 'pago',
      itens: [
        {
          productId: 'bundle',
          nome: 'Kit',
          quantidade: 2,
          bundleItems: [{ productId: 'product', quantidade: 1, nome: 'Caderno' }],
        },
      ],
    });
    assert.equal(
      (await c.call('/products/product/reviews', { orderId: 'paid', rating: 4, comment: 'Comprei no pacote' })).status,
      200,
    );
  }));

test('concurrent verified buyers produce an exact aggregate without duplicate per-customer reviews', () =>
  scenario(async (c) => {
    const responses = await Promise.all([
      c.call('/products/product/reviews', { orderId: 'paid', rating: 5, comment: 'Um' }, 'alice'),
      c.call('/products/product/reviews', { orderId: 'other', rating: 1, comment: 'Dois' }, 'bob'),
    ]);
    assert.ok(responses.every((r) => r.status === 200));
    assert.deepEqual(c.docs.get('productRatings/product'), { count: 2, sum: 6, average: 3 });
  }));
