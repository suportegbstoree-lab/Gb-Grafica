import dotenv from 'dotenv';
import { getAdminServices } from '../src/server/firebaseAdmin.js';

dotenv.config();

function argumentValue(flag: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1]?.trim() || '' : '';
}

async function main() {
  const email = argumentValue('--email').toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('Use: npm run admin:set -- --email administrador@exemplo.com');
  }

  const { auth, db } = getAdminServices();
  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { ...user.customClaims, admin: true });
  await db.collection('users').doc(user.uid).set({
    uid: user.uid,
    email,
    role: 'admin',
  }, { merge: true });

  console.log(`Permissão administrativa aplicada a ${email}. O usuário deve entrar novamente.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
