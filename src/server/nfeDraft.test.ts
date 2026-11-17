import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNfeDocument } from '../lib/nfe';
import { memoryFirestore } from '../../test/helpers/memoryFirestore';
import { NfeDraftError, nfeOrderSummaries, orderNfeDraft } from './nfeDraft';
import { manageNfeDefaults } from './nfeDefaults';

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

const fiscalAddress = {
  cep: '01001000', estado: 'SP', cidade: 'São Paulo', cityCode: '3550308', rua: 'Praça da Sé',
  numero: '15', bairro: 'Sé', complemento: '',
};
const defaults = {
  issuerState: 'SP', operation: 'Venda', intrastate: { cfop: '5102', icmsCode: '102' },
  interstate: { cfop: '6108', icmsCode: '102' },
};
const checkout = { payerCpf: '52998224725', couponByItem: [245], products: [nfeCode] };
const issuer = {
  legalName: 'Gráfica Fiscal Teste', cnpj: '11222333000181', stateRegistration: '01234567890', taxRegime: '1',
  address: fiscalAddress,
};

test('new drafts suggest fiscal settings by destination and only mark complete drafts as reviewed', async () => {
  const { db, docs } = memoryFirestore([
    [path, { ...order, enderecoEntrega: fiscalAddress }], [path + '/fiscal/checkout', checkout],
  ]);
  const config = await manageNfeDefaults(db, 'admin', { defaults, issuer, revision: null });
  await assert.rejects(manageNfeDefaults(db, 'admin', { defaults, revision: null }), rejects(409));
  const initial = await orderNfeDraft(db, id, 'operator');
  assert.equal(initial.draft.operation, 'Venda');
  assert.equal(initial.draft.address.cityCode, '3550308');
  assert.equal(initial.draft.items[0].cfop, '5102');
  assert.equal(initial.draft.items[0].icmsCode, '102');
  assert.deepEqual(initial.issues, []);
  await assert.rejects(orderNfeDraft(db, id, 'operator', {
    confirm: true, revision: null, draft: { ...initial.draft, address: { ...fiscalAddress, cityCode: '' } },
  }), rejects(422));
  await assert.rejects(orderNfeDraft(db, id, 'operator', {
    confirm: true, revision: null, draft: { ...initial.draft, address: { ...fiscalAddress, cityCode: '3304557' } },
  }), rejects(422));
  const confirmed = await orderNfeDraft(db, id, 'operator', { confirm: true, draft: initial.draft, revision: null });
  assert.ok(confirmed.reviewedAt);
  await manageNfeDefaults(db, 'admin', { defaults: { ...defaults, operation: 'Venda de produtos' }, revision: config.revision });
  assert.equal((await orderNfeDraft(db, id, 'operator')).draft.operation, 'Venda');
  const updated = await orderNfeDraft(db, id, 'operator', { draft: confirmed.draft, revision: confirmed.revision });
  assert.equal(updated.reviewedAt, undefined);
  assert.equal(docs.get(path + '/fiscal/draft')?.reviewedAt, undefined);
});

test('interstate defaults apply to retail delivery, while CNPJ and pickup require an operator to fill the codes', async () => {
  const { db, docs } = memoryFirestore([
    [path, { ...order, enderecoEntrega: { ...fiscalAddress, estado: 'RJ', cidade: 'Rio de Janeiro', cityCode: '3304557' } }],
    [path + '/fiscal/checkout', checkout],
  ]);
  await manageNfeDefaults(db, 'admin', { defaults, revision: null });
  const interstate = await orderNfeDraft(db, id, 'operator');
  assert.equal(interstate.draft.items[0].cfop, '6108');
  docs.set(path + '/fiscal/checkout', { ...checkout, recipient: {
    recipientName: 'Empresa Teste', recipientDocument: '11.222.333/0001-81', stateRegistration: '123456789',
  } });
  const company = await orderNfeDraft(db, id, 'operator');
  assert.equal(company.draft.recipientName, 'Empresa Teste');
  assert.equal(company.draft.recipientDocument, '11222333000181');
  assert.equal(company.draft.stateRegistration, '123456789');
  assert.equal(company.draft.items[0].cfop, undefined);
  docs.set(path + '/fiscal/checkout', checkout);
  docs.set(path, { ...order, metodoEntrega: 'retirada' });
  assert.equal((await orderNfeDraft(db, id, 'operator')).draft.items[0].cfop, undefined);
});

