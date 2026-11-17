import { randomBytes } from 'node:crypto';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { adminAccessRecordAllows, ADMIN_ACCESS_COLLECTION } from '../lib/adminAccess.js';
import { getAdminServices } from './firebaseAdmin.js';
import { createAdminAccessBackend, revokeAdminAccess } from './adminAccess.js';
import {
  STAFF_ACCESS_COLLECTION, STAFF_ROLES_COLLECTION, STAFF_EPOCH_CLAIM, STAFF_ROLE_CLAIM,
  isStaffRoleId, staffRoleName, DEFAULT_ROLE_PERMISSIONS, validStaffAccess, validStaffRole, staffPermissions, parseStaffPermissions,
  type StaffAccessRecord, type StaffRoleRecord, type StaffRoleId, type StaffPermission,
} from '../lib/staffAccess.js';

export class StaffAccessError extends Error { constructor(public status: number, message: string) { super(message); } }
const epoch = () => randomBytes(16).toString('hex');
type Account = { uid: string; email?: string; disabled: boolean; customClaims?: Record<string, unknown> };
export interface StaffStore {
  name: string;
  readAccess(uid: string): Promise<StaffAccessRecord | null>;
  writeAccess(uid: string, value: StaffAccessRecord, expected?: string | null): Promise<void>;
  closeRoleMembers(roleId: StaffRoleId, actor: string): Promise<void>;
  readRole(roleId: StaffRoleId): Promise<StaffRoleRecord | null>;
  writeRole(roleId: StaffRoleId, value: StaffRoleRecord, expected?: string | null): Promise<void>;
}
export interface StaffBackend {
  stores: StaffStore[];
  getAccount(uid: string): Promise<Account>;
  setClaims(uid: string, claims: Record<string, unknown>): Promise<void>;
  removeAdmin(uid: string): Promise<void>;
  isAdmin(uid: string): Promise<boolean>;
}
function store(db: Firestore): StaffStore {
  const read = async <T>(collection: string, id: string, validate: (value: unknown) => value is T): Promise<T | null> => {
    const snapshot = await db.collection(collection).doc(id).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    if (!validate(data)) throw new StaffAccessError(409, 'Registro de acesso inconsistente. Confira a configuração no servidor.');
    return data;
  };
  const write = async (collection: string, id: string, value: StaffAccessRecord | StaffRoleRecord, field: string, expected?: string | null) => {
    const ref = db.collection(collection).doc(id);
    if (expected === undefined) { await ref.set(value); return; }
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (expected === null ? snapshot.exists : !snapshot.exists || snapshot.data()?.[field] !== expected) {
        throw new StaffAccessError(409, 'O acesso foi alterado em outra operação. Atualize o painel e confira o resultado.');
      }
      transaction.set(ref, value);
    });
  };
  return { name: db.databaseId,
    readAccess: uid => read(STAFF_ACCESS_COLLECTION, uid, validStaffAccess),
    writeAccess: (uid, value, expected) => write(STAFF_ACCESS_COLLECTION, uid, value, 'epoch', expected),
    async closeRoleMembers(roleId, actor) {
      const query = db.collection(STAFF_ACCESS_COLLECTION).where('roleId', '==', roleId).where('enabled', '==', true);
      for (;;) {
        const page = await query.limit(200).get();
        if (!page.size) return;
        await Promise.all(page.docs.map(doc => db.runTransaction(async tx => {
          const current = (await tx.get(doc.ref)).data();
          if (!current || !current.enabled || current.roleId !== roleId) return;
          if (!validStaffAccess(current)) throw new StaffAccessError(409, 'Registro de acesso inconsistente.');
          tx.set(doc.ref, { ...current, enabled: false, epoch: epoch(), updatedAt: new Date().toISOString(), updatedBy: actor });
        })));
      }
    },
    readRole: id => read(STAFF_ROLES_COLLECTION, id, validStaffRole),
    writeRole: (id, value, expected) => write(STAFF_ROLES_COLLECTION, id, value, 'revision', expected),
  };
}
export function createStaffBackend(): StaffBackend {
  const { app, db, auth } = getAdminServices();
  return {
    stores: db.databaseId === '(default)' ? [store(db)] : [store(db), store(getFirestore(app))],
    getAccount: uid => auth.getUser(uid), setClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
    removeAdmin: uid => revokeAdminAccess(createAdminAccessBackend(), uid),
    isAdmin: async uid => {
      const [account, authorization] = await Promise.all([
        auth.getUser(uid), db.collection(ADMIN_ACCESS_COLLECTION).doc(uid).get(),
      ]);
      const data = authorization.data();
      const legacyRole = data?.epoch === 'legacy' && (await db.collection('users').doc(uid).get()).data()?.role;
      return staffAccountIsAdministrator(account, data, legacyRole);
    },
  };
}

