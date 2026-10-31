import dotenv from 'dotenv';
import { getAdminServices } from '../src/server/firebaseAdmin.js';
import { createAdminAccessBackend } from '../src/server/adminAccess.js';
import { createStaffBackend } from '../src/server/staffAccess.js';
import { adminAccessRecordAllows } from '../src/lib/adminAccess.js';
import { ALL_STAFF_PERMISSIONS, STAFF_ROLE_LABELS, isStaffRoleId, staffPermissions } from '../src/lib/staffAccess.js';
import { mayEnterPanel, allowedPanelSections } from '../src/lib/panelAccess.js';
import { parseStaffCheckArguments } from '../src/server/staffAccessCli.js';
import clientConfig from '../firebase-applet-config.json' with { type: 'json' };

dotenv.config({ quiet: true });
async function main() {
  const options = parseStaffCheckArguments(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: npm run security:staff-check -- --email <registered-email>\nRead-only check of Auth claims, primary/default registries and role permissions. Does not inspect browser tokens or deployed security rules. No grants, updates, emails or payments.');
    return;
  }
  const { auth, app, db } = getAdminServices();
  const projectMatches = app.options.projectId === clientConfig.projectId;
  const databaseMatches = db.databaseId === clientConfig.firestoreDatabaseId;
  if (!projectMatches || !databaseMatches) {
    console.table({ projetoCompativel: projectMatches, bancoCompativel: databaseMatches });
    console.error('O projeto ou banco do servidor difere do app web. Confira a configuração antes de consultar a conta.');
    process.exitCode = 1; return;
  }
  const account = await auth.getUserByEmail(options.email);
  const claims = account.customClaims || {};
  const profileRole = (await db.collection('users').doc(account.uid).get()).data()?.role;
  const adminStores = createAdminAccessBackend().stores;
  const reports = await Promise.all(createStaffBackend().stores.map(async store => {
    const root = await adminStores.find(value => value.name === store.name)!.read(account.uid);
    const access = await store.readAccess(account.uid);
    const roleId = access?.roleId || (isStaffRoleId(claims.staffRole) ? claims.staffRole : null);
    const policy = roleId ? await store.readRole(roleId) : null;
    const administrator = !account.disabled && adminAccessRecordAllows(root, claims) && (claims.admin === true || profileRole === 'admin');
    const permissions = account.disabled ? [] : administrator ? ALL_STAFF_PERMISSIONS : staffPermissions(access, policy, claims);
    return { name: store.name, access, policy, administrator, permissions,
      entry: mayEnterPanel(administrator, permissions),
      rootStorage: !account.disabled && claims.admin === true && adminAccessRecordAllows(root, claims) };
  }));
  const primary = reports[0];
  console.log(`Conta: ${account.email || options.email}`);
  console.table({ projetoCompativel: projectMatches, bancoCompativel: databaseMatches, contaAtiva: !account.disabled,
    claimAdmin: claims.admin === true, funcaoFuncionario: isStaffRoleId(claims.staffRole) ? STAFF_ROLE_LABELS[claims.staffRole] : 'Nenhuma', acessoAoPainel: primary.entry });
  console.table(reports.map(report => ({ banco: report.name, administrador: report.administrator,
    registroFuncionarioAtivo: report.access?.enabled === true,
    epocaFuncionarioCompativel: Boolean(report.access?.enabled && report.access.epoch === claims.gbStaffEpoch && report.access.roleId === claims.staffRole),
    politicaAtiva: report.policy?.enabled === true, permissoesEfetivas: report.permissions.length })));
  console.log(`Seções liberadas: ${allowedPanelSections(primary.administrator, primary.permissions).join(', ') || 'nenhuma'}.`);
  console.log(`Permissões efetivas: ${primary.permissions.join(', ') || 'nenhuma'}.`);
  const mirrored = reports.every(report => primary.administrator ? report.rootStorage : report.entry && report.access?.epoch === primary.access?.epoch &&
    report.access?.roleId === primary.access?.roleId && report.policy?.revision === primary.policy?.revision && JSON.stringify(report.permissions) === JSON.stringify(primary.permissions));
  console.log(`Espelhos compatíveis para o Storage: ${mirrored ? 'sim' : 'não'}.`);
  console.log('Nenhuma conta, permissão ou registro foi alterado. Nenhum e-mail ou pagamento foi enviado.');
  console.log('Este resultado não confirma as regras publicadas nem o token da sessão do navegador. Após alterar a função, entre novamente com o mesmo e-mail.');
  if (!projectMatches || !databaseMatches || !primary.entry || !mirrored) process.exitCode = 1;
}
main().catch(error => {
  const code = (error as { code?: unknown })?.code;
  if (error instanceof Error && (error.message.startsWith('Usage:') || error.message === 'Provide a valid registered email.')) console.error(error.message);
  else if (code === 'auth/user-not-found') console.error('Nenhuma conta cadastrada com esse e-mail. Entre primeiro na loja com essa conta Google.');
  else console.error('Não foi possível conferir o acesso. Verifique as credenciais do servidor, a conexão e os registros nos dois bancos.');
  process.exitCode = 1;
});
