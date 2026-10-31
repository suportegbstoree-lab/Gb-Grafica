import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOrderInitial } from './decorativeInitial';
import { initialReference } from '../lib/decorativeInitial';
import { copyArtworkVersion, type ArtworkBucket } from './artworkObjectVersion';
const path = `catalog/products/product/${'b'.repeat(32)}.png`, id = 'a'.repeat(32);
const template = { id, path: `catalog/templates/product/${id}.pdf`, name: 'Alfabeto.pdf', pages: ['/front.png'], alphabet: { folderName: 'Alfabeto', sizePercent: 60, letters: { A: { path, url: 'https://example.test/A.png' } } } };
const product = { imagem: '/front.png', modelosPdf: [template] };
function fakeBucket(type = 'image/png', signature = Buffer.from([137,80,78,71,13,10,26,10]), generation = '42') {
  const calls: unknown[] = [];
  return { calls, bucket: { file(name: string, options?: { generation?: number }) { calls.push([name, options]); return { getMetadata: async () => [{ generation, contentType: type, size: 100 }], download: async () => [signature], copy: async (_destination: unknown, metadata: unknown) => { calls.push({ copy: name, generation: options?.generation, metadata }); } }; } } as unknown as ArtworkBucket };
}
test('seleção canônica ignora letras e URLs do cliente e copia a geração validada sem token público', async () => {
  const { bucket, calls } = fakeBucket();
  const result = await resolveOrderInitial(bucket, 'product', product, id, 'Ágata', initialReference(template, 'Ágata'));
  assert.equal(result?.letter, 'A'); assert.equal(result?.version.path, path); assert.equal(result?.version.generation, 42);
  await copyArtworkVersion(bucket, result!.version, `artworks/user/orders/order/item/${'b'.repeat(32)}.png`, 'user');
  const copy = calls.find((value: any) => value.copy) as any;
  assert.equal(copy.generation, 42); assert.equal(copy.metadata.cacheControl, 'private, no-store');
  assert.deepEqual(copy.metadata.metadata, { ownerId: 'user', kind: 'source-artwork', originalName: 'A.png' });
});
test('sem pasta ou sem PNG da primeira letra não lê nem substitui imagens', async () => {
  const { bucket, calls } = fakeBucket();
  assert.equal(await resolveOrderInitial(bucket, 'product', { ...product, modelosPdf: [{ ...template, alphabet: undefined }] }, id, 'Ana', undefined), undefined);
  assert.equal(await resolveOrderInitial(bucket, 'product', product, id, 'Beatriz', 'null'), undefined);
  assert.equal(calls.length, 0);
});
test('alterações no alfabeto ou referência recusam a aprovação antiga', async () => {
  const { bucket } = fakeBucket();
  await assert.rejects(resolveOrderInitial(bucket, 'product', product, id, 'Ana', undefined), /Gere o modelo/);
  await assert.rejects(resolveOrderInitial(bucket, 'product', product, id, 'Ana', 'null'), /Gere o modelo/);
  await assert.rejects(resolveOrderInitial(bucket, 'product', { ...product, modelosPdf: [{ ...template, alphabet: undefined }] }, id, 'Ana', initialReference(template, 'Ana')), /removido/);
  await assert.rejects(resolveOrderInitial(bucket, 'product', { ...product, modelosPdf: [{ ...template, alphabet: { ...template.alphabet, sizePercent: 40 } }] }, id, 'Ana', initialReference(template, 'Ana')), /Gere o modelo/);
  await assert.rejects(resolveOrderInitial(bucket, 'product', { ...product, modelosPdf: [{ ...template, alphabet: { ...template.alphabet, folderName: 'Outra' } }] }, id, 'Ana', initialReference(template, 'Ana')), /inválidos/);
});
test('não aceita PNG com tipo, assinatura ou geração inválidos', async () => {
  for (const invalid of [fakeBucket('image/jpeg'), fakeBucket('image/png', Buffer.from('not-png')), fakeBucket('image/png', undefined, '0')]) await assert.rejects(resolveOrderInitial(invalid.bucket, 'product', product, id, 'Ana', initialReference(template, 'Ana')), /inválida/);
});
