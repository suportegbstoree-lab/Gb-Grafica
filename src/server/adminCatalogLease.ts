import { adminAccessRecordAllows, type AdminAccessRecord } from '../lib/adminAccess.js';

export const ADMIN_CATALOG_LEASE_COLLECTION = '_adminCatalogLeases';
export const MAX_CATALOG_LEASE_MS = 24 * 60 * 60_000;

export function catalogLeaseAllows(value: unknown, access: AdminAccessRecord | null, claims: Record<string, unknown>, now = Date.now()): boolean {
  if (!value || typeof value !== 'object' || !access) return false;
  const lease = value as Record<string, unknown>;
  return claims.admin === true && adminAccessRecordAllows(access, claims) && lease.schemaVersion === 1 &&
    lease.enabled === true && lease.epoch === access.epoch && Number.isSafeInteger(lease.issuedAt) &&
    Number.isSafeInteger(lease.expiresAt) && (lease.issuedAt as number) <= now && (lease.expiresAt as number) > now &&
    (lease.expiresAt as number) - (lease.issuedAt as number) <= MAX_CATALOG_LEASE_MS;
}

export function parseCatalogLeaseArgs(args: string[]) {
  let email = ''; let hours = 4; let revoke = false; let dryRun = false; let help = false;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
    seen.add(flag);
    if (flag === '--email' || flag === '--hours') {
      const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      if (flag === '--email') email = value.trim().toLowerCase(); else hours = Number(value);
    } else if (flag === '--revoke') revoke = true;
    else if (flag === '--dry-run') dryRun = true;
    else if (flag === '--help' || flag === '-h') help = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!help && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !Number.isInteger(hours) || hours < 1 || hours > 24)) {
    throw new Error('Usage: npm run admin:catalog-lease -- --email EMAIL [--hours 1..24] [--revoke] [--dry-run]');
  }
  return { email, hours, revoke, dryRun, help };
}
