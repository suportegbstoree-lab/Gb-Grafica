import { randomBytes } from 'node:crypto';
import { STAFF_ACCESS_COLLECTION, STAFF_EPOCH_CLAIM, STAFF_ROLE_CLAIM, isStaffRoleId } from '../lib/staffAccess.js';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAdminServices } from './firebaseAdmin.js';
import { ADMIN_ACCESS_COLLECTION, ADMIN_EPOCH_CLAIM, validAdminAccessRecord, type AdminAccessRecord } from '../lib/adminAccess.js';

export interface AdminAccount {
  uid: string; email?: string; disabled: boolean; customClaims?: Record<string, unknown>;
}
export interface AdminAccessStore {
  name: string;
  read(uid: string): Promise<AdminAccessRecord | null>;
  // undefined = unconditional revocation; null = create only; string = compare epoch.
  write(uid: string, record: AdminAccessRecord, expected?: string | null): Promise<void>;
}
export interface AdminAccessBackend {
  closeStaffAccess?(uid: string): Promise<void>;
  stores: AdminAccessStore[];
  getAccount(uid: string): Promise<AdminAccount>;
  getProfileRole(uid: string): Promise<unknown>;
  setClaims(uid: string, claims: Record<string, unknown>): Promise<void>;
  revokeSessions(uid: string): Promise<void>;
  setProfile(uid: string, email: string, role: 'admin' | 'user'): Promise<void>;
}

export function firestoreAdminAccessStore(db: Firestore): AdminAccessStore {
  return {
    name: db.databaseId,
    async read(uid) {
      const snapshot = await db.collection(ADMIN_ACCESS_COLLECTION).doc(uid).get();
      if (!snapshot.exists) return null;
      const record = snapshot.data();
      if (!validAdminAccessRecord(record)) throw new Error('Invalid admin access record; use --revoke to reset it.');
      return record;
    },
    async write(uid, record, expected) {
      const ref = db.collection(ADMIN_ACCESS_COLLECTION).doc(uid);
      if (expected === undefined) { await ref.set(record); return; }
      await db.runTransaction(async transaction => {
        const current = await transaction.get(ref);
        if (expected === null ? current.exists : !current.exists || current.data()?.epoch !== expected) {
          throw new Error('Concurrent admin access change; authorization was not activated.');
        }
        transaction.set(ref, record);
      });
    },
  };
}

export function createAdminAccessBackend(): AdminAccessBackend {
  const { app, db, auth } = getAdminServices();
  const stores = [firestoreAdminAccessStore(db)];
  if (db.databaseId !== '(default)') stores.push(firestoreAdminAccessStore(getFirestore(app)));
  return {
    stores,
    async closeStaffAccess(uid) {
      const failures: string[] = [];
      for (const target of db.databaseId === '(default)' ? [db] : [db, getFirestore(app)]) {
        try {
          const ref = target.collection(STAFF_ACCESS_COLLECTION).doc(uid);
          const current = (await ref.get()).data();
          await ref.set({ schemaVersion: 1, enabled: false, epoch: randomBytes(16).toString('hex'),
            roleId: isStaffRoleId(current?.roleId) ? current.roleId : 'designer', updatedAt: new Date().toISOString(), updatedBy: 'admin-access' });
        } catch { failures.push(target.databaseId); }
      }
      if (failures.length) throw new Error(`Staff revocation incomplete (${failures.join(', ')}). Retry and verify both databases.`);
    },
    getAccount: uid => auth.getUser(uid),
    getProfileRole: async uid => (await db.collection('users').doc(uid).get()).data()?.role,
    setClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
    revokeSessions: uid => auth.revokeRefreshTokens(uid),
    async setProfile(uid, email, role) {
      const ref = db.collection('users').doc(uid);
      if (!email && !(await ref.get()).exists) return;
      await ref.set({ uid, ...(email ? { email } : {}), role }, { merge: true });
    },
  };
}

function record(enabled: boolean, epoch = randomBytes(16).toString('hex')): AdminAccessRecord {
  return { schemaVersion: 1, enabled, epoch, updatedAt: new Date().toISOString() };
}

const accountMissing = (error: unknown) => (error as { code?: unknown })?.code === 'auth/user-not-found';

