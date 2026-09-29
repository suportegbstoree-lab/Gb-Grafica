import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminAssetPathFromUrl,
  adminFontPath,
  adminImagePath,
  isAdminFontPath,
  isAdminImagePath,
  isAllowedAdminFont,
  matchesWoff2Signature,
} from './adminAsset';

test('gera apenas caminhos administrativos restritos', () => {
  const image = adminImagePath('categories', 'livros', 'a'.repeat(32), 'image/png');
  const font = adminFontPath('montserrat', 'b'.repeat(32));
  assert.equal(image, `catalog/categories/livros/${'a'.repeat(32)}.png`);
  assert.equal(font, `catalog/fonts/montserrat/${'b'.repeat(32)}.woff2`);
  assert.equal(isAdminImagePath(image || ''), true);
  assert.equal(isAdminFontPath(font || ''), true);
  assert.equal(adminImagePath('site', '../logo', 'a'.repeat(32), 'image/png'), null);
});

test('valida arquivo WOFF2 pelo MIME, tamanho e assinatura', () => {
  assert.equal(isAllowedAdminFont('font/woff2', 1024), true);
  assert.equal(isAllowedAdminFont('font/ttf', 1024), false);
  assert.equal(matchesWoff2Signature(new Uint8Array([0x77, 0x4f, 0x46, 0x32])), true);
  assert.equal(matchesWoff2Signature(new Uint8Array([0x00, 0x01, 0x00, 0x00])), false);
});

test('extrai somente arquivo do bucket Firebase esperado', () => {
  const path = `catalog/site/logo/${'c'.repeat(32)}.webp`;
  const url = `https://firebasestorage.googleapis.com/v0/b/projeto.appspot.com/o/${encodeURIComponent(path)}?alt=media`;
  assert.equal(adminAssetPathFromUrl(url, 'projeto.appspot.com'), path);
  assert.equal(adminAssetPathFromUrl(url, 'outro.appspot.com'), null);
});
