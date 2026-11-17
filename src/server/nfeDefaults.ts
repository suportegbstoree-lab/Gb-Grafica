import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { EMPTY_NFE_DEFAULTS, EMPTY_NFE_ISSUER, fiscalRecord, parseNfeDefaults, parseNfeIssuer, type NfeDefaultsConfig } from '../lib/nfe.js';
import { NfeDraftError } from './nfeDraftError.js';

export const nfeDefaultsRef = (db: Firestore) => db.collection('_fiscalSettings').doc('nfe');

export function readNfeSettings(saved?: Record<string, unknown>): NfeDefaultsConfig & { issuerRevision: string | null } {
  const defaults = parseNfeDefaults(saved?.defaults) ?? EMPTY_NFE_DEFAULTS;
  const issuer = parseNfeIssuer(saved?.issuer) ?? {
    ...EMPTY_NFE_ISSUER, address: { ...EMPTY_NFE_ISSUER.address, estado: defaults.issuerState },
  };
  return {
    defaults: { ...defaults, issuerState: issuer.address.estado }, issuer,
    revision: typeof saved?.revision === 'string' ? saved.revision : null,
    issuerRevision: typeof saved?.issuerRevision === 'string' ? saved.issuerRevision : null,
  };
}

export async function manageNfeDefaults(db: Firestore, actor: string, change?: unknown): Promise<NfeDefaultsConfig> {
  const ref = nfeDefaultsRef(db);
  if (change === undefined) {
    const { defaults, issuer, revision } = readNfeSettings((await ref.get()).data());
    return { defaults, issuer, revision };
  }
  const input = fiscalRecord(change);
  const defaults = parseNfeDefaults(input?.defaults);
  if (!input || !defaults) throw new NfeDraftError(422, 'Revise os padrões fiscais da venda.');
  const newIssuer = input.issuer === undefined ? undefined : parseNfeIssuer(input.issuer);
  if (newIssuer === null) throw new NfeDraftError(422, 'Revise o CNPJ, a inscrição estadual, o regime e o endereço fiscal do emitente.');
  return db.runTransaction(async tx => {
    const saved = (await tx.get(ref)).data();
    const previous = readNfeSettings(saved);
    if (previous.revision !== input.revision) throw new NfeDraftError(409, 'A configuração mudou. Reabra a tela antes de salvar.');
    // Clientes do painel anteriores ao cadastro só enviam os padrões. Preserve o emitente já gravado.
    const issuer = newIssuer ?? (saved?.issuer ? previous.issuer : {
      ...previous.issuer, address: { ...previous.issuer.address, estado: defaults.issuerState },
    });
    const revision = randomUUID();
    const issuerRevision = previous.issuerRevision && JSON.stringify(issuer) === JSON.stringify(previous.issuer)
      ? previous.issuerRevision : revision;
    const config = { defaults: { ...defaults, issuerState: issuer.address.estado }, issuer, revision };
    tx.set(ref, {
      defaults: config.defaults, ...(newIssuer || saved?.issuer ? { issuer } : {}),
      revision, issuerRevision, updatedAt: new Date().toISOString(), updatedBy: actor,
    });
    return config;
  });
}
