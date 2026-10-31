import assert from 'node:assert/strict';
import test, { before, beforeEach, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin, type App as AdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, onSnapshot, doc, collection, getDocs, terminate } from 'firebase/firestore';
import { observeStaffAccess, type StaffAccessState } from '../../src/services/staffAccessClient';
import type { StaffPermission } from '../../src/lib/staffAccess';

const projectId = 'demo-gb-grafica-rules', epoch = 'a'.repeat(32), password = 'Test-only-password-134';
let env: RulesTestEnvironment, admin: AdminApp, client: FirebaseApp, uid = '', email = '';
before(async () => {
  for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) assert.match(process.env[name] || '', /^(127\.0\.0\.1|localhost):\d+$/);
  env = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile('firestore.rules', 'utf8') } });
  admin = initializeAdmin({ projectId }, 'staff-session-tests');
});
beforeEach(async () => {
  await env.clearFirestore(); uid = `session-${randomUUID().slice(0, 8)}`; email = `${uid}@example.test`;
  await getAdminAuth(admin).createUser({ uid, email, password });
  await getAdminAuth(admin).setCustomUserClaims(uid, { admin: false, staffRole: 'designer', gbStaffEpoch: epoch });
  const db = getAdminFirestore(admin);
  await db.doc(`_staffAccess/${uid}`).set({ schemaVersion: 1, enabled: true, epoch, roleId: 'designer' });
  await db.doc('_staffRoles/designer').set({ schemaVersion: 1, enabled: true, revision: 'b'.repeat(32), permissions: ['fonts.manage'] });
  client = initializeApp({ projectId, apiKey: 'emulator-only-key' }, uid);
  connectAuthEmulator(getAuth(client), `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':'); connectFirestoreEmulator(getFirestore(client), host, Number(port));
  await signInWithEmailAndPassword(getAuth(client), email, password);
});
after(async () => { await env.cleanup(); await deleteAdmin(admin); });
async function session() {
  const db = getFirestore(client);
  let stop = () => {};
  const settled = new Promise<{ permissions: StaffPermission[]; state: StaffAccessState }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Session access did not settle')), 10_000);
    stop = observeStaffAccess(getAuth(client).currentUser!, {
      watchAccess: (id, next, error) => onSnapshot(doc(db, '_staffAccess', id), { includeMetadataChanges: true }, snapshot => { if (!snapshot.metadata.fromCache) next(snapshot.data()); }, error),
      watchRole: (id, next, error) => onSnapshot(doc(db, '_staffRoles', id), { includeMetadataChanges: true }, snapshot => { if (!snapshot.metadata.fromCache) next(snapshot.data()); }, error),
      changed: (permissions, state) => { if (state.ready) { clearTimeout(timer); resolve({ permissions, state }); } },
    });
  });
  try { return await settled; } finally { stop(); }
}
async function closeClient() { await terminate(getFirestore(client)); await deleteApp(client); await getAdminAuth(admin).deleteUser(uid); }

test('real Auth emulator staff claims without admin=true load only the assigned policy and cannot list private orders', async () => {
  try {
    const token = await getAuth(client).currentUser!.getIdTokenResult(); assert.equal(token.claims.admin, false);
    const result = await session(); assert.equal(result.state.issue, null); assert.deepEqual(result.permissions, ['fonts.manage']);
    await assert.rejects(getDocs(collection(getFirestore(client), 'orders')), (error: { code: string }) => error.code === 'permission-denied');
  } finally { await closeClient(); }
});
test('an old actual Firebase token needs sign-in after a new access epoch; signing in loads the new claims', async () => {
  try {
    const nextEpoch = 'c'.repeat(32);
    await getAdminAuth(admin).setCustomUserClaims(uid, { admin: false, staffRole: 'designer', gbStaffEpoch: nextEpoch });
    await getAdminFirestore(admin).doc(`_staffAccess/${uid}`).update({ epoch: nextEpoch });
    const old = await session(); assert.deepEqual(old.permissions, []); assert.equal(old.state.issue, 'sign-in-required');
    await signInWithEmailAndPassword(getAuth(client), email, password);
    const fresh = await session(); assert.deepEqual(fresh.permissions, ['fonts.manage']); assert.equal(fresh.state.issue, null);
  } finally { await closeClient(); }
});
test('a missing live role policy is reported to the browser without granting fallback administrator access', async () => {
  try {
    await getAdminFirestore(admin).doc('_staffRoles/designer').delete();
    const result = await session(); assert.deepEqual(result.permissions, []); assert.equal(result.state.issue, 'unavailable');
  } finally { await closeClient(); }
});
