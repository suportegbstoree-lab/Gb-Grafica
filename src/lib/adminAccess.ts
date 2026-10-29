export const ADMIN_ACCESS_COLLECTION = '_adminAccess';
export const ADMIN_EPOCH_CLAIM = 'gbAdminEpoch';

export interface AdminAccessRecord {
  schemaVersion: 1;
  enabled: boolean;
  epoch: string;
  updatedAt: string;
}

export function validAdminAccessRecord(value: unknown): value is AdminAccessRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && typeof record.enabled === 'boolean'
    && typeof record.epoch === 'string' && (record.epoch === 'legacy' || /^[a-f0-9]{32}$/.test(record.epoch));
}

/** A role/claim alone is never sufficient: server-owned authorization must agree. */
export function adminAccessRecordAllows(value: unknown, claims: Record<string, unknown>): boolean {
  if (!validAdminAccessRecord(value) || !value.enabled) return false;
  if (value.epoch === 'legacy') return claims[ADMIN_EPOCH_CLAIM] === undefined;
  return claims.admin === true && claims[ADMIN_EPOCH_CLAIM] === value.epoch;
}
