import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bundleMinimum,
  discountBundle,
  parseBundle,
  validateBundleItems,
  cartShippingItems,
  orderItems,
  type BundleDefinition,
} from './bundles.js';
import { filterCatalog, publicPageUrl } from './catalog.js';
import { repriceCart } from './cartPricing.js';
import { parseCustomerProfile, EMPTY_PROFILE } from './customerProfile.js';
import { expandBundleShipping } from '../server/bundleShipping.js';
import type { Anuncio, CartItem } from '../types.js';
const variable = {
  id: 'cards',
  nome: 'Cartões',
  desc: 'Papel premium',
  categoria: 'Papelaria',
  imagem: '/cover.png',
  preco_base: '45.00',
  atributos: [
    { nome: 'Quantidade', opcoes: ['100', '500'] },
    { nome: 'Material', opcoes: ['A', 'B'] },
  ],
  combinacoes: { '100|A': '45.00', '100|B': '55.00', '500|A': '120.00', '500|B': '150.00' },
  tags: ['presente'],
  tipoInput: 'nenhum',
} as Anuncio;
const definition: BundleDefinition = {
  components: [
    {
      productId: 'cards',
      quantity: 2,
      allowQuantity: false,
      configurable: false,
      selections: { Quantidade: '100', Material: 'B' },
    },
  ],
  allowQuantity: true,
  discountType: 'percent',
  discountValue: 10,
  revision: 'a'.repeat(32),
};
const packageProduct = {
  ...variable,
  id: 'bundle',
  nome: 'Kit especial',
  atributos: [],
  combinacoes: {},
  pacote: definition,
} as Anuncio;
const child = {
  id: 'child',
  productId: 'cards',
  quantidade: 2,
  preco: '55.00',
  nome: 'Cartões',
  imagem: '/cover.png',
  selecoes: { Quantidade: '100', Material: 'B' },
} as CartItem;
const root = {
  id: 'root',
  productId: 'bundle',
  nome: 'Kit especial',
  quantidade: 2,
  preco: '99.00',
  selecoes: {},
  bundleRevision: definition.revision,
  bundleItems: [child],
} as CartItem;
test('bundle prices use exact fixed variants, flexible minimums, quantities and integer discounts', () => {
  assert.equal(bundleMinimum(definition, [variable]), 9900);
  assert.equal(
    bundleMinimum(
      { ...definition, components: [{ ...definition.components[0], configurable: true, allowQuantity: true }] },
      [variable],
    ),
    4050,
  );
  assert.equal(discountBundle(10001, { ...definition, discountType: 'fixed', discountValue: 100 }), 9901);
  assert.throws(() => discountBundle(100, { ...definition, discountType: 'fixed', discountValue: 100 }));
});
test('bundle definitions reject missing, recursive, duplicate and invalid components', () => {
  assert.throws(() => bundleMinimum(definition, []));
  assert.throws(() =>
    bundleMinimum({ ...definition, components: [{ ...definition.components[0], productId: 'bundle' }] }, [
      packageProduct,
    ]),
  );
  assert.equal(parseBundle({ ...definition, components: [...definition.components, ...definition.components] }), null);
  assert.equal(parseBundle({ ...definition, discountValue: 100 }), null);
  assert.equal(parseBundle({ ...definition, components: [{ ...definition.components[0], quantity: 0 }] }), null);
});
test('buyers cannot change composition, fixed variants or locked quantities', () => {
  assert.equal(validateBundleItems(packageProduct, [child], 2).length, 1);
  for (const children of [
    [],
    [{ ...child, productId: 'other' }],
    [{ ...child, selecoes: { Quantidade: '500', Material: 'B' } }],
    [{ ...child, quantidade: 1 }],
    [{ ...child, bundleItems: [] }],
  ])
    assert.throws(() => validateBundleItems(packageProduct, children, 2));
  assert.throws(() =>
    validateBundleItems({ ...packageProduct, pacote: { ...definition, allowQuantity: false } }, [child], 2),
  );
  assert.throws(() => validateBundleItems(packageProduct, [{ ...child, quantidade: 20 }], 20));
});
test('shipping expands physical component quantities and rejects forged compositions', async () => {
  const load = async (id: string) => [variable, packageProduct].find((p) => p.id === id);
  const rows = await expandBundleShipping([root], load);
  assert.deepEqual(rows, [{ productId: 'cards', quantidade: 4, selecoes: child.selecoes }]);
  await assert.rejects(expandBundleShipping([{ ...root, bundleItems: [{ ...child, quantidade: 1 }] }], load));
  assert.equal(cartShippingItems([root])[0].quantidade, 4);
  assert.equal(orderItems([root])[1].quantidade, 4);
  assert.equal(child.quantidade, 2);
});
test('bundle cart repricing follows component catalog prices without stacking separate promotions', () => {
  const promotion = {
    id: 'off',
    ativa: true,
    alvoTipo: 'produto',
    alvoId: 'cards',
    descontoTipo: 'percentual',
    descontoPercentual: 50,
  } as any;
  assert.equal(repriceCart([root], [variable, packageProduct], [promotion], Date.now())[0].preco, '99.00');
  const updated = { ...variable, combinacoes: { ...variable.combinacoes, '100|B': '60.00' } };
  assert.equal(repriceCart([root], [updated, packageProduct], [promotion], Date.now())[0].preco, '108.00');
  assert.equal(
    repriceCart(
      [root],
      [variable, { ...packageProduct, pacote: { ...definition, revision: 'new' } }],
      [],
      Date.now(),
    )[0],
    root,
  );
});
test('search matches independent accent-insensitive tokens across description and tags', () => {
  assert.deepEqual(filterCatalog([variable], [], {}, { section: 'todos', query: 'cartoes presente premium' }), [
    variable,
  ]);
  assert.equal(filterCatalog([variable], [], {}, { section: 'todos', query: 'cartoes inexistente' }).length, 0);
});
test('catalog sections and price/rating/category filters use current authoritative prices', () => {
  const products = [{ ...variable, destaque: true, lancamento: true }, packageProduct],
    ratings = { cards: { average: 4.5, count: 2, sum: 9 } };
  assert.equal(filterCatalog(products, [], ratings, { section: 'destaques' }).length, 1);
  assert.equal(filterCatalog(products, [], ratings, { section: 'lancamentos' }).length, 1);
  assert.equal(filterCatalog(products, [], ratings, { section: 'pacotes' }).length, 1);
  assert.equal(filterCatalog(products, [], ratings, { section: 'promocoes' })[0].id, 'bundle');
  assert.equal(
    filterCatalog(products, [], ratings, { section: 'todos', category: 'Papelaria', min: 4500, max: 5000, rating: 4 })
      .length,
    1,
  );
  assert.equal(filterCatalog(products, [], ratings, { section: 'todos', min: 4501, max: 5000 }).length, 0);
});
test('shared links select product or exact public page and never leak account/checkout query values', () => {
  const location = {
    origin: 'https://loja.test',
    pathname: '/promocoes',
    search: '?q=papel&categoria=cards&min=10&preview=customer&orderId=secret&token=secret',
  };
  assert.equal(publicPageUrl(location, 'cards'), 'https://loja.test/produto/cards');
  assert.equal(publicPageUrl(location), 'https://loja.test/promocoes?q=papel&categoria=cards&min=10');
});
test('profile validates optional identity/address fields without allowing role or UID changes', () => {
  assert.ok(
    parseCustomerProfile({
      ...EMPTY_PROFILE,
      fullName: 'Ana Cliente',
      cpf: '529.982.247-25',
      phone: '(11) 98765-4321',
      cep: '01001-000',
      state: 'sp',
    }),
  );
  for (const fields of [
    { uid: 'victim' },
    { role: 'admin' },
    { fullName: 'Ana' },
    { cpf: '11111111111' },
    { phone: '123' },
    { cep: '123' },
    { state: 'XX' },
    { street: 123 },
  ])
    assert.equal(parseCustomerProfile({ ...EMPTY_PROFILE, ...fields }), null);
});

test('bundle discounts remain managed in the package rather than a second product promotion', async () => {
  const { validatePromotionDraft } = await import('./adminValidation.js');
  const result = validatePromotionDraft(
    {
      titulo: 'Oferta extra',
      ativa: true,
      alvoTipo: 'produto',
      alvoId: 'bundle',
      alvoNome: 'Kit',
      descontoTipo: 'percentual',
      descontoPercentual: 10,
    },
    [variable, packageProduct],
    [],
  );
  assert.equal(result.ok, false);
});
