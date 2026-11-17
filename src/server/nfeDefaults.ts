import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { EMPTY_NFE_DEFAULTS, fiscalRecord, parseNfeDefaults, type NfeDefaultsConfig } from '../lib/nfe.js';
import { NfeDraftError } from './nfeDraftError.js';

export const nfeDefaultsRef = (db: Firestore) => db.collection('_fiscalSettings').doc('nfe');

export async function manageNfeDefaults(db: Firestore, actor: string, change?: unknown): Promise<NfeDefaultsConfig> {
  const ref = nfeDefaultsRef(db);
  if (change === undefined) {
    const saved = (await ref.get()).data();
    return { defaults: parseNfeDefaults(saved?.defaults) ?? EMPTY_NFE_DEFAULTS, revision: saved?.revision ?? null };
  }
  const input = fiscalRecord(change);
  const defaults = parseNfeDefaults(input?.defaults);
  if (!input || !defaults) throw new NfeDraftError(422, 'Revise a UF, a natureza da operação e os códigos fiscais.');
  return db.runTransaction(async tx => {
    const saved = (await tx.get(ref)).data();
    if ((saved?.revision ?? null) !== input.revision) throw new NfeDraftError(409, 'A configuração mudou. Reabra a tela antes de salvar.');
    const revision = randomUUID();
    tx.set(ref, { defaults, revision, updatedAt: new Date().toISOString(), updatedBy: actor });
    return { defaults, revision };
  });
}
