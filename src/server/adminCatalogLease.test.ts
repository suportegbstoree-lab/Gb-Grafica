import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogLeaseAllows, MAX_CATALOG_LEASE_MS, parseCatalogLeaseArgs } from './adminCatalogLease.js';

const now = 1_000_000;
const access = { schemaVersion: 1 as const, enabled: true, epoch: 'a'.repeat(32), updatedAt: '' };
const claims = { admin: true, gbAdminEpoch: access.epoch };
const lease = { schemaVersion: 1, enabled: true, epoch: access.epoch, issuedAt: now - 1000, expiresAt: now + 1000 };

test('exceção exige administrador atual, época compatível e prazo válido', () => {
  assert.equal(catalogLeaseAllows(lease, access, claims, now), true);
  for (const invalid of [null, {}, { ...lease, enabled: false }, { ...lease, expiresAt: now }, { ...lease, issuedAt: now + 1 }, { ...lease, expiresAt: now + MAX_CATALOG_LEASE_MS }, { ...lease, epoch: 'b'.repeat(32) }]) {
    assert.equal(catalogLeaseAllows(invalid, access, claims, now), false);
  }
  assert.equal(catalogLeaseAllows(lease, { ...access, enabled: false }, claims, now), false);
  assert.equal(catalogLeaseAllows(lease, access, { admin: false }, now), false);
  assert.equal(catalogLeaseAllows(lease, access, { ...claims, gbAdminEpoch: 'b'.repeat(32) }, now), false);
});

test('revogar e conceder novamente não reativa a exceção antiga', () => {
  const current = { ...access, epoch: 'b'.repeat(32) };
  assert.equal(catalogLeaseAllows(lease, current, { admin: true, gbAdminEpoch: current.epoch }, now), false);
});

test('comando limita duração a 24 horas e aceita revogação e dry run', () => {
  assert.deepEqual(parseCatalogLeaseArgs(['--email', 'ADMIN@example.com', '--hours', '2', '--dry-run']), { email: 'admin@example.com', hours: 2, revoke: false, dryRun: true, help: false });
  assert.equal(parseCatalogLeaseArgs(['--email', 'a@example.com', '--revoke']).revoke, true);
  for (const args of [[], ['--email'], ['--email', '--revoke'], ['--email', 'a@example.com', '--hours', '25'], ['--email', 'a@example.com', '--hours', '0'], ['--email', 'a@example.com', '--unknown']]) assert.throws(() => parseCatalogLeaseArgs(args));
});
