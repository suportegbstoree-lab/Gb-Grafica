import assert from 'node:assert/strict';
import test from 'node:test';
import { observeAdminAccess } from './adminAccessClient.js';

function fixture(claims: Record<string, unknown> = { admin: true }) {
  const values: boolean[] = [];
  let profile!: (value: Record<string, unknown> | undefined) => void;
  let access!: (value: Record<string, unknown> | undefined) => void;
  let fail!: () => void; let stopped = 0;
  const stop = observeAdminAccess({ uid: 'admin', getIdTokenResult: async () => ({ claims }) }, {
    watchProfile: (_uid, next) => { profile = next; return () => stopped++; },
    watchAccess: (_uid, next, error) => { access = next; fail = error; return () => stopped++; },
    changed: allowed => values.push(allowed),
  });
  return { values, profile: (value: Record<string, unknown>) => profile(value), access: (value: Record<string, unknown> | undefined) => access(value), fail: () => fail(), stop, get stopped() { return stopped; } };
}

test('browser drops admin authorization when the registry is revoked without refreshing the cached token', async () => {
  const f = fixture(); f.profile({ role: 'admin' });
  f.access({ schemaVersion: 1, enabled: true, epoch: 'legacy' }); await Promise.resolve();
  assert.equal(f.values.at(-1), true);
  f.access({ schemaVersion: 1, enabled: false, epoch: 'a'.repeat(32) });
  assert.equal(f.values.at(-1), false);
  f.access({ schemaVersion: 1, enabled: true, epoch: 'b'.repeat(32) });
  assert.equal(f.values.at(-1), false); // Regrant requires a new token.
  f.stop();
});

test('browser fails closed on missing authorization/errors and ignores callbacks after cleanup', async () => {
  const f = fixture(); f.profile({ role: 'admin' }); f.access(undefined); await Promise.resolve();
  assert.equal(f.values.at(-1), false);
  f.fail(); f.access({ schemaVersion: 1, enabled: true, epoch: 'legacy' });
  assert.equal(f.values.at(-1), false);
  const length = f.values.length; f.stop();
  f.profile({ role: 'admin' }); f.access({ schemaVersion: 1, enabled: true, epoch: 'legacy' });
  assert.equal(f.values.length, length); assert.equal(f.stopped, 2);
});

test('browser preserves migrated legacy roles and accepts only the new epoch for versioned grants', async () => {
  const f = fixture({}); f.profile({ role: 'admin' }); f.access({ schemaVersion: 1, enabled: true, epoch: 'legacy' });
  await Promise.resolve(); assert.equal(f.values.at(-1), true); f.stop();
  const g = fixture({ admin: true, gbAdminEpoch: 'c'.repeat(32) }); g.profile({ role: 'user' });
  g.access({ schemaVersion: 1, enabled: true, epoch: 'c'.repeat(32) }); await Promise.resolve();
  assert.equal(g.values.at(-1), true); g.stop();
});
