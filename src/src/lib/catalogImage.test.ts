import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogImageExtension,
  catalogImagePathFromUrl,
  isAllowedCatalogImage,
  isCatalogImagePath,
  MAX_CATALOG_IMAGE_BYTES,
  matchesCatalogImageSignature,
  sanitizeCatalogImageName,
} from './catalogImage';

test('aceita somente imagens seguras do catálogo dentro do limite', () => {
  assert.equal(isAllowedCatalogImage('image/jpeg', 1), true);
  assert.equal(isAllowedCatalogImage('image/png', MAX_CATALOG_IMAGE_BYTES), true);
  assert.equal(isAllowedCatalogImage('image/webp', 1024), true);
  assert.equal(isAllowedCatalogImage('image/svg+xml', 1024), false);
  assert.equal(isAllowedCatalogImage('image/gif', 1024), false);
  assert.equal(isAllowedCatalogImage('image/png', 0), false);
  assert.equal(isAllowedCatalogImage('image/png', MAX_CATALOG_IMAGE_BYTES + 1), false);
  assert.equal(catalogImageExtension('image/jpeg'), 'jpg');
});

test('confere a assinatura binária das imagens do catálogo', () => {
  assert.equal(
    matchesCatalogImageSignature('image/png', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])),
    true,
  );
  assert.equal(matchesCatalogImageSignature('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(matchesCatalogImageSignature('image/webp', Buffer.from('RIFF1234WEBP')), true);
  assert.equal(matchesCatalogImageSignature('image/png', Buffer.from('<script>')), false);
});

test('reconhece apenas caminhos de catálogo gerados pela aplicação', () => {
  const validPath = `catalog/products/produto-1/${'a'.repeat(32)}.png`;
  assert.equal(isCatalogImagePath(validPath), true);
  assert.equal(isCatalogImagePath(validPath, 'produto-1'), true);
  assert.equal(isCatalogImagePath(validPath, 'produto-2'), false);
  assert.equal(isCatalogImagePath('catalog/products/produto-1/capa.png'), false);
  assert.equal(isCatalogImagePath(`catalog/products/produto/../../${'a'.repeat(32)}.png`), false);
});

test('extrai o caminho somente de URL Firebase pertencente ao bucket e produto esperados', () => {
  const bucket = 'gb-grafica.firebasestorage.app';
  const path = `catalog/products/produto-1/${'b'.repeat(32)}.webp`;
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=teste`;

  assert.equal(catalogImagePathFromUrl(url, bucket, 'produto-1'), path);
  assert.equal(catalogImagePathFromUrl(url, 'outro-bucket', 'produto-1'), null);
  assert.equal(catalogImagePathFromUrl(url, bucket, 'produto-2'), null);
  assert.equal(catalogImagePathFromUrl(`https://example.com/${encodeURIComponent(path)}`, bucket), null);
});

test('normaliza o nome original sem permitir caminhos', () => {
  assert.equal(sanitizeCatalogImageName('../Capa\u0000 principal.png'), '..-Capa principal.png');
  assert.equal(sanitizeCatalogImageName('   '), 'imagem');
  assert.equal(sanitizeCatalogImageName('x'.repeat(200)).length, 120);
});
