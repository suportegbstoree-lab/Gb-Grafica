import assert from 'node:assert/strict';
import test from 'node:test';
import { assignStaffRole, updateStaffRole, type StaffBackend, type StaffStore } from './staffAccess';
import { staffPermissions, DEFAULT_ROLE_PERMISSIONS, type StaffAccessRecord, type StaffRoleRecord } from '../lib/staffAccess';

function fixture() {
  const access = [new Map<string, StaffAccessRecord>(), new Map<string, StaffAccessRecord>()];
  const roles = [new Map<string, StaffRoleRecord>(), new Map<string, StaffRoleRecord>()];
  const account = { uid: 'employee', email: 'employee@example.com', disabled: false, customClaims: { unrelated: 'kept' } as Record<string, unknown> };
  let admin = false;
  const stores: StaffStore[] = access.map((data, index) => ({ name: String(index),
    readAccess: async uid => data.get(uid) || null,
    async writeAccess(uid, value, expected) { const current = data.get(uid); if (expected === null ? !!current : expected !== undefined && current?.epoch !== expected) throw new Error('Access conflict'); data.set(uid, { ...value }); },
    readRole: async id => roles[index].get(id) || null,
    async writeRole(id, value, expected) { const current = roles[index].get(id); if (expected === null ? !!current : expected !== undefined && current?.revision !== expected) throw new Error('Role conflict'); roles[index].set(id, { ...value }); },
  }));
  const backend: StaffBackend = { stores, getAccount: async () => ({ ...account, customClaims: { ...account.customClaims } }),
    async setClaims(_uid, value) { account.customClaims = value; },
    async removeAdmin() { admin = false; account.customClaims.admin = false; for (const map of access) { const value = map.get('employee'); if (value) map.set('employee', { ...value, enabled: false }); } },
    isAdmin: async () => admin,
  };
  return { backend, access, roles, account, setAdmin: () => { admin = true; account.customClaims.admin = true; } };
}
test('assignment closes both registries before granting matching claims and preserves unrelated claims', async () => {
  const f = fixture(); const result = await assignStaffRole(f.backend, 'employee', 'designer', 'administrator');
  assert.equal(result.changed, true); assert.equal(f.account.customClaims.admin, false); assert.equal(f.account.customClaims.unrelated, 'kept');
  for (let i = 0; i < 2; i++) assert.deepEqual(staffPermissions(f.access[i].get('employee'), f.roles[i].get('designer'), f.account.customClaims), DEFAULT_ROLE_PERMISSIONS.designer);
  assert.equal((await assignStaffRole(f.backend, 'employee', 'designer', 'administrator')).changed, false);
});
test('role permission revocation takes effect with an unchanged token', async () => {
  const f = fixture(); await assignStaffRole(f.backend, 'employee', 'designer', 'administrator');
  const claims = { ...f.account.customClaims }, revision = f.roles[0].get('designer')!.revision;
  await updateStaffRole(f.backend, 'designer', ['products.images'], revision, 'administrator');
  for (let i = 0; i < 2; i++) assert.deepEqual(staffPermissions(f.access[i].get('employee'), f.roles[i].get('designer'), claims), ['products.images']);
});
test('changing roles rotates epochs and stale tokens never regain access', async () => {
  const f = fixture(); await assignStaffRole(f.backend, 'employee', 'designer', 'administrator'); const stale = { ...f.account.customClaims };
  await assignStaffRole(f.backend, 'employee', 'product-manager', 'administrator');
  await assignStaffRole(f.backend, 'employee', 'designer', 'administrator');
  for (let i = 0; i < 2; i++) assert.deepEqual(staffPermissions(f.access[i].get('employee'), f.roles[i].get('designer'), stale), []);
});
test('staff assignment cannot retain administrator authority', async () => {
  const f = fixture(); f.setAdmin(); await assignStaffRole(f.backend, 'employee', 'designer', 'administrator');
  assert.equal(f.account.customClaims.admin, false); assert.equal(await f.backend.isAdmin('employee'), false);
});
test('Auth failure leaves its own staff epochs closed and stale policy edits are refused', async () => {
  const f = fixture(); f.backend.setClaims = async () => { throw new Error('Auth unavailable'); };
  await assert.rejects(assignStaffRole(f.backend, 'employee', 'designer', 'administrator'), /Auth unavailable/);
  for (const map of f.access) assert.equal(map.get('employee')!.enabled, false);
  await assert.rejects(updateStaffRole(f.backend, 'designer', ['products.images'], null, 'administrator'), /mudou/);
});
test('a concurrent revocation cannot be undone by a failed assignment cleanup', async () => {
  const f = fixture();
  f.backend.setClaims = async () => { for (const map of f.access) map.set('employee', { ...map.get('employee')!, enabled: false, epoch: 'f'.repeat(32) }); throw new Error('Concurrent change'); };
  await assert.rejects(assignStaffRole(f.backend, 'employee', 'designer', 'administrator'));
  for (const map of f.access) assert.equal(map.get('employee')!.epoch, 'f'.repeat(32));
});
test('disabled accounts and mismatched mirrors cannot receive staff roles', async () => {
  const f = fixture(); f.account.disabled = true;
  await assert.rejects(assignStaffRole(f.backend, 'employee', 'designer', 'administrator'), /ativa/);
  f.account.disabled = false; await assignStaffRole(f.backend, 'employee', 'designer', 'administrator');
  f.roles[1].set('designer', { ...f.roles[1].get('designer')!, revision: 'f'.repeat(32) });
  await assert.rejects(assignStaffRole(f.backend, 'employee', 'designer', 'administrator'), /sincronizadas/);
});
