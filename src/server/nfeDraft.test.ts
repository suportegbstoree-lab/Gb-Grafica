import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNfeDocument } from '../lib/nfe';
import { memoryFirestore } from '../../test/helpers/memoryFirestore';
import { NfeDraftError, orderNfeDraft } from './nfeDraft';

const id = 'GB-FISCAL123';
const path = 'orders/' + id;
const order = {
  paymentStatus: 'pago', fulfillmentStatus: 'pagamento_confirmado',
  clienteNome: 'Pessoa de Teste',
  metodoEntrega: 'entrega',
  itens: [{ productId: 'cartao', nome: 'Cartão gráfico', sku: 'C01', quantidade: 2, preco: '15.00' }],
  frete: '20.00', subtotal: '30.00', totalCents: 3755,
  cupom: { discountCents: 1245, shippingDiscountCents: 1000 },
};
const nfeCode = { ncm: '49119900', unit: 'UN', origin: '0' };
const rejects = (status: number) => (error: unknown) => error instanceof NfeDraftError && error.status === status;

test('the fiscal draft reuses private checkout data, exact discounts and the classification at purchase', async () => {
  const { db, docs } = memoryFirestore([
    [path, order],
    [path + '/fiscal/checkout', { payerCpf: '52998224725', paymentEnvironment: 'sandbox', couponByItem: [245], products: [nfeCode] }],
    ['anuncios/cartao', { fiscal: { ...nfeCode, ncm: '48211000' } }],
  ]);
  const review = await orderNfeDraft(db, id, 'operator');
  assert.deepEqual(review.totals, { itemsCents: 3000, itemCouponCents: 245, shippingCents: 2000, shippingCouponCents: 1000, totalCents: 3755 });
  assert.equal(review.paymentEnvironment, 'sandbox');
  assert.equal(review.draft.recipientDocument, '52998224725');
  assert.equal(review.draft.items[0].ncm, nfeCode.ncm);
  assert.equal(review.couponFromCheckout, true);
  assert.equal(docs.has(path + '/fiscal/draft'), false);
  review.draft.items[0].couponCents = 999;
  review.draft.items[0].cfop = '5102';
  const saved = await orderNfeDraft(db, id, 'operator', { draft: review.draft, revision: null });
  assert.equal(saved.draft.items[0].couponCents, 245);
  assert.ok(saved.revision);
  assert.deepEqual((await orderNfeDraft(db, id, 'operator')).draft, saved.draft);
  await assert.rejects(orderNfeDraft(db, id, 'other', { draft: review.draft, revision: null }), rejects(409));
  assert.equal(docs.get(path)?.recipientDocument, undefined);
});

test('older orders can be reviewed without inventing a tax identity or discount allocation', async () => {
  const { db, docs } = memoryFirestore([[path, order]]);
  const result = await orderNfeDraft(db, id, 'operator');
  assert.equal(result.draft.recipientDocument, '');
  assert.equal(result.draft.items[0].couponCents, null);
  assert.equal(result.couponFromCheckout, false);
  assert.ok(result.issues.some(issue => issue.includes('soma dos descontos')));
  result.draft.items[0].couponCents = 245;
  const saved = await orderNfeDraft(db, id, 'operator', { draft: result.draft, revision: null });
  assert.ok(!saved.issues.some(issue => issue.includes('soma dos descontos')));
  docs.set(path, { ...order, pagbankRefundedAmountCents: 1 });
  assert.equal((await orderNfeDraft(db, id, 'operator')).editable, false);
  await assert.rejects(orderNfeDraft(db, id, 'operator', { draft: result.draft, revision: saved.revision }), rejects(409));
  docs.set(path, { ...order, totalCents: 9999 });
  await assert.rejects(orderNfeDraft(db, id, 'operator'), rejects(422));
});

test('document validation supports CPF and numeric or alphanumeric CNPJ', () => {
  assert.equal(parseNfeDocument('529.982.247-25'), '52998224725');
  assert.equal(parseNfeDocument('11.222.333/0001-81'), '11222333000181');
  assert.equal(parseNfeDocument('12.ABC.345/01DE-35'), '12ABC34501DE35');
  assert.equal(parseNfeDocument('12.ABC.345/01DE-36'), null);
});

test('legacy paid orders without a delivery charge remain reviewable when the totals balance', async () => {
  const { db } = memoryFirestore([[path, { status: 'Pago', total: '30.00', itens: order.itens }]]);
  const review = await orderNfeDraft(db, id, 'operator');
  assert.equal(review.editable, true);
  assert.equal(review.totals.shippingCents, 0);
  assert.equal(review.totals.totalCents, 3000);
});
