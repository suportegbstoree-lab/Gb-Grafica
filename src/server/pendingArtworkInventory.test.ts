import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectPendingArtworkInventory,
  type InventoryObject,
  type InventoryPageReader,
} from './pendingArtworkInventory.js';

const NOW = Date.parse('2026-10-27T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const created = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

test('conta somente artes pendentes e devolve distribuição agregada sem identificadores', async () => {
  const pages: Record<string, InventoryObject[]> = {
    first: [
      { name: 'artworks/alice/pending/private-one.pdf', metadata: { size: '10', timeCreated: created(0.5) } },
      { name: 'artworks/alice/orders/order-1/item/private.pdf', metadata: { size: '1000', timeCreated: created(1) } },
      { name: 'artworks/bob/pending/private-two.png', metadata: { size: 20, timeCreated: created(2) } },
    ],
    second: [
      { name: 'artworks/alice/pending/private-three.webp', metadata: { size: '30', timeCreated: created(8) } },
      { name: 'artworks/bob/pending/private-four.pdf', metadata: { size: 'invalid', timeCreated: created(40) } },
      { name: 'artworks/carol/pending/private-five.pdf', metadata: { timeCreated: created(-1) } },
      { name: 'artworks/carol/pending/nested/not-an-object.pdf', metadata: { size: 99 } },
    ],
  };
  const calls: Array<{ prefix: string; maxResults: number; pageToken?: string }> = [];
  const readPage: InventoryPageReader = async options => {
    calls.push(options);
    const second = options.pageToken === 'next';
    return { objects: pages[second ? 'second' : 'first'], nextPageToken: second ? null : 'next' };
  };

  const result = await collectPendingArtworkInventory(readPage, { maxObjects: 20, pageSize: 4, now: NOW });
  assert.equal(result.complete, true);
  assert.equal(result.objectsScanned, 7);
  assert.equal(result.pendingObjects, 5);
  assert.equal(result.owners, 3);
  assert.equal(result.knownBytes, 60);
  assert.equal(result.unknownSizes, 2);
  assert.deepEqual(result.age, { underDay: 1, underWeek: 1, underMonth: 1, older: 1, unknown: 1 });
  assert.deepEqual(result.objectsPerOwner, { p50: 2, p90: 2, p99: 2, maximum: 2 });
  assert.deepEqual(result.bytesPerOwner, { p50: 20, p90: 40, p99: 40, maximum: 40 });
  assert.deepEqual(calls, [
    { prefix: 'artworks/', maxResults: 4 },
    { prefix: 'artworks/', maxResults: 4, pageToken: 'next' },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /alice|bob|carol|private-/);
});

test('limita o total examinado e indica quando ainda há objetos por listar', async () => {
  const optionsSeen: number[] = [];
  const readPage: InventoryPageReader = async options => {
    optionsSeen.push(options.maxResults);
    return {
      objects: Array.from({ length: options.maxResults }, (_, i) => ({
        name: `artworks/person/pending/${options.pageToken || 'first'}-${i}`,
        metadata: { size: '1', timeCreated: created(0) },
      })),
      nextPageToken: options.pageToken ? 'third' : 'second',
    };
  };
  const result = await collectPendingArtworkInventory(readPage, { maxObjects: 3, pageSize: 2, now: NOW });
  assert.equal(result.complete, false);
  assert.equal(result.objectsScanned, 3);
  assert.equal(result.pendingObjects, 3);
  assert.deepEqual(optionsSeen, [2, 1]);
});

test('relatório vazio e quantidade exata no limite permanecem completos', async () => {
  const empty = await collectPendingArtworkInventory(async () => ({ objects: [] }), { maxObjects: 1, now: NOW });
  assert.equal(empty.complete, true);
  assert.equal(empty.owners, 0);
  assert.deepEqual(empty.bytesPerOwner, { p50: 0, p90: 0, p99: 0, maximum: 0 });

  const exact = await collectPendingArtworkInventory(async () => ({
    objects: [{ name: 'artworks/alice/pending/file', metadata: { size: '1', timeCreated: created(0) } }],
  }), { maxObjects: 1, now: NOW });
  assert.equal(exact.complete, true);
  assert.equal(exact.pendingObjects, 1);
});

test('rejeita limites, páginas e cursores inválidos sem repetir requisições indefinidamente', async () => {
  await assert.rejects(collectPendingArtworkInventory(async () => ({ objects: [] }), { maxObjects: 0 }));
  await assert.rejects(collectPendingArtworkInventory(async () => ({ objects: [] }), { maxObjects: 1, pageSize: 1001 }));
  await assert.rejects(collectPendingArtworkInventory(async () => ({
    objects: [{ name: 'one' }, { name: 'two' }],
  }), { maxObjects: 1 }));
  await assert.rejects(collectPendingArtworkInventory(async () => ({ objects: [], nextPageToken: 'same' }), { maxObjects: 1 }));
  let count = 0;
  await assert.rejects(collectPendingArtworkInventory(async () => ({
    objects: [], nextPageToken: String(++count),
  }), { maxObjects: 1 }));
  assert.equal(count, 6);
});
