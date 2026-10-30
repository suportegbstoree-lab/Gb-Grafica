import dotenv from 'dotenv';
import { getAdminServices } from '../src/server/firebaseAdmin.js';
import { adminAccessRecordAllows, type AdminAccessRecord } from '../src/lib/adminAccess.js';
import { ADMIN_CATALOG_LEASE_COLLECTION, parseCatalogLeaseArgs } from '../src/server/adminCatalogLease.js';

dotenv.config({ quiet: true });
async function main() {
  const options = parseCatalogLeaseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: npm run admin:catalog-lease -- --email EMAIL [--hours 1..24] [--revoke] [--dry-run]\nDefault: 4 hours. Requires an existing active administrator. No IAM role or admin claim is granted.');
    return;
  }
  const { auth, db } = getAdminServices();
  const account = await auth.getUserByEmail(options.email);
  const access = (await db.collection('_adminAccess').doc(account.uid).get()).data() as AdminAccessRecord | undefined;
  if (!options.revoke && (account.disabled || account.customClaims?.admin !== true || !adminAccessRecordAllows(access, account.customClaims || {}))) {
    throw new Error('Only an existing active administrator can receive a catalog lease.');
  }
  const now = Date.now();
  if (!options.dryRun) await db.collection(ADMIN_CATALOG_LEASE_COLLECTION).doc(account.uid).set({
    schemaVersion: 1, enabled: !options.revoke, epoch: access?.epoch || '', issuedAt: now,
    expiresAt: options.revoke ? now : now + options.hours * 60 * 60_000,
    cleanupAt: new Date(now + (options.hours + 24) * 60 * 60_000),
  });
  console.log(options.dryRun ? 'DRY RUN: nenhuma alteração.' : options.revoke
    ? 'Exceção de arquivos administrativos revogada.'
    : `Exceção de arquivos administrativos ativa até ${new Date(now + options.hours * 60 * 60_000).toISOString()}. A autorização administrativa continua obrigatória.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Catalog lease failed.'); process.exitCode = 1; });
