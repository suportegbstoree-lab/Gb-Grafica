import { loadEnv } from 'vite';
import { appCheckBuildProblems } from '../src/lib/appCheckConfig.js';
import { configuredAppCheckAppIds, configuredAppCheckMode } from '../src/server/appCheck.js';
import config from '../firebase-applet-config.json' with { type: 'json' };

const production = process.argv.includes('--production');
const env = loadEnv(production ? 'production' : 'development', process.cwd(), '');
const mode = configuredAppCheckMode(env.FIREBASE_APP_CHECK_MODE);
const siteKeyPresent = Boolean(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?.trim());
const appIds = configuredAppCheckAppIds(env.FIREBASE_APP_CHECK_ALLOWED_APP_IDS, config.appId);
const problems = production ? appCheckBuildProblems(env) : [];
if (!mode) problems.push('FIREBASE_APP_CHECK_MODE deve ser off, monitor ou enforce.');
if (!appIds) problems.push('A lista de App IDs está inválida.');
if (production && !siteKeyPresent) problems.push('A site key pública deve estar disponível no build publicado.');
if (production && mode === 'off') problems.push('Use monitor para validar a integração antes de ativar enforce.');

console.log('Diagnóstico local de configuração; não autentica nem altera contas.');
console.log(`Site key no ambiente de build: ${siteKeyPresent ? 'presente' : 'ausente'}`);
console.log(`Modo da API própria: ${mode ?? 'inválido'}`);
console.log(`Lista de App IDs: ${appIds ? 'válida' : 'inválida'}`);
console.log('Renovação automática: habilitada pelo SDK; TTL configurado no Firebase.');
console.log('O resultado não confirma emissão real, domínios nem enforcement dos serviços Firebase.');
for (const problem of [...new Set(problems)]) console.error(`Configuração pendente: ${problem}`);
if (problems.length) process.exitCode = 1;
