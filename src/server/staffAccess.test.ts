import assert from 'node:assert/strict';
import test from 'node:test';
import { assignStaffRole, updateStaffRole, deleteStaffRole, type StaffBackend, type StaffStore } from './staffAccess';
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
test('staff assignment preserves protected administrator authority', async () => {
  const f = fixture(); f.setAdmin(); await assert.rejects(assignStaffRole(f.backend, 'employee', 'designer', 'administrator'), (e: { status: number }) => e.status === 403);
  assert.equal(f.account.customClaims.admin, true); assert.equal(await f.backend.isAdmin('employee'), true);
  assert.equal(f.access[0].has('employee'), false);
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

test('custom role policies are mirrored and missing, invalid or administrative roles cannot be assigned', async () => {
  const f = fixture(), id = 'custom-design';
  await assert.rejects(assignStaffRole(f.backend, 'employee', id, 'admin'), /Cadastre o cargo/);
  await updateStaffRole(f.backend, id, ['products.images'], null, 'admin', 'Design Gráfico');
  await assignStaffRole(f.backend, 'employee', id, 'admin');
  assert.equal(f.account.customClaims.admin, false); assert.equal(f.account.customClaims.staffRole, id);
  for (let i = 0; i < 2; i++) { assert.equal(f.roles[i].get(id)?.name, 'Design Gráfico'); assert.deepEqual(staffPermissions(f.access[i].get('employee'), f.roles[i].get(id), f.account.customClaims), ['products.images']); }
  for (const invalid of ['admin', 'administrator', 'owner', 'constructor', '../role']) await assert.rejects(updateStaffRole(f.backend, invalid, [], null, 'admin', 'Outro'));
  await assert.rejects(updateStaffRole(f.backend, 'other-design', ['invalid.permission'], null, 'admin', 'Outro'));
});


test('deleting an assigned role revokes unchanged tokens in both registries and never deletes the account', async () => {
  const f = fixture();
  await assignStaffRole(f.backend, 'employee', 'designer', 'administrator');
  const claims = { ...f.account.customClaims }, before = structuredClone(f.account);
  await deleteStaffRole(f.backend, 'designer', f.roles[0].get('designer')!.revision, 'administrator');
  for (let index = 0; index < 2; index++) {
    const policy = f.roles[index].get('designer')!;
    assert.equal(policy.deleted, true); assert.equal(policy.deletionPending, false); assert.equal(policy.enabled, false);
    assert.deepEqual(policy.permissions, []); assert.equal(policy.updatedBy, 'administrator');
    assert.deepEqual(staffPermissions(f.access[index].get('employee'), policy, claims), []);
  }
  assert.deepEqual(f.account, before, 'customer login and unrelated claims stay intact');
  await assert.rejects(assignStaffRole(f.backend, 'employee', 'designer', 'administrator'), /excluído/);
  await assert.rejects(updateStaffRole(f.backend, 'designer', ['products.images'], f.roles[0].get('designer')!.revision, 'administrator'), /excluído/);
  await updateStaffRole(f.backend, 'new-designer', ['products.images'], null, 'administrator', 'Designer');
  await assignStaffRole(f.backend, 'employee', 'new-designer', 'administrator');
  assert.deepEqual(staffPermissions(f.access[0].get('employee'), f.roles[0].get('new-designer'), claims), [], 'a new role with the same label does not revive old tokens');
});

test('deletion protects administrators, requires the current revision and can remove an unconfigured default role', async () => {
  const f = fixture();
  await updateStaffRole(f.backend, 'custom-role', [], null, 'admin', 'Temporário');
  const before = structuredClone(f.roles[0].get('custom-role'));
  await assert.rejects(deleteStaffRole(f.backend, 'custom-role', 'f'.repeat(32), 'admin'), (error: any) => error.status === 409);
  assert.deepEqual(f.roles[0].get('custom-role'), before);
  for (const id of ['administrator', 'admin', 'owner']) await assert.rejects(deleteStaffRole(f.backend, id, null, 'admin'), (error: any) => error.status === 422);
  await assert.rejects(deleteStaffRole(f.backend, 'missing-role', null, 'admin'), (error: any) => error.status === 404);
  await deleteStaffRole(f.backend, 'product-manager', null, 'admin');
  assert.ok(f.roles.every(map => map.get('product-manager')?.deleted));
  await assert.rejects(assignStaffRole(f.backend, 'employee', 'product-manager', 'admin'), /excluído/);
});

test('a mirror failure keeps a pending deletion visible and retry closes every mirror without reopening it', async () => {
  const f = fixture(); await assignStaffRole(f.backend, 'employee', 'designer', 'admin');
  const revision = f.roles[0].get('designer')!.revision, write = f.backend.stores[1].writeRole;
  f.backend.stores[1].writeRole = async () => { throw new Error('Mirror unavailable'); };
  await assert.rejects(deleteStaffRole(f.backend, 'designer', revision, 'admin'), (error: any) => error.status === 503);
  assert.equal(f.roles[0].get('designer')?.deletionPending, true);
  assert.equal(f.roles[0].get('designer')?.deleted, undefined);
  await assert.rejects(updateStaffRole(f.backend, 'designer', ['products.images'], f.roles[0].get('designer')!.revision, 'admin'), /excluído/);
  f.backend.stores[1].writeRole = write;
  await deleteStaffRole(f.backend, 'designer', f.roles[0].get('designer')!.revision, 'admin');
  assert.ok(f.roles.every(map => map.get('designer')?.deleted && !map.get('designer')?.enabled));
});

test('failure finalizing the primary deletion leaves all access closed and the operation can be resumed', async () => {
  const f = fixture(); await assignStaffRole(f.backend, 'employee', 'designer', 'admin');
  const claims = { ...f.account.customClaims }, write = f.backend.stores[0].writeRole;
  f.backend.stores[0].writeRole = async (id, value, expected) => { if (value.deleted) throw new Error('Primary unavailable'); await write(id, value, expected); };
  await assert.rejects(deleteStaffRole(f.backend, 'designer', f.roles[0].get('designer')!.revision, 'admin'), (error: any) => error.status === 503);
  assert.equal(f.roles[0].get('designer')?.deletionPending, true);
  assert.equal(f.roles[1].get('designer')?.deleted, true);
  for (let index = 0; index < 2; index++) assert.deepEqual(staffPermissions(f.access[index].get('employee'), f.roles[index].get('designer'), claims), []);
  await assert.rejects(assignStaffRole(f.backend, 'employee', 'designer', 'admin'), /excluído/);
  f.backend.stores[0].writeRole = write;
  await deleteStaffRole(f.backend, 'designer', f.roles[0].get('designer')!.revision, 'admin');
  assert.ok(f.roles.every(map => map.get('designer')?.deleted));
});
