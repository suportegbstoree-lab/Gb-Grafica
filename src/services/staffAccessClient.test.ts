import assert from 'node:assert/strict';
import test from 'node:test';
import { observeStaffAccess, staffAccessDiagnostic } from './staffAccessClient';
import type { StaffPermission } from '../lib/staffAccess';
const access = { schemaVersion: 1, enabled: true, epoch: 'a'.repeat(32), roleId: 'designer' };
const policy = { schemaVersion: 1, enabled: true, revision: 'b'.repeat(32), permissions: ['products.images', 'orders.read'] };
function fixture() {
  const values: StaffPermission[][] = []; let emit!: (value: unknown) => void; let role!: (value: unknown) => void; let fail!: () => void;
  const stop = observeStaffAccess({ uid: 'employee', getIdTokenResult: async () => ({ claims: { staffRole: 'designer', gbStaffEpoch: access.epoch } }) }, {
    watchAccess: (_uid, next, error) => { emit = next; fail = error; return () => {}; },
    watchRole: (_id, next) => { role = next; return () => {}; }, changed: value => values.push(value),
  });
  return { values, emit: (value: unknown) => emit(value), role: (value: unknown) => role(value), fail: () => fail(), stop };
}
test('role changes remove cached permissions without waiting for token refresh', async () => {
  const f = fixture(); f.emit(access); await Promise.resolve(); f.role(policy);
  assert.deepEqual(f.values.at(-1), policy.permissions);
  f.role({ ...policy, permissions: ['products.images'] }); assert.deepEqual(f.values.at(-1), ['products.images']);
  f.emit({ ...access, enabled: false }); assert.deepEqual(f.values.at(-1), []);
  f.stop();
});
test('errors and callbacks from ended subscriptions cannot restore access', async () => {
  const f = fixture(); f.emit(access); await Promise.resolve(); f.role(policy); f.fail(); f.role(policy);
  assert.deepEqual(f.values.at(-1), []); const length = f.values.length; f.stop(); f.emit(access); f.role(policy); assert.equal(f.values.length, length);
});

test('initial access remains pending until the role policy arrives, preventing an early panel rejection', async () => {
  const states: Array<{ ready: boolean; permissions: StaffPermission[] }> = []; let role!: (value: unknown) => void;
  const stop = observeStaffAccess({ uid: 'employee', getIdTokenResult: async () => ({ claims: { staffRole: 'designer', gbStaffEpoch: access.epoch } }) }, {
    watchAccess: (_uid, next) => { next(access); return () => {}; },
    watchRole: (_id, next) => { role = next; return () => {}; }, changed: (permissions, state) => states.push({ ...state, permissions }),
  });
  await Promise.resolve(); assert.equal(states.at(-1)?.ready, false);
  role(policy); assert.equal(states.at(-1)?.ready, true); assert.deepEqual(states.at(-1)?.permissions, policy.permissions);
  stop();
});
test('an old session explicitly requests sign-in instead of entering an automatic refresh loop', async () => {
  let calls = 0; const states: Array<{ ready: boolean; assigned: boolean; issue: string | null }> = [];
  const stop = observeStaffAccess({ uid: 'employee', getIdTokenResult: async () => { calls++; return { claims: {} }; } }, {
    watchAccess: (_uid, next) => { next(access); return () => {}; }, watchRole: () => { throw new Error('Must not read role with stale token'); },
    changed: (permissions, state) => { assert.deepEqual(permissions, []); states.push(state); },
  });
  await Promise.resolve(); assert.equal(states.at(-1)?.issue, 'sign-in-required'); assert.equal(states.at(-1)?.ready, true); assert.equal(calls, 1); stop();
});
test('missing role rules are reported as unavailable and a later revoked session cannot restore permissions', async () => {
  const states: Array<{ ready: boolean; issue: string | null; permissions: StaffPermission[] }> = []; let failRole!: () => void;
  const stop = observeStaffAccess({ uid: 'employee', getIdTokenResult: async () => ({ claims: { staffRole: 'designer', gbStaffEpoch: access.epoch } }) }, {
    watchAccess: (_uid, next) => { next(access); return () => {}; }, watchRole: (_id, _next, error) => { failRole = error; return () => {}; },
    changed: (permissions, state) => states.push({ ...state, permissions }),
  });
  await Promise.resolve(); failRole(); assert.deepEqual(states.at(-1)?.permissions, []); assert.equal(states.at(-1)?.ready, true); assert.equal(states.at(-1)?.issue, 'unavailable'); stop();
});

test('access diagnostics retain only the operation and a safe SDK code', () => {
  const value = staffAccessDiagnostic('staff-policy', { code: 'permission-denied', message: 'secret-bearer-token', accessToken: 'secret-token' });
  assert.deepEqual(value, { source: 'staff-policy', code: 'permission-denied' }); assert.ok(!JSON.stringify(value).includes('secret'));
  assert.equal(staffAccessDiagnostic('session-token', { code: 'SECRET token data' }).code, 'unknown');
});
test('an expired session requests sign-in and never receives permissions', async () => {
  const states: Array<{ issue: string | null; diagnostic?: { source: string; code: string } }> = [];
  const stop = observeStaffAccess({ uid: 'employee', getIdTokenResult: async () => { throw { code: 'auth/user-token-expired', token: 'secret-token' }; } }, {
    watchAccess: (_uid, next) => { next(access); return () => {}; }, watchRole: () => { throw new Error('must not read role'); },
    changed: (permissions, state) => { assert.deepEqual(permissions, []); states.push(state); },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(states.at(-1)?.issue, 'sign-in-required'); assert.deepEqual(states.at(-1)?.diagnostic, { source: 'session-token', code: 'auth/user-token-expired' }); stop();
});
test('a refused policy read is exposed with its SDK code while all permissions stay closed', async () => {
  let deny!: (reason?: unknown) => void;
  const states: Array<{ issue: string | null; diagnostic?: { source: string; code: string } }> = [];
  const stop = observeStaffAccess({ uid: 'employee', getIdTokenResult: async () => ({ claims: { staffRole: 'designer', gbStaffEpoch: access.epoch } }) }, {
    watchAccess: (_uid, next) => { next(access); return () => {}; }, watchRole: (_id, _next, error) => { deny = error; return () => {}; },
    changed: (permissions, state) => { assert.deepEqual(permissions, []); states.push(state); },
  });
  await Promise.resolve(); deny({ code: 'permission-denied', message: 'secret-response' });
  assert.equal(states.at(-1)?.issue, 'unavailable'); assert.deepEqual(states.at(-1)?.diagnostic, { source: 'staff-policy', code: 'permission-denied' });
  assert.ok(!JSON.stringify(states).includes('secret')); stop();
});
