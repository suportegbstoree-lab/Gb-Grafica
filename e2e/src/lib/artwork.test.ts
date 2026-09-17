import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAllowedArtwork,
  isOrderArtworkPath,
  isPendingArtworkPath,
  MAX_ARTWORK_BYTES,
  matchesArtworkSignature,
  sanitizeArtworkName,
} from './artwork.js';

test('aceita somente formatos e tamanhos permitidos para arte', () => {
  assert.equal(isAllowedArtwork('application/pdf', 1024), true);
  assert.equal(isAllowedArtwork('image/svg+xml', 1024), false);
  assert.equal(isAllowedArtwork('application/pdf', MAX_ARTWORK_BYTES + 1), false);
});

test('confere a assinatura real do arquivo, não apenas o MIME declarado', () => {
  assert.equal(matchesArtworkSignature('application/pdf', Buffer.from('%PDF-1.7')), true);
  assert.equal(matchesArtworkSignature('application/pdf', Buffer.from('MZ executable')), false);
  assert.equal(
    matchesArtworkSignature('image/png', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])),
    true,
  );
  assert.equal(matchesArtworkSignature('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(matchesArtworkSignature('image/webp', Buffer.from('RIFF1234WEBP')), true);
});

test('restringe a arte ao usuário e pedido correspondentes', () => {
  const pending = 'artworks/user-1/pending/98f3e3814e9448648a80123456789abc.pdf';
  const ordered = 'artworks/user-1/orders/GB-123/produto-abc/98f3e3814e9448648a80123456789abc.pdf';
  assert.equal(isPendingArtworkPath(pending, 'user-1'), true);
  assert.equal(isPendingArtworkPath(pending, 'user-2'), false);
  assert.equal(isOrderArtworkPath(ordered, 'user-1', 'GB-123'), true);
  assert.equal(isOrderArtworkPath(ordered, 'user-1', 'GB-999'), false);
  assert.equal(sanitizeArtworkName('../../arquivo\u0000.pdf'), '..-..-arquivo.pdf');
});