test('issuer configuration normalizes documents, treats partial data as pending and rejects an obsolete revision', async () => {
  const { db, docs } = memoryFirestore([['_fiscalSettings/nfe', { defaults, revision: 'legacy' }]]);
  const previous = await manageNfeDefaults(db, 'admin');
  assert.equal(previous.issuer.address.estado, 'SP');
  assert.equal(previous.issuer.cnpj, '');
  const changed = await manageNfeDefaults(db, 'admin', { defaults, issuer: {
    ...issuer, cnpj: '11.222.333/0001-81', stateRegistration: '012.345.678-90', address: { ...fiscalAddress, cep: '01001-000' },
  }, revision: 'legacy' });
  assert.equal(changed.issuer.cnpj, issuer.cnpj);
  assert.equal(changed.issuer.stateRegistration, issuer.stateRegistration);
  assert.equal(changed.issuer.address.cep, '01001000');
  const currentIssuerRevision = docs.get('_fiscalSettings/nfe')?.issuerRevision;
  const revisedDefaults = await manageNfeDefaults(db, 'admin', { defaults: { ...defaults, operation: 'Venda na loja' }, revision: changed.revision });
  assert.deepEqual(revisedDefaults.issuer, changed.issuer);
  assert.equal(docs.get('_fiscalSettings/nfe')?.issuerRevision, currentIssuerRevision);
  await assert.rejects(manageNfeDefaults(db, 'admin', { defaults, issuer, revision: 'legacy' }), rejects(409));
  for (const invalid of [{ cnpj: '52998224725' }, { stateRegistration: 'AB123' }, { taxRegime: '5' },
    { address: { ...fiscalAddress, cityCode: '3304557' } }]) {
    await assert.rejects(manageNfeDefaults(db, 'admin', { defaults, issuer: { ...issuer, ...invalid }, revision: revisedDefaults.revision }), rejects(422));
  }
});

test('the order list identifies specific pending fields, disregards unrelated incomplete catalog and rechecks changes to the issuer', async () => {
  const buyerPath = path + '/fiscal/checkout';
  const { db, docs } = memoryFirestore([
    [path, { ...order, enderecoEntrega: fiscalAddress }],
    [buyerPath, { ...checkout, products: [{ origin: '0', unit: 'UN' }] }],
    ['anuncios/catalogo-teste', { nome: 'Produto de teste' }],
  ]);
  let config = await manageNfeDefaults(db, 'admin', { defaults, revision: null });
  let review = await orderNfeDraft(db, id, 'operator');
  assert.ok(review.issuerMissing.includes('CNPJ'));
  assert.ok(review.issues.some(issue => issue.includes('Cartão gráfico (C01)') && issue.includes('NCM')));
  await assert.rejects(orderNfeDraft(db, id, 'operator', { draft: review.draft, confirm: true, revision: null }), rejects(422));
  const pending = (await nfeOrderSummaries(db, [id], 'operator'))[id];
  assert.equal(pending.status, 'pending');
  assert.doesNotMatch(JSON.stringify(pending), /52998224725|Pessoa de Teste|Praça da Sé/);
  assert.equal(docs.has(path + '/fiscal/draft'), false);

  config = await manageNfeDefaults(db, 'admin', { defaults, issuer, revision: config.revision });
  docs.set('anuncios/cartao', { fiscal: { ncm: nfeCode.ncm, origin: '8', unit: 'UN' } });
  review = await orderNfeDraft(db, id, 'operator');
  assert.deepEqual(review.issues, []);
  assert.equal(review.draft.items[0].origin, '0');
  assert.equal(review.draft.items[0].ncm, nfeCode.ncm);
  assert.equal((await nfeOrderSummaries(db, [id], 'operator'))[id].status, 'ready');

  const confirmed = await orderNfeDraft(db, id, 'operator', { draft: review.draft, confirm: true, revision: null });
  assert.equal((await nfeOrderSummaries(db, [id], 'operator'))[id].status, 'reviewed');
  await manageNfeDefaults(db, 'admin', { defaults, issuer: { ...issuer, taxRegime: '3' }, revision: config.revision });
  const summary = await nfeOrderSummaries(db, [id, 'GB-INEXISTENTE'], 'operator');
  assert.equal(summary[id].status, 'ready');
  assert.equal(summary['GB-INEXISTENTE'].status, 'unavailable');
  assert.deepEqual((await orderNfeDraft(db, id, 'operator')).draft, confirmed.draft);
});
