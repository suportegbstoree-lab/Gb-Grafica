import { prepareWorkActivity } from './workTracking.js';
import type { Firestore } from 'firebase-admin/firestore';
import { staffRoleName, validStaffAccess } from '../lib/staffAccess.js';
export async function activityActor(db: Firestore, user: { uid: string; name?: unknown; email?: unknown; admin?: unknown }) {
  const [profile, access] = await Promise.all([db.collection('_staffProfiles').doc(user.uid).get(), db.collection('_staffAccess').doc(user.uid).get()]);
  const record = access.data();
  const policy = validStaffAccess(record) ? (await db.collection('_staffRoles').doc(record.roleId).get()).data() : undefined;
  return { actor: user.uid, actorName: String(profile.data()?.name || user.name || user.email || user.uid).slice(0, 120),
    actorRole: user.admin === true ? 'Administrador' : validStaffAccess(record) ? staffRoleName(record.roleId, policy) : 'Equipe' };
}
export async function recordStaffActivity(db: Firestore, user: { uid: string; name?: unknown; email?: unknown; admin?: unknown }, action: string, entityId: string) {
  const actor = await activityActor(db, user);
  await db.runTransaction(async tx=>{const activity=await prepareWorkActivity(db,actor,action,entityId,tx);activity.write(tx);});
}
