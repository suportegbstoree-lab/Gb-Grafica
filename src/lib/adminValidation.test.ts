import assert from 'node:assert/strict';
import test from 'node:test';
import type { Anuncio, Category, SiteConfig } from '../types';
import {
  draftFingerprint,
  generateProductCombinations,
  isSafeAdminUrl,
  validateCategoryDraft,
  validateProductDraft,
  validatePromotionDraft,
  validateSiteConfig,
} from './adminValidation';

const categories: Category[] = [{ id: 'carimbos', nome: 'Carimbos', icon: '' }];
const validProduct: Partial<Anuncio> = {
  nome: 'Carimbo personalizado',
  desc: 'Carimbo feito sob medida.',
  categoria: 'Carimbos',
  imagem: '/logo.png',
  imagens: [],
  preco_base: '8,40',
  atributos: [],
  combinacoes: {},
  tipoInput: 'nenhum',
};

test('aceita somente URLs HTTP(S) ou caminhos locais seguros', () => {
  assert.equal(isSafeAdminUrl('https://example.com/image.png'), true);
  assert.equal(isSafeAdminUrl('/logo.png'), true);
  assert.equal(isSafeAdminUrl('//example.com/image.png'), false);
  assert.equal(isSafeAdminUrl('javascript:alert(1)'), false);
});

test('normaliza categoria e bloqueia duplicidade', () => {
  const valid = validateCategoryDraft({ nome: '  Livros   de Receita ', icon: '/logo.png' }, categories);
  assert.deepEqual(valid, {
    ok: true,
    value: { id: 'livros-de-receita', nome: 'Livros de Receita', icon: '/logo.png', ordem: 1 },
  });
  assert.equal(validateCategoryDraft({ nome: 'carimbos', icon: '' }, categories).ok, false);
});

test('valida e normaliza um produto simples', () => {
  const result = validateProductDraft(validProduct, categories, []);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.nome, 'Carimbo personalizado');
});

test('preserva perfil de envio e as embalagens específicas de combinações existentes', () => {
  const profile = { unitWeightGrams: 300, packagingWeightGrams: 150, lengthCm: 25, widthCm: 20, heightCm: 15, unitsPerParcel: 2 };
  const result = validateProductDraft({ ...validProduct, shipping: profile,
    atributos: [{ nome: 'Tamanho', opcoes: ['P'] }], combinacoes: { P: '10.00' }, shippingByCombination: { P: profile, removida: profile },
  }, categories, []);
  assert.ok(result.ok);
  if (result.ok) {
    assert.deepEqual(result.value.shipping, profile);
    assert.deepEqual(result.value.shippingByCombination, { P: profile });
  }
  assert.equal(validateProductDraft({ ...validProduct, shipping: { ...profile, unitWeightGrams: 20000 } }, categories, []).ok, false);
});

test('bloqueia produto duplicado, categoria inexistente e texto sem rótulo', () => {
  const existing = [{ ...validProduct, id: 'produto-1' } as Anuncio];
  assert.equal(validateProductDraft(validProduct, categories, existing).ok, false);
  assert.equal(validateProductDraft({ ...validProduct, categoria: 'Outra' }, categories, []).ok, false);
  assert.equal(validateProductDraft({ ...validProduct, tipoInput: 'texto', labelTexto: '' }, categories, []).ok, false);
  assert.equal(validateProductDraft({ ...validProduct, tipoInput: 'texto_arte', labelTexto: '' }, categories, []).ok, false);
  assert.equal(validateProductDraft({ ...validProduct, tipoInput: 'texto_arte', labelTexto: 'Nome' }, categories, []).ok, true);
});

test('limita combinações de atributos antes da gravação', () => {
  const options = Array.from({ length: 23 }, (_, index) => String(index + 1));
  const combinations = generateProductCombinations([
    { nome: 'Tamanho', opcoes: options },
    { nome: 'Cor', opcoes: options },
  ]);
  assert.equal(combinations.length > 500, true);
  assert.equal(validateProductDraft({
    ...validProduct,
    atributos: [
      { nome: 'Tamanho', opcoes: options },
      { nome: 'Cor', opcoes: options },
    ],
  }, categories, []).ok, false);
});

test('valida promoções e seus links', () => {
  const product = { ...validProduct, id: 'produto-1' } as Anuncio;
  assert.equal(validatePromotionDraft({
    titulo: 'Oferta',
    imagem: '/logo.png',
    ativa: true,
    alvoTipo: 'produto',
    alvoId: product.id,
    descontoTipo: 'percentual',
    descontoPercentual: 10,
  }, [product], categories).ok, true);
  assert.equal(validatePromotionDraft({
    titulo: 'Oferta',
    imagem: 'data:text/html,x',
    ativa: true,
    alvoTipo: 'produto',
    alvoId: product.id,
    descontoTipo: 'percentual',
    descontoPercentual: 10,
  }, [product], categories).ok, false);
  assert.equal(validatePromotionDraft({
    titulo: 'Oferta fixa inválida',
    ativa: true,
    alvoTipo: 'produto',
    alvoId: product.id,
    descontoTipo: 'valor_fixo',
    descontoFixoCentavos: 840,
  }, [product], categories).ok, false);
});

test('valida telefones, banner e e-mails da configuração', () => {
  const config: SiteConfig = {
    telefone1: '(16) 99937-6260',
    telefone2: '(16) 98801-6792',
    banner_principal: '/logo.png',
    beneficio1_titulo: 'Um',
    beneficio1_desc: 'Um',
    beneficio2_titulo: 'Dois',
    beneficio2_desc: 'Dois',
    beneficio3_titulo: 'Três',
    beneficio3_desc: 'Três',
    email_atendimento: 'contato@example.com',
  };
  assert.equal(validateSiteConfig(config).ok, true);
  assert.equal(validateSiteConfig({ ...config, email_atendimento: 'invalido' }).ok, false);
});

test('fingerprint é estável para objetos com chaves em ordens diferentes', () => {
  assert.equal(draftFingerprint({ nome: 'A', nested: { b: 2, a: 1 } }), draftFingerprint({ nested: { a: 1, b: 2 }, nome: 'A' }));
  assert.notEqual(draftFingerprint({ nome: 'A' }), draftFingerprint({ nome: 'B' }));
});

test('preserva formato de impressão válido e recusa medidas inconsistentes', () => {
  const printProfile = { widthMm: 100, heightMm: 150, bleedMm: 2, safeMarginMm: 5, targetDpi: 300 };
  const result = validateProductDraft({ ...validProduct, printProfile }, categories, []);
  assert.ok(result.ok);
  if (result.ok) assert.deepEqual(result.value.printProfile, printProfile);
  assert.equal(validateProductDraft({ ...validProduct, printProfile: { ...printProfile, safeMarginMm: 50 } }, categories, []).ok, false);
  const legacy = validateProductDraft(validProduct, categories, []);
  assert.ok(legacy.ok);
  if (legacy.ok) assert.equal(Object.hasOwn(legacy.value, 'printProfile'), false);
});
