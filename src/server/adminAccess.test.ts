import assert from 'node:assert/strict';
import test from 'node:test';
import { adminAccessRecordAllows, type AdminAccessRecord } from '../lib/adminAccess.js';
import { applyAdminAccessSync, grantAdminAccess, planAdminAccessSync, revokeAdminAccess, type AdminAccessBackend, type AdminAccessStore } from './adminAccess.js';
import { parseAdminAccessArguments } from './adminAccessCli.js';

const legacy = (): AdminAccessRecord => ({ schemaVersion: 1, enabled: true, epoch: 'legacy', updatedAt: '2026-10-29T00:00:00Z' });
function fixture() {
  const maps = [new Map<string, AdminAccessRecord>(), new Map<string, AdminAccessRecord>()];
  const events: string[] = [];
  const account = { uid: 'alice', email: 'alice@example.com', disabled: false, customClaims: { admin: true, unrelated: 'preserved' } as Record<string, unknown> };
  let role = 'admin';
  const stores: AdminAccessStore[] = maps.map((map, index) => ({
    name: index === 0 ? 'named' : '(default)',
    async read(uid) { return map.get(uid) || null; },
    async write(uid, record, expected) {
      const existing = map.get(uid);
      if (expected === null ? !!existing : expected !== undefined && existing?.epoch !== expected) throw new Error('epoch conflict');
      map.set(uid, { ...record }); events.push(`registry:${index}:${record.enabled}`);
    },
  }));
  const backend: AdminAccessBackend = {
    stores,
    getAccount: async () => ({ ...account, customClaims: { ...account.customClaims } }),
    getProfileRole: async () => role,
    async setProfile(_uid, _email, value) { role = value; events.push(`profile:${value}`); },
    async setClaims(_uid, claims) { account.customClaims = { ...claims }; events.push('claims'); },
    async revokeSessions() { events.push('sessions'); },
  };
  return { backend, maps, events, account, get role() { return role; } };
}

test('admin registry rejects missing, disabled, malformed and mismatched epochs', () => {
  for (const value of [undefined, {}, { ...legacy(), enabled: false }, { ...legacy(), schemaVersion: 2 }, { ...legacy(), epoch: 'invalid' }]) {
    assert.equal(adminAccessRecordAllows(value, { admin: true }), false);
  }
  const current = { ...legacy(), epoch: 'a'.repeat(32) };
  assert.equal(adminAccessRecordAllows(current, { admin: true }), false);
  assert.equal(adminAccessRecordAllows(current, { admin: true, gbAdminEpoch: 'b'.repeat(32) }), false);
  assert.equal(adminAccessRecordAllows(current, { admin: false, gbAdminEpoch: current.epoch }), false);
  assert.equal(adminAccessRecordAllows(current, { admin: true, gbAdminEpoch: current.epoch }), true);
  assert.equal(adminAccessRecordAllows(legacy(), {}), true); // Role is checked by the caller.
  assert.equal(adminAccessRecordAllows(legacy(), { admin: true, gbAdminEpoch: current.epoch }), false);
});

test('grant closes both databases before claims, preserves claims and activates the same new epoch', async () => {
  const f = fixture();
  await grantAdminAccess(f.backend, 'alice');
  assert.deepEqual(f.events.slice(0, 2), ['registry:0:false', 'registry:1:false']);
  assert.deepEqual(f.events.slice(-2), ['registry:0:true', 'registry:1:true']);
  assert.equal(f.account.customClaims.unrelated, 'preserved');
  const epoch = f.account.customClaims.gbAdminEpoch;
  assert.match(String(epoch), /^[a-f0-9]{32}$/);
  for (const map of f.maps) assert.equal(map.get('alice')?.epoch, epoch);
});

test('revocation blocks stale tokens, removes both roles and revokes sessions; a new grant cannot revive the old epoch', async () => {
  const f = fixture();
  await grantAdminAccess(f.backend, 'alice');
  const oldToken = { ...f.account.customClaims };
  await revokeAdminAccess(f.backend, 'alice');
  assert.equal(f.role, 'user'); assert.equal(f.account.customClaims.admin, false);
  assert.equal(f.account.customClaims.gbAdminEpoch, undefined);
  assert.equal(f.events.at(-1), 'sessions');
  for (const map of f.maps) assert.equal(adminAccessRecordAllows(map.get('alice'), oldToken), false);
  await grantAdminAccess(f.backend, 'alice');
  for (const map of f.maps) {
    assert.equal(adminAccessRecordAllows(map.get('alice'), oldToken), false);
    assert.equal(adminAccessRecordAllows(map.get('alice'), f.account.customClaims), true);
  }
});

test('revocation attempts all remaining steps after a registry failure and never reports success', async () => {
  const f = fixture();
  f.backend.stores[0].write = async () => { throw new Error('unavailable'); };
  await assert.rejects(revokeAdminAccess(f.backend, 'alice'), /incomplete.*registry:named/);
  assert.equal(f.maps[1].get('alice')?.enabled, false);
  assert.equal(f.role, 'user'); assert.equal(f.account.customClaims.admin, false);
  assert.equal(f.events.at(-1), 'sessions');
});

