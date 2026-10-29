import dotenv from 'dotenv';
import { getAdminServices } from '../src/server/firebaseAdmin.js';
import { createAdminAccessBackend, planAdminAccessSync, applyAdminAccessSync } from '../src/server/adminAccess.js';
import { parseAdminAccessArguments } from '../src/server/adminAccessCli.js';

dotenv.config({ quiet: true });

async function main() {
  const options = parseAdminAccessArguments(process.argv.slice(2), true);
  if (options.help) {
    console.log('Usage: npm run admin:sync -- [--dry-run | --apply]\nDefault: read-only migration plan for existing administrators. Never overwrites a revocation.');
    return;
  }
  const { auth, db } = getAdminServices();
  const ids = new Set<string>();
  const emails = new Map<string, string>();
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      if (user.customClaims?.admin === true) ids.add(user.uid);
      emails.set(user.uid, user.email || user.uid);
    }
    pageToken = page.pageToken;
  } while (pageToken);
  const legacy = await db.collection('users').where('role', '==', 'admin').get();
  for (const user of legacy.docs) ids.add(user.id);
  const backend = createAdminAccessBackend();
  // Finish the entire read-only plan before the first write.
  const plan = [];
  for (const uid of [...ids].sort()) {
    if (!emails.has(uid)) {
      console.log(`SKIP: legacy profile ${uid} has no Auth account; it cannot be migrated.`);
      continue;
    }
    const item = await planAdminAccessSync(backend, uid);
    plan.push(item);
    console.log(`${options.dryRun ? 'PLAN' : 'PLAN/APPLY'}: ${emails.get(uid)} — ${item.action}`);
  }
  if (!options.dryRun) for (const item of plan) await applyAdminAccessSync(backend, item);
  console.log(options.dryRun
    ? `Plano concluído: ${plan.length} contas existentes; nenhuma alteração. Use --apply para executar a migração.`
    : `Migração concluída: ${plan.length} contas verificadas; recusas e épocas existentes preservadas.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Admin migration failed.');
  process.exitCode = 1;
});
