import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProductDraft, validatePromotionDraft } from './adminValidation';
import { promotionalPrice } from './promotions';
import { variantImage } from './variantImage';
import { checkoutIssues } from './checkoutForm';
import { darkPalette } from './storeTheme';
import { csvRows, localToday, productionTotals, validateProduction } from './operations';
import type { Anuncio, Category, Promocao } from '../types';
const categories: Category[] = [{ id: 'a', nome: 'A' }, { id: 'b', nome: 'B' }];
const products: Anuncio[] = [1000, 2000, 500].map((price, i) => ({ id: `p${i}`, nome: `Produto ${i}`, desc: 'Descrição válida', categoria: i === 1 ? 'B' : 'A', imagem: '/main.png', preco_base: (price / 100).toFixed(2), atributos: [], combinacoes: {} }));
test('one product promotion spans categories without discounting unselected products', () => {
  const result = validatePromotionDraft({ titulo: 'Oferta', alvoTipo: 'produto', alvoIds: ['p0', 'p1'], descontoTipo: 'percentual', descontoPercentual: 10 }, products, categories);
  assert.equal(result.ok, true); if (!result.ok) return;
  const promotion = { ...result.value, id: 'promo' };
  assert.deepEqual(promotion.alvoNomes, ['Produto 0', 'Produto 1']);
  assert.equal(promotionalPrice(1000, products[0], [promotion])?.finalCents, 900);
  assert.equal(promotionalPrice(2000, products[1], [promotion])?.finalCents, 1800);
  assert.equal(promotionalPrice(500, products[2], [promotion]), null);
});
test('whole-category promotion covers every selected category and validates the lowest price', () => {
  const draft: Partial<Promocao> = { titulo: 'Oferta', alvoTipo: 'categoria', alvoIds: ['a', 'b'], descontoTipo: 'valor_fixo', descontoFixoCentavos: 500 };
  assert.equal(validatePromotionDraft(draft, products, categories).ok, false);
  const result = validatePromotionDraft({ ...draft, descontoFixoCentavos: 100 }, products, categories);
  assert.ok(result.ok); if (result.ok) for (const product of products) assert.ok(promotionalPrice(1000, product, [{ id: 'promo', ...result.value }]));
  assert.equal(validatePromotionDraft({ ...draft, alvoIds: ['a', 'missing'] }, products, categories).ok, false);
});
test('variant image is optional and cannot refer to an unlisted asset', () => {
  const product = { ...products[0], imagens: ['/blue.png'], atributos: [{ nome: 'Cor', opcoes: ['Azul'] }], combinacoes: { Azul: '35.00' }, imagensPorCombinacao: { Azul: '/blue.png' } };
  assert.equal(variantImage(product, { Cor: 'Azul' }), '/blue.png');
  assert.equal(variantImage({ ...product, imagens: [] }, { Cor: 'Azul' }), '/main.png');
  assert.ok(validateProductDraft(product, categories, []).ok);
  assert.equal(validateProductDraft({ ...product, imagensPorCombinacao: { Azul: '/unlisted.png' } }, categories, []).ok, false);
});
test('checkout names every missing field and pickup omits delivery requirements', () => {
  const form = { acceptedLegalTerms: false, customerName: '', cpf: '', phone: '', deliveryMethod: 'entrega' as const, hasShippingQuote: false, addressStreet: '', addressNeighborhood: '', addressNumber: '', hasInvalidCartPrice: false };
  assert.equal(checkoutIssues(form).length, 8);
  assert.equal(checkoutIssues(form)[0].field, 'checkout-name');
  assert.equal(checkoutIssues({ ...form, deliveryMethod: 'retirada' }).length, 4);
});
test('manual production separates units, constrains rework and rejects impossible dates', () => {
  const draft = { employeeId: 'staff', date: localToday(), service: 'Impressão', unit: 'pecas', completed: 10, rework: 2, loss: 1, reason: 'Ajuste da máquina', reference: '', notes: '' };
  const value = validateProduction(draft, ['staff']);
  assert.throws(() => validateProduction({ ...draft, rework: 11 }, ['staff']));
  assert.throws(() => validateProduction({ ...draft, date: '2026-02-31' }, ['staff']));
  assert.throws(() => validateProduction({ ...draft, reason: '' }, ['staff']));
  const totals = productionTotals([value, { ...value, unit: 'arquivos', completed: 3, rework: 0, loss: 0 }]);
  assert.equal(totals[0].completed, 10); assert.equal(totals[2].completed, 3); assert.equal(totals[0].reworkRate, 20);
});
test('CSV protects spreadsheet formulas while retaining quotes and line breaks', () => {
  const csv = csvRows([['=SUM(A1)', '  @unsafe', 'A "B"\nC']]);
  assert.ok(csv.includes("'=")); assert.ok(csv.includes("'  @")); assert.ok(csv.includes('"A ""B""\nC"'));
});
test('custom dark color is constrained to a dark base and derives distinct surfaces', () => {
  const palette = darkPalette('#ffffff'); assert.equal(palette.base, '#404040'); assert.notEqual(palette.surface, palette.base); assert.equal(darkPalette('invalid').base, '#111111');
});
