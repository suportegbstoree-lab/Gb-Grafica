import dotenv from 'dotenv';
import { getAdminServices } from '../src/server/firebaseAdmin.js';
import { createAdminAccessBackend, grantAdminAccess, revokeAdminAccess } from '../src/server/adminAccess.js';
import { parseAdminAccessArguments } from '../src/server/adminAccessCli.js';

dotenv.config({ quiet: true });

async function main() {
  const options = parseAdminAccessArguments(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: npm run admin:set -- --email EMAIL [--revoke] [--dry-run]\n       npm run admin:set -- --uid UID --revoke [--dry-run]\nDefault: grant admin access. --revoke closes authorization in both databases, removes both roles and revokes refresh tokens. Use --uid when the Auth account has already been deleted.');
    return;
  }
  const { auth } = getAdminServices();
  const uid = options.uid || (await auth.getUserByEmail(options.email)).uid;
  const target = options.email || options.uid;
  const backend = createAdminAccessBackend();
  if (options.dryRun) {
    console.log(`DRY RUN: ${options.revoke ? 'revoke' : 'grant'} admin access for ${target}; databases: ${backend.stores.map(store => store.name).join(', ')}. No changes made.`);
    return;
  }
  if (options.revoke) await revokeAdminAccess(backend, uid);
  else await grantAdminAccess(backend, uid);
  console.log(options.revoke
    ? `Acesso administrativo revogado de ${target}; registros bloqueados e papéis/sessões removidos quando a conta existe.`
    : `Permissão administrativa aplicada a ${target}. Saia e entre novamente para obter o token atualizado.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
