import assert from 'node:assert/strict';
import test from 'node:test';
import { absoluteSiteUrl, buildStoreStructuredData, DEFAULT_LOGO_URL, resolvePublicImage } from './seo';

test('absoluteSiteUrl normaliza rotas públicas', () => {
  assert.equal(absoluteSiteUrl('/politica-de-privacidade'), 'https://www.gblgrafica.com.br/politica-de-privacidade');
  assert.equal(absoluteSiteUrl('termos-de-uso'), 'https://www.gblgrafica.com.br/termos-de-uso');
  assert.equal(absoluteSiteUrl('//site-externo.example/captura'), 'https://www.gblgrafica.com.br/site-externo.example/captura');
});

test('resolvePublicImage rejeita protocolos inseguros e substitui o PNG local corrompido', () => {
  assert.equal(resolvePublicImage(), DEFAULT_LOGO_URL);
  assert.equal(resolvePublicImage('/logo.png'), DEFAULT_LOGO_URL);
  assert.equal(resolvePublicImage('javascript:alert(1)'), DEFAULT_LOGO_URL);
  assert.equal(resolvePublicImage('http://cdn.example.com/banner.png'), DEFAULT_LOGO_URL);
  assert.equal(resolvePublicImage('/banner.png'), 'https://www.gblgrafica.com.br/banner.png');
  assert.equal(resolvePublicImage('https://cdn.example.com/banner.png'), 'https://cdn.example.com/banner.png');
});

test('buildStoreStructuredData omite dados comerciais ainda vazios', () => {
  const result = buildStoreStructuredData({
    telefone1: '(16) 99999-9999',
    telefone2: '(16) 3333-3333',
    banner_principal: '',
    beneficio1_titulo: '',
    beneficio1_desc: '',
    beneficio2_titulo: '',
    beneficio2_desc: '',
    beneficio3_titulo: '',
    beneficio3_desc: '',
  });

  assert.equal(result['@type'], 'Store');
  assert.equal(result.logo, DEFAULT_LOGO_URL);
  assert.equal(result.telephone, '(16) 99999-9999');
  assert.equal('email' in result, false);
  assert.equal('address' in result, false);
});
