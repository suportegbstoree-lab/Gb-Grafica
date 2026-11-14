import assert from 'node:assert/strict';
import test from 'node:test';
import { resetOrderData } from '../../scripts/reset-test-orders.js';
import { memoryFirestore } from '../../test/helpers/memoryFirestore.js';
import type { AdminServices } from './firebaseAdmin.js';

test('order reset previews without writes, deletes orphan records and preserves unrelated data', async () => {
  const { db, docs } = memoryFirestore([
    ['orders/GB-TESTE', { paymentStatus: 'pago' }],
    ['orders/GB-ORFAO/pagbankEvents/event', {}],
    ['_melhorEnvioLabels/GB-ORFAO/cancellations/event', {}],
    ['_checkoutRequests/request', { orderId: 'GB-ORFAO' }],
    ['_orderEmails/GB-ORFAO-customer', {}],
    ['_emailOutbox/order-GB-ORFAO-1', { kind: 'order-status' }],
    ['_emailOutbox/welcome-account', { kind: 'welcome' }],
    ['_operationsActivity/old', { action: 'order.viewed', entityId: 'GB-ORFAO' }],
    ['_operationsActivity/other', { action: 'category.updated' }],
    ['_workTasks/old', { kind: 'order' }],
    ['_workTasks/other', { kind: 'document' }],
    ['_productionEntries/old', { reference: 'GB-ORFAO' }],
    ['_productionEntries/other', { reference: 'LOTE-001' }],
    ['_salesCouponHolds/GB-ORFAO', {}],
    ['_salesFirstPurchases/account', {}],
    ['_salesCoupons/FRETE', { used: 2, scope: 'shipping' }],
    ['_reviewOwners/reviewer', { orderId: 'GB-ORFAO' }],
    ['anuncios/product/reviews/reviewer', { rating: 5 }],
    ['anuncios/product', { nome: 'Produto' }],
    ['productRatings/product', { count: 1 }],
  ]);
  const objects = new Map([
    ['artworks/user/orders/GB-ORFAO/art.pdf', '12'],
    ['artworks/user/pending/design.png', '15'],
    ['catalog/templates/product/file.pdf', '17'],
  ]);
  const bucket = {
    async getFiles(options: { prefix: string; versions: boolean }) {
      assert.equal(options.prefix, 'artworks/');
      assert.equal(options.versions, true);
      return [[...objects].map(([name, generation]) => ({ name, metadata: { generation } }))];
    },
    file(name: string, { generation }: { generation: string }) {
      return { async delete() { assert.equal(generation, objects.get(name)); objects.delete(name); } };
    },
  } as unknown as AdminServices['bucket'];
  const output: string[] = [];
  await resetOrderData({ db, bucket }, false, line => output.push(line));
  assert.ok(docs.has('orders/GB-ORFAO/pagbankEvents/event'));
  assert.equal(objects.size, 3);
  assert.ok(output.includes('orders: 2'));
  await resetOrderData({ db, bucket }, true, () => {});
  assert.deepEqual([...docs.keys()].sort(), [
    '_emailOutbox/welcome-account', '_operationsActivity/other', '_productionEntries/other',
    '_salesCoupons/FRETE', '_workTasks/other', 'anuncios/product',
  ]);
  assert.deepEqual(docs.get('_salesCoupons/FRETE'), { used: 0, scope: 'shipping' });
  assert.deepEqual([...objects.keys()], ['artworks/user/pending/design.png', 'catalog/templates/product/file.pdf']);
  await resetOrderData({ db, bucket }, true, () => {});
});
