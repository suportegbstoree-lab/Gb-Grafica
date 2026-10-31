import { FieldValue, type Firestore } from 'firebase-admin/firestore';

/** Single-field range query: no composite index, no stale writes over a renewed deadline. */
export async function expirePromotions(db: Firestore, now = Date.now()): Promise<number> {
  const candidates = await db.collection('promocoes').where('endsAt', '<=', now).orderBy('endsAt').limit(25).get();
  let expired = 0;
  await Promise.all(candidates.docs.map(async snapshot => {
    // Remove the indexed deadline after expiry to avoid old documents starving later batches.
    const applied = await db.runTransaction(async transaction => {
      const data = (await transaction.get(snapshot.ref)).data();
      if (data && typeof data.endsAt === 'number' && data.endsAt <= now) {
        transaction.update(snapshot.ref, { ativa: false, expiredAt: data.endsAt, startsAt: FieldValue.delete(), endsAt: FieldValue.delete(), relampago: false }); return true;
      }
      return false;
    });
    if (applied) expired++;
  }));
  return expired;
}
