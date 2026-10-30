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
  matchesAdminFontSignature,
  adminFontUploadType,
  MAX_ADMIN_FONT_BYTES,
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
  assert.equal(isAllowedAdminFont('font/ttf', 1024), true);
  assert.equal(matchesWoff2Signature(new Uint8Array([0x77, 0x4f, 0x46, 0x32])), true);
  assert.equal(matchesWoff2Signature(new Uint8Array([0x00, 0x01, 0x00, 0x00])), false);
});

test('extrai somente arquivo do bucket Firebase esperado', () => {
  const path = `catalog/site/logo/${'c'.repeat(32)}.webp`;
  const url = `https://firebasestorage.googleapis.com/v0/b/projeto.appspot.com/o/${encodeURIComponent(path)}?alt=media`;
  assert.equal(adminAssetPathFromUrl(url, 'projeto.appspot.com'), path);
  assert.equal(adminAssetPathFromUrl(url, 'outro.appspot.com'), null);
});

test('TTF e OTF usam MIME canônico, caminhos próprios e assinaturas compatíveis', () => {
  for (const [extension, mime, header] of [
    ['ttf', 'font/ttf', [0, 1, 0, 0]], ['otf', 'font/otf', [79, 84, 84, 79]],
  ] as const) {
    const path = adminFontPath('fonte', 'a'.repeat(32), mime);
    assert.ok(path?.endsWith(`.${extension}`)); assert.equal(isAdminFontPath(path!), true);
    assert.equal(adminFontUploadType(`ARQUIVO.${extension.toUpperCase()}`, ''), mime);
    assert.equal(adminFontUploadType(`arquivo.${extension}`, 'application/octet-stream'), mime);
    assert.equal(matchesAdminFontSignature(mime, new Uint8Array(header)), true);
    assert.equal(matchesAdminFontSignature(mime, new Uint8Array([60,115,118,103])), false);
    assert.equal(isAllowedAdminFont(mime, MAX_ADMIN_FONT_BYTES + 1), false);
  }
  assert.equal(adminFontUploadType('arquivo.ttf', 'font/otf'), null);
  assert.equal(adminFontUploadType('arquivo.svg', 'font/ttf'), null);
  assert.equal(adminFontPath('fonte', 'a'.repeat(32), 'image/svg+xml'), null);
  assert.equal(isAdminFontPath('catalog/fonts/fonte/arquivo.ttf'), false);
});
