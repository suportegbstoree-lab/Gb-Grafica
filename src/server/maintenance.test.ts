import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryFirestore } from '../../test/helpers/memoryFirestore';
import { expirePromotions } from './maintenance';
test('maintenance expires only elapsed offers and removes processed deadlines from the queue', async () => {
  const fake = memoryFirestore([['promocoes/old', { ativa: true, relampago: true, startsAt: 10, endsAt: 20 }], ['promocoes/future', { ativa: true, endsAt: 100 }], ['promocoes/legacy', { ativa: true }]]);
  assert.equal(await expirePromotions(fake.db, 30), 1);
  assert.equal(fake.docs.get('promocoes/old')?.ativa, false); assert.equal(fake.docs.get('promocoes/old')?.endsAt, undefined);
  assert.equal(fake.docs.get('promocoes/future')?.ativa, true); assert.equal(fake.docs.get('promocoes/legacy')?.ativa, true);
  assert.equal(await expirePromotions(fake.db, 30), 0);
});
