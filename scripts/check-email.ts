import 'dotenv/config';
import { emailConfiguration } from '../src/server/emailPreferences.js';
const config = emailConfiguration();
console.table({ chaveResendDefinida: Boolean(process.env.RESEND_API_KEY?.trim()), remetenteValido: Boolean(config.from), urlDaLojaValida: Boolean(config.origin), descadastroConfigurado: (process.env.EMAIL_UNSUBSCRIBE_SECRET?.length || 0) >= 32, cronConfigurado: (process.env.CRON_SECRET?.length || 0) >= 32, avisosConfigurados: config.configured, campanhasConfiguradas: config.marketingConfigured });
console.log('Diagnóstico local. Não confirma domínio verificado, credenciais, cota, entrega nem agendamento publicado. Nenhum e-mail foi enviado.');
if (!config.configured) process.exitCode = 1;