export function staffAccountIsAdministrator(account: Account, authorization: unknown, legacyRole?: unknown) {
  const claims = account.customClaims ?? {};
  return adminAccessRecordAllows(authorization, claims)
    && (claims.admin === true || legacyRole === 'admin');
}

export async function removeStaffMember(backend: StaffBackend, uid: string, actor: string) {
  if (uid === actor || await backend.isAdmin(uid)) throw new StaffAccessError(403, 'Administradores são protegidos.');
  const before = await Promise.all(backend.stores.map(target => target.readAccess(uid)));
  if (!before.some(Boolean)) throw new StaffAccessError(404, 'Funcionário não encontrado.');
  // Revoke the panel grant and staff claims, preserving the customer account.
  await backend.removeAdmin(uid);
  const results = await Promise.allSettled(backend.stores.map(async (target) => {
    const current = await target.readAccess(uid);
    if (current?.removed) return;
    if (!current || current.enabled) throw new StaffAccessError(409, 'O acesso mudou. Atualize a lista.');
    await target.writeAccess(uid, { ...current, removed: true, updatedAt: new Date().toISOString(), updatedBy: actor }, current.epoch);
  }));
  if (results.some(result => result.status === 'rejected'))
    throw new StaffAccessError(503, 'A exclusão do funcionário está pendente. Tente novamente.');
}

/** Both databases start closed; CAS prevents a failed operation reopening newer changes. */
export async function updateStaffRole(backend: StaffBackend, roleId: StaffRoleId, input: unknown, expectedRevision: string | null, actor: string, name?: unknown): Promise<StaffRoleRecord> {
  if (!isStaffRoleId(roleId)) throw new StaffAccessError(422, 'A função de administrador é protegida.');
  const permissions = parseStaffPermissions(input);
  if (!permissions) throw new StaffAccessError(422, 'Permissões inválidas. Confira os acessos de consulta de pedidos e etiquetas exigidos pelas ações selecionadas.');
  const previous: Array<StaffRoleRecord | null> = [];
  for (const target of backend.stores) previous.push(await target.readRole(roleId));
  if ((previous[0]?.revision ?? null) !== expectedRevision) throw new StaffAccessError(409, 'Esta função mudou. Atualize a lista antes de salvar.');
  if (previous.some(value => value?.deleted || value?.deletionPending)) throw new StaffAccessError(409, 'Este cargo foi excluído ou está em exclusão. Crie um novo cargo para conceder outras permissões.');
  const label = name === undefined ? staffRoleName(roleId, previous[0] || undefined) : typeof name === 'string' ? name.trim() : '';
  if (['admin', 'administrator', 'administrador'].includes(label.toLowerCase()) || !label || label.length > 80 || /[\x00-\x1f\x7f]/.test(label)) throw new StaffAccessError(422, 'Informe um nome de cargo com até 80 caracteres.');
  const closed: StaffRoleRecord = { name: label, schemaVersion: 1, enabled: false, revision: epoch(), permissions, updatedAt: new Date().toISOString(), updatedBy: actor };
  try {
    for (const [i, target] of backend.stores.entries()) await target.writeRole(roleId, closed, previous[i]?.revision ?? null);
    for (const target of backend.stores) await target.writeRole(roleId, { ...closed, enabled: true }, closed.revision);
    return { ...closed, enabled: true };
  } catch (error) {
    for (const target of backend.stores) await target.writeRole(roleId, closed, closed.revision).catch(() => undefined);
    throw error;
  }
}

/** Retain a disabled policy so neither default roles nor old sessions can resurrect it. */
export async function deleteStaffRole(backend: StaffBackend, roleId: StaffRoleId, expectedRevision: string | null, actor: string): Promise<void> {
  if (!isStaffRoleId(roleId)) throw new StaffAccessError(422, 'A função de administrador é protegida.');
  const previous = await Promise.all(backend.stores.map(target => target.readRole(roleId)));
  if ((previous[0]?.revision ?? null) !== expectedRevision) throw new StaffAccessError(409, 'Este cargo mudou. Atualize a lista antes de excluir.');
  if (!previous[0] && !Object.hasOwn(DEFAULT_ROLE_PERMISSIONS, roleId)) throw new StaffAccessError(404, 'Cargo não encontrado.');
  if (previous.every(value => value?.deleted)) return;
  const now = new Date().toISOString();
  const closed: StaffRoleRecord = { schemaVersion: 1, name: staffRoleName(roleId, previous[0] || undefined), enabled: false,
    permissions: [], revision: epoch(), updatedAt: now, updatedBy: actor, deletionPending: true };
  // Attempt every mirror even if one write fails; never restore an open policy.
  let failed = false;
  for (const [index, target] of backend.stores.entries()) {
    try { await target.writeRole(roleId, closed, previous[index]?.revision ?? null); }
    catch { failed = true; }
  }
  if (failed) throw new StaffAccessError(503, 'A exclusão não foi concluída em todos os serviços. Atualize a lista e tente novamente.');
  const deleted: StaffRoleRecord = { ...closed, deletionPending: false, deleted: true, deletedAt: now };
  try {
    for (const target of backend.stores) await target.closeRoleMembers(roleId, actor);
    // Hide the primary entry only after all Storage mirrors have been finalized.
    for (const target of [...backend.stores.slice(1), backend.stores[0]]) await target.writeRole(roleId, deleted, closed.revision);
  } catch { throw new StaffAccessError(503, 'A exclusão está pendente. Atualize a lista e tente novamente para concluí-la.'); }
}