test('failed grants close their epoch and a concurrent revocation cannot be overwritten by stale activation', async () => {
  const f = fixture();
  const original = f.backend.setClaims;
  f.backend.setClaims = async (uid, claims) => {
    await original(uid, claims);
    if (claims.admin === true) await revokeAdminAccess(f.backend, uid);
  };
  await assert.rejects(grantAdminAccess(f.backend, 'alice'), /did not complete/);
  for (const map of f.maps) assert.equal(map.get('alice')?.enabled, false);
  assert.equal(f.account.customClaims.admin, false);
});

test('Auth failure during a grant leaves both registries closed and disabled accounts are never granted', async () => {
  const f = fixture(); f.account.disabled = true;
  await assert.rejects(grantAdminAccess(f.backend, 'alice'), /disabled/);
  assert.equal(f.events.length, 0);
  f.account.disabled = false;
  f.backend.setClaims = async () => { throw new Error('Auth unavailable'); };
  await assert.rejects(grantAdminAccess(f.backend, 'alice'), /did not complete/);
  for (const map of f.maps) assert.equal(map.get('alice')?.enabled, false);
  assert.ok(!f.events.some(value => value.endsWith(':true')));
});

test('revocation still closes registries and legacy role when current Auth lookup fails', async () => {
  const f = fixture();
  f.backend.getAccount = async () => { throw new Error('Auth unavailable'); };
  await assert.rejects(revokeAdminAccess(f.backend, 'alice'), /incomplete.*claims/);
  for (const map of f.maps) assert.equal(map.get('alice')?.enabled, false);
  assert.equal(f.role, 'user'); assert.equal(f.events.at(-1), 'sessions');
});

test('revocation by UID closes stale authorization after the Auth account was deleted', async () => {
  const f = fixture();
  const missing = () => Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
  f.backend.getAccount = async () => { throw missing(); };
  f.backend.revokeSessions = async () => { throw missing(); };
  await revokeAdminAccess(f.backend, 'alice');
  for (const map of f.maps) assert.equal(map.get('alice')?.enabled, false);
  assert.equal(f.role, 'user');
});

test('migration preserves active legacy admins, repairs only missing mirrors and never resurrects a denial', async () => {
  const f = fixture();
  const item = await planAdminAccessSync(f.backend, 'alice');
  assert.equal(item.action, 'create'); assert.equal(f.events.length, 0);
  await applyAdminAccessSync(f.backend, item);
  for (const map of f.maps) assert.equal(map.get('alice')?.epoch, 'legacy');
  f.maps[1].delete('alice');
  const repair = await planAdminAccessSync(f.backend, 'alice');
  assert.equal(repair.action, 'repair'); await applyAdminAccessSync(f.backend, repair);
  await revokeAdminAccess(f.backend, 'alice');
  await applyAdminAccessSync(f.backend, item);
  for (const map of f.maps) assert.equal(map.get('alice')?.enabled, false);
  assert.equal((await planAdminAccessSync(f.backend, 'alice')).action, 'blocked');
});

test('migration rejects conflicting mirrors and never authorizes disabled/non-admin accounts', async () => {
  const f = fixture();
  f.maps[0].set('alice', legacy()); f.maps[1].set('alice', { ...legacy(), enabled: false });
  await assert.rejects(planAdminAccessSync(f.backend, 'alice'), /disagree/);
  f.maps.forEach(map => map.clear()); f.account.disabled = true;
  const blocked = await planAdminAccessSync(f.backend, 'alice');
  assert.equal(blocked.action, 'blocked'); await applyAdminAccessSync(f.backend, blocked);
  for (const map of f.maps) assert.equal(map.get('alice')?.enabled, false);
});

test('CLI preserves grant syntax, defaults migration to dry-run and rejects conflicting or unknown arguments', () => {
  assert.equal(parseAdminAccessArguments(['--email', 'Alice@example.com']).email, 'alice@example.com');
  assert.equal(parseAdminAccessArguments(['--email', 'a@b.test', '--revoke']).revoke, true);
  assert.equal(parseAdminAccessArguments(['--uid', 'uid-123', '--revoke']).uid, 'uid-123');
  assert.throws(() => parseAdminAccessArguments(['--uid', 'uid-123']));
  assert.throws(() => parseAdminAccessArguments(['--uid', '--revoke', '--revoke']));
  assert.throws(() => parseAdminAccessArguments(['--uid', 'uid-123', '--email', 'a@b.test', '--revoke']));
  assert.equal(parseAdminAccessArguments([], true).dryRun, true);
  assert.equal(parseAdminAccessArguments(['--apply'], true).dryRun, false);
  for (const args of [['--email'], ['--email', 'not-an-email'], ['--unknown'], ['--email', 'a@b.test', '--revoke', '--revoke']]) assert.throws(() => parseAdminAccessArguments(args));
  assert.throws(() => parseAdminAccessArguments(['--apply', '--dry-run'], true));
  assert.throws(() => parseAdminAccessArguments(['--dry-run', '--apply'], true));
});