/** Every failed grant leaves its own epoch closed and cannot reopen a newer revocation. */
export async function grantAdminAccess(backend: AdminAccessBackend, uid: string): Promise<void> {
  const account = await backend.getAccount(uid);
  if (account.disabled || !account.email) throw new Error('Cannot grant admin access to a disabled account or an account without email.');
  await backend.closeStaffAccess?.(uid);
  const previous: Array<AdminAccessRecord | null> = [];
  for (const store of backend.stores) previous.push(await store.read(uid));
  const closed = record(false);
  try {
    for (const [index, store] of backend.stores.entries()) await store.write(uid, closed, previous[index]?.epoch ?? null);
    const current = await backend.getAccount(uid);
    if (current.disabled) throw new Error('Account disabled during authorization.');
    await backend.setProfile(uid, account.email, 'admin');
    const claims = { ...current.customClaims, admin: true, [ADMIN_EPOCH_CLAIM]: closed.epoch };
    delete claims[STAFF_EPOCH_CLAIM]; delete claims[STAFF_ROLE_CLAIM];
    await backend.setClaims(uid, claims);
    // Primary database first: a concurrent revocation stops activation of Storage.
    for (const store of backend.stores) await store.write(uid, { ...closed, enabled: true }, closed.epoch);
  } catch (error) {
    const cleanupFailures: string[] = [];
    for (const store of backend.stores) {
      try { await store.write(uid, closed, closed.epoch); }
      catch { cleanupFailures.push(store.name); }
    }
    const suffix = cleanupFailures.length ? ' Some records changed or could not be closed; run --revoke and verify both databases.' : '';
    throw new Error(`Admin grant did not complete.${suffix}`, { cause: error });
  }
}

/** Attempt every revocation step even when one service fails; never report partial success. */
export async function revokeAdminAccess(backend: AdminAccessBackend, uid: string): Promise<void> {
  const closed = record(false);
  const failures: string[] = [];
  try { await backend.closeStaffAccess?.(uid); } catch { failures.push('staff-registry'); }
  for (const store of backend.stores) {
    try { await store.write(uid, closed); } catch { failures.push(`registry:${store.name}`); }
  }
  try { await backend.setProfile(uid, '', 'user'); } catch { failures.push('profile'); }
  try {
    const current = await backend.getAccount(uid);
    const claims = { ...current.customClaims, admin: false };
    delete claims[ADMIN_EPOCH_CLAIM];
    delete claims[STAFF_EPOCH_CLAIM]; delete claims[STAFF_ROLE_CLAIM];
    await backend.setClaims(uid, claims);
  } catch (error) { if (!accountMissing(error)) failures.push('claims'); }
  try { await backend.revokeSessions(uid); } catch (error) { if (!accountMissing(error)) failures.push('sessions'); }
  if (failures.length) throw new Error(`Admin revocation incomplete (${failures.join(', ')}). Retry --revoke; do not assume access is closed.`);
}

export interface AdminSyncItem { uid: string; action: 'create' | 'repair' | 'unchanged' | 'blocked'; record: AdminAccessRecord; }

/** Migration only: never overwrites a denial, rotates an epoch or adds a new administrator. */
export async function planAdminAccessSync(backend: AdminAccessBackend, uid: string): Promise<AdminSyncItem> {
  const account = await backend.getAccount(uid);
  const records: Array<AdminAccessRecord | null> = [];
  for (const store of backend.stores) records.push(await store.read(uid));
  const present = records.filter((value): value is AdminAccessRecord => value !== null);
  const existing = present[0];
  if (present.some(value => value.enabled !== existing.enabled || value.epoch !== existing.epoch)) {
    throw new Error('Admin authorization databases disagree; use --revoke before granting again.');
  }
  const eligible = !account.disabled && (account.customClaims?.admin === true || await backend.getProfileRole(uid) === 'admin');
  if (!eligible || (existing && !existing.enabled)) return { uid, action: 'blocked', record: existing ? { ...existing, enabled: false } : record(false) };
  if (existing && existing.epoch !== 'legacy' && account.customClaims?.[ADMIN_EPOCH_CLAIM] !== existing.epoch) {
    throw new Error('Admin authorization epoch does not match Auth; use --revoke before granting again.');
  }
  if (!existing && account.customClaims?.[ADMIN_EPOCH_CLAIM] !== undefined) {
    throw new Error('Versioned admin authorization is missing; use --revoke before granting again.');
  }
  return { uid, action: present.length === backend.stores.length ? 'unchanged' : existing ? 'repair' : 'create', record: existing || record(true, 'legacy') };
}

export async function applyAdminAccessSync(backend: AdminAccessBackend, item: AdminSyncItem): Promise<void> {
  // Replan immediately so a stale --dry-run cannot resurrect a revocation.
  const current = await planAdminAccessSync(backend, item.uid);
  if (current.action === 'blocked') {
    for (const store of backend.stores) {
      const value = await store.read(item.uid);
      if (value === null) await store.write(item.uid, current.record, null);
      else if (value.enabled) await store.write(item.uid, current.record, value.epoch);
    }
    return;
  }
  if (current.action === 'unchanged') return;
  if (current.record.epoch !== item.record.epoch) throw new Error('Authorization changed after the migration plan.');
  for (const store of backend.stores) {
    const value = await store.read(item.uid);
    if (value === null) await store.write(item.uid, current.record, null);
    else if (!value.enabled || value.epoch !== current.record.epoch) throw new Error('Authorization changed during migration; do not enable access.');
  }
}