export async function assignStaffRole(backend: StaffBackend, uid: string, roleId: StaffRoleId, actor: string): Promise<{ changed: boolean; record: StaffAccessRecord }> {
  if (await backend.isAdmin(uid)) throw new StaffAccessError(403, 'Administradores não podem ter sua função alterada pelo painel.');
  let account = await backend.getAccount(uid);
  if (account.disabled || !account.email) throw new StaffAccessError(422, 'A conta precisa estar ativa e possuir e-mail.');
  let role = await backend.stores[0].readRole(roleId);
  if (!role) { if (!Object.hasOwn(DEFAULT_ROLE_PERMISSIONS, roleId)) throw new StaffAccessError(422, 'Cadastre o cargo e suas permissões antes de atribuí-lo.'); role = await updateStaffRole(backend, roleId, DEFAULT_ROLE_PERMISSIONS[roleId], null, actor); }
  if (role.deleted || role.deletionPending) throw new StaffAccessError(409, 'Este cargo foi excluído ou está em exclusão. Selecione outro cargo.');
  if (!role.enabled) throw new StaffAccessError(409, 'A função está bloqueada. Salve suas permissões novamente antes de atribuí-la.');
  const mirrors = await Promise.all(backend.stores.map(target => target.readRole(roleId)));
  if (mirrors.some(value => !value?.enabled || value.deleted || value.deletionPending || value.revision !== role!.revision)) throw new StaffAccessError(409, 'As permissões da função não estão sincronizadas nos bancos. Salve-as novamente.');
  const wasAdmin = await backend.isAdmin(uid);
  const previous: Array<StaffAccessRecord | null> = [];
  for (const target of backend.stores) previous.push(await target.readAccess(uid));
  if (!wasAdmin && previous[0]?.enabled && previous.every(value => value?.enabled && value.roleId === roleId && value.epoch === previous[0]!.epoch) &&
      account.customClaims?.[STAFF_EPOCH_CLAIM] === previous[0].epoch && account.customClaims?.[STAFF_ROLE_CLAIM] === roleId) return { changed: false, record: previous[0] };
  await backend.removeAdmin(uid);
  for (const [i, target] of backend.stores.entries()) previous[i] = await target.readAccess(uid);
  const closed: StaffAccessRecord = { schemaVersion: 1, enabled: false, epoch: epoch(), roleId, updatedAt: new Date().toISOString(), updatedBy: actor };
  try {
    for (const [i, target] of backend.stores.entries()) await target.writeAccess(uid, closed, previous[i]?.epoch ?? null);
    const current = await backend.getAccount(uid);
    if (current.disabled) throw new StaffAccessError(422, 'Conta desativada durante a alteração.');
    await backend.setClaims(uid, { ...current.customClaims, admin: false, [STAFF_ROLE_CLAIM]: roleId, [STAFF_EPOCH_CLAIM]: closed.epoch });
    for (const target of backend.stores) await target.writeAccess(uid, { ...closed, enabled: true }, closed.epoch);
    return { changed: true, record: { ...closed, enabled: true } };
  } catch (error) {
    for (const target of backend.stores) await target.writeAccess(uid, closed, closed.epoch).catch(() => undefined);
    throw error;
  }
}

export async function userStaffPermissions(claims: Record<string, unknown> & { uid: string }): Promise<StaffPermission[]> {
  if (typeof claims[STAFF_EPOCH_CLAIM] !== 'string') return [];
  const { db, auth } = getAdminServices();
  const access = (await db.collection(STAFF_ACCESS_COLLECTION).doc(claims.uid).get()).data();
  if (!validStaffAccess(access)) return [];
  const policy = (await db.collection(STAFF_ROLES_COLLECTION).doc(access.roleId).get()).data();
  const result = staffPermissions(access, policy, claims);
  if (!result.length) return [];
  const account = await auth.getUser(claims.uid);
  return !account.disabled && staffPermissions(access, policy, account.customClaims || {}).length ? result : [];
}
