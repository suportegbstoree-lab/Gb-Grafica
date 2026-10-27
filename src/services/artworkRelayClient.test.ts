import assert from 'node:assert/strict';
import test from 'node:test';
import { runArtworkRelayUpload } from './artworkRelayClient.js';

const file = new Blob([Buffer.from('abc')], { type: 'image/png' });
const start = async () => ({ uploadId: 'a'.repeat(32), chunkBytes: 2 * 1024 * 1024 });

test('recusa arquivo retornado na pasta de outro usuário', async () => {
  await assert.rejects(runArtworkRelayUpload(file, 'arte.png', 'source-artwork', 'alice', start, async () => ({
    done: true, path: `artworks/bob/pending/${'a'.repeat(32)}.png`, name: 'arte.png',
  })), /Resposta inválida/);
});

test('interrompe quando o servidor não avança repetidamente', async () => {
  let calls = 0;
  await assert.rejects(runArtworkRelayUpload(file, 'arte.png', 'source-artwork', 'alice', start, async () => {
    calls += 1; return { done: false, offset: 0 };
  }), /Não foi possível continuar/);
  assert.equal(calls, 4);
});
