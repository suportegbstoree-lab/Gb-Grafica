import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import test, { before, after } from 'node:test';
import { initializeApp as adminApp, deleteApp as deleteAdminApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore as adminFirestore } from 'firebase-admin/firestore';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, deleteDoc, collection, getDocs, terminate } from 'firebase/firestore';
import { getStorage, connectStorageEmulator, ref, uploadBytes, listAll, deleteObject, getMetadata } from 'firebase/storage';

const projectId = 'demo-gb-grafica-rules';
const databaseId = 'admin-access-revocation-tests';
let app: App;
let fakeAccount: string;
const clients: FirebaseApp[] = [];
const databases: ReturnType<typeof getFirestore>[] = [];

function emulator(name: string) {
  const address = process.env[name];
  assert.ok(address && /^(127\.0\.0\.1|localhost):\d+$/.test(address), `Use only a local ${name} emulator.`);
  const [host, port] = address.split(':'); return { address, host, port: Number(port) };
}

before(async () => {
  emulator('FIREBASE_AUTH_EMULATOR_HOST'); emulator('FIRESTORE_EMULATOR_HOST'); emulator('FIREBASE_STORAGE_EMULATOR_HOST');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  fakeAccount = JSON.stringify({ project_id: projectId, client_email: `fake@${projectId}.iam.gserviceaccount.com`, private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  app = adminApp({ projectId }, 'admin-revocation-integration');
});

after(async () => {
  await Promise.all(databases.map(db => terminate(db)));
  await Promise.all(clients.map(client => deleteApp(client)));
  await deleteAdminApp(app);
});

async function cli(script: string, args: string[]) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', `scripts/${script}.ts`, ...args], {
      cwd: process.cwd(), env: { ...process.env, FIREBASE_SERVICE_ACCOUNT_JSON: fakeAccount, FIREBASE_FIRESTORE_DATABASE_ID: databaseId,
        FIREBASE_STORAGE_BUCKET: `${projectId}.appspot.com` }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Admin CLI timed out.')); }, 30_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

async function account(kind: string, claims: Record<string, unknown> = { admin: true }) {
  const uid = `revocation-${kind}-${randomUUID().slice(0, 8)}`; const email = `${uid}@example.com`; const password = 'EmulatorOnly-password-123';
  await getAuth(app).createUser({ uid, email, password });
  await getAuth(app).setCustomUserClaims(uid, { ...claims, unrelated: 'preserved' });
  await adminFirestore(app, databaseId).doc(`users/${uid}`).set({ uid, email, role: 'admin' });
  return { uid, email, password };
}

async function signIn(user: { email: string; password: string }) {
  const response = await fetch(`http://${emulator('FIREBASE_AUTH_EMULATOR_HOST').address}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password: user.password, returnSecureToken: true }),
  });
  assert.equal(response.status, 200); return (await response.json()).idToken as string;
}

function client(token: string) {
  const client = initializeApp({ projectId, apiKey: 'fake', storageBucket: `${projectId}.appspot.com` }, randomUUID()); clients.push(client);
  const db = getFirestore(client, databaseId); databases.push(db);
  const fs = emulator('FIRESTORE_EMULATOR_HOST'); connectFirestoreEmulator(db, fs.host, fs.port, { mockUserToken: token });
  const storage = getStorage(client); const st = emulator('FIREBASE_STORAGE_EMULATOR_HOST');
  connectStorageEmulator(storage, st.host, st.port, { mockUserToken: token });
  return { db, storage };
}

async function denied(operation: Promise<unknown>) {
  await assert.rejects(operation, error => ['permission-denied', 'storage/unauthorized'].includes(String((error as { code?: unknown }).code)));
}
const imageName = () => `${randomUUID().replaceAll('-', '')}.png`;
const metadata = (uid: string) => ({ contentType: 'image/png', customMetadata: { uploadedBy: uid } });

test('real CLI: migration, revocation with a frozen old token, unaffected peer admin and regrant across named Firestore/default Storage registry', async () => {
  const user = await account('target'); const peer = await account('peer');
  const primary = adminFirestore(app, databaseId); const mirror = adminFirestore(app);
  const dryRun = await cli('sync-admin-access', ['--dry-run']);
  assert.equal(dryRun.code, 0, dryRun.output);
  assert.equal((await primary.doc(`_adminAccess/${user.uid}`).get()).exists, false);
  assert.equal((await mirror.doc(`_adminAccess/${user.uid}`).get()).exists, false);
  const migration = await cli('sync-admin-access', ['--apply']); assert.equal(migration.code, 0, migration.output);
  const staleToken = await signIn(user); const peerToken = await signIn(peer);
  const stale = client(staleToken); const other = client(peerToken);
  const category = doc(stale.db, 'categories', user.uid);
  await setDoc(category, { nome: 'Before revocation' });
  const existing = ref(stale.storage, `catalog/products/${user.uid}/${imageName()}`);
  await uploadBytes(existing, new Uint8Array([1, 2, 3]), metadata(user.uid));
  await listAll(ref(stale.storage, `catalog/products/${user.uid}`));
  await denied(setDoc(doc(stale.db, '_adminAccess', user.uid), { schemaVersion: 1, enabled: true, epoch: 'legacy' }));
  await denied(getDocs(collection(stale.db, '_adminAccess')));
  await denied(getDoc(doc(stale.db, '_adminAccess', peer.uid)));
  const revoke = await cli('set-admin-claim', ['--email', user.email, '--revoke']); assert.equal(revoke.code, 0, revoke.output);
  for (const db of [primary, mirror]) assert.equal((await db.doc(`_adminAccess/${user.uid}`).get()).data()?.enabled, false);
  const authUser = await getAuth(app).getUser(user.uid);
  assert.equal(authUser.customClaims?.admin, false); assert.equal(authUser.customClaims?.gbAdminEpoch, undefined);
  assert.equal(authUser.customClaims?.unrelated, 'preserved');
  assert.equal((await primary.doc(`users/${user.uid}`).get()).data()?.role, 'user');
  // Same client/token, without refresh, is denied by live server-owned authorization.
  await denied(setDoc(category, { nome: 'After revocation' }));
  await denied(deleteDoc(doc(stale.db, 'users', peer.uid)));
  await denied(listAll(ref(stale.storage, `catalog/products/${user.uid}`)));
  await denied(uploadBytes(ref(stale.storage, `catalog/products/${user.uid}/${imageName()}`), new Uint8Array([1]), metadata(user.uid)));
  await denied(deleteObject(existing));
  await getMetadata(existing); // Catalog images remain public, as before.
  await setDoc(doc(other.db, 'categories', peer.uid), { nome: 'Peer remains admin' });
  await uploadBytes(ref(other.storage, `catalog/products/${peer.uid}/${imageName()}`), new Uint8Array([1]), metadata(peer.uid));
  // Running migration again must preserve the tombstone.
  const secondSync = await cli('sync-admin-access', ['--apply']); assert.equal(secondSync.code, 0, secondSync.output);
  assert.equal((await mirror.doc(`_adminAccess/${user.uid}`).get()).data()?.enabled, false);
  const grant = await cli('set-admin-claim', ['--email', user.email]); assert.equal(grant.code, 0, grant.output);
  await denied(setDoc(category, { nome: 'Old token after regrant' }));
  await denied(deleteObject(existing));
  const fresh = client(await signIn(user));
  await setDoc(doc(fresh.db, 'categories', user.uid), { nome: 'New epoch permitted' });
  await uploadBytes(ref(fresh.storage, `catalog/products/${user.uid}/${imageName()}`), new Uint8Array([1]), metadata(user.uid));
  const again = await cli('set-admin-claim', ['--email', user.email, '--revoke']); assert.equal(again.code, 0, again.output);
  await denied(setDoc(doc(fresh.db, 'categories', user.uid), { nome: 'Also denied after second revocation' }));
});

test('missing registry in either database fails closed; legacy role alone does not bypass it', async () => {
  const user = await account('missing'); const access = { schemaVersion: 1, enabled: true, epoch: 'legacy' };
  const primary = adminFirestore(app, databaseId); const mirror = adminFirestore(app);
  const frozen = client(await signIn(user));
  const category = doc(frozen.db, 'categories', user.uid);
  await denied(setDoc(category, { nome: 'No authorization' }));
  await denied(listAll(ref(frozen.storage, `catalog/products/${user.uid}`)));
  await primary.doc(`_adminAccess/${user.uid}`).set(access);
  await setDoc(category, { nome: 'Primary authorization' });
  await denied(listAll(ref(frozen.storage, `catalog/products/${user.uid}`)));
  await primary.doc(`_adminAccess/${user.uid}`).delete(); await mirror.doc(`_adminAccess/${user.uid}`).set(access);
  await denied(setDoc(category, { nome: 'Mirror cannot grant database access' }));
  await listAll(ref(frozen.storage, `catalog/products/${user.uid}`));
});

test('UID revocation blocks a frozen token even after the account was deleted from Auth', async () => {
  const user = await account('deleted'); const access = { schemaVersion: 1, enabled: true, epoch: 'legacy' };
  await adminFirestore(app, databaseId).doc(`_adminAccess/${user.uid}`).set(access);
  await adminFirestore(app).doc(`_adminAccess/${user.uid}`).set(access);
  const frozen = client(await signIn(user));
  await setDoc(doc(frozen.db, 'categories', user.uid), { nome: 'Before account deletion' });
  await listAll(ref(frozen.storage, `catalog/products/${user.uid}`));
  await getAuth(app).deleteUser(user.uid);
  const revoke = await cli('set-admin-claim', ['--uid', user.uid, '--revoke']);
  assert.equal(revoke.code, 0, revoke.output);
  await denied(setDoc(doc(frozen.db, 'categories', user.uid), { nome: 'Deleted account cannot administer' }));
  await denied(listAll(ref(frozen.storage, `catalog/products/${user.uid}`)));
});

test('dedicated default registry template denies client access while Storage still reads server-owned authorization', async () => {
  const environment = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile('firestore-admin-access.rules', 'utf8') } });
  try {
    const user = await account('private-default'); const access = { schemaVersion: 1, enabled: true, epoch: 'legacy' };
    await adminFirestore(app).doc(`_adminAccess/${user.uid}`).set(access);
    const frozen = client(await signIn(user));
    const defaultDb = getFirestore(clients.at(-1)!, '(default)'); databases.push(defaultDb);
    const fs = emulator('FIRESTORE_EMULATOR_HOST');
    connectFirestoreEmulator(defaultDb, fs.host, fs.port, { mockUserToken: await signIn(user) });
    await denied(getDoc(doc(defaultDb, '_adminAccess', user.uid)));
    await denied(setDoc(doc(defaultDb, '_adminAccess', user.uid), access));
    await listAll(ref(frozen.storage, `catalog/products/${user.uid}`));
  } finally { await environment.cleanup(); }
});
