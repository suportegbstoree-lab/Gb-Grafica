import assert from 'node:assert/strict';
import test from 'node:test';
import { contactHref, featuredProducts, parseStoreBenefits, parseStoreContacts, storeBenefits, storeContacts } from './storePresentation';
import { validateSiteConfig } from './adminValidation';
import { INITIAL_CONFIG } from '../constants';
import type { Anuncio } from '../types';

test('configuração antiga continua disponível e listas vazias removem todos os itens', () => {
  assert.ok(storeContacts(INITIAL_CONFIG).length >= 1);
  assert.equal(storeBenefits(INITIAL_CONFIG).length, 3);
  assert.deepEqual(storeContacts({ ...INITIAL_CONFIG, contatos: [] }), []);
  assert.deepEqual(storeBenefits({ ...INITIAL_CONFIG, beneficios: [] }), []);
  assert.equal(validateSiteConfig({ ...INITIAL_CONFIG, contatos: [], beneficios: [], telefone1: '', telefone2: '' }).ok, true);
});

test('aceita atendimento somente por email e um único telefone', () => {
  const contacts = [{ id: 'email', type: 'email' as const, label: 'Suporte', value: 'contato@example.com' }];
  assert.equal(validateSiteConfig({ ...INITIAL_CONFIG, telefone1: '', telefone2: '', contatos: contacts }).ok, true);
  assert.equal(validateSiteConfig({ ...INITIAL_CONFIG, telefone2: '' }).ok, true);
  assert.equal(contactHref(contacts[0]), 'mailto:contato@example.com');
  assert.equal(contactHref({ id: 'tel', type: 'phone', label: 'Telefone', value: '(16) 99999-9999' }), 'tel:+5516999999999');
});

test('contatos rejeitam URL disfarçada, quebra de linha, duplicidade de id e números inválidos', () => {
  for (const value of ['javascript:alert(1)', 'a@example.com\r\nbcc:outra@example.com', 'nao-e-email']) {
    assert.equal(parseStoreContacts([{ id: 'a', type: 'email', label: 'Suporte', value }]), null);
  }
  assert.equal(parseStoreContacts([{ id: 'a', type: 'phone', label: 'Tel', value: '123' }]), null);
  assert.equal(parseStoreContacts([{ id: 'a', type: 'email', label: 'A', value: 'a@example.com' }, { id: 'a', type: 'email', label: 'B', value: 'b@example.com' }]), null);
  assert.equal(parseStoreBenefits([{ id: 'a', title: '', description: '' }]), null);
});

test('destaques usam apenas produtos marcados, em ordem estável', () => {
  const products = [{ id: 'a', nome: 'A', imagem: '/a.png', destaque: true, destaqueOrdem: 2 }, { id: 'b', nome: 'B', imagem: '/b.png', destaque: true, destaqueOrdem: 1 }, { id: 'c', nome: 'C', imagem: '/c.png' }] as Anuncio[];
  assert.deepEqual(featuredProducts(products).map(product => product.id), ['b', 'a']);
});
