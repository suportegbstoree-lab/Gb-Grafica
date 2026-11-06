import { config } from 'dotenv';
import { parseArgs } from 'node:util';
import { ResendAdmin, ResendSetupError } from '../src/server/resendAdmin.js';
import { resendTemplateDefinitions } from '../src/server/resendEmailTemplates.js';

config({ path: ['.env.local', '.env'], quiet: true });

try {
  const { values } = parseArgs({
    options: { apply: { type: 'boolean' }, help: { type: 'boolean' } },
    strict: true,
  });
  if (values.help) {
    console.log(
      'npm run email:templates -- [--apply]\nSem --apply, consulta o plano. Com --apply, cria e publica os modelos ausentes e publica rascunhos correspondentes.',
    );
  } else {
    const client = new ResendAdmin(process.env.RESEND_ADMIN_API_KEY || '');
    console.table(
      await client.setupTemplates(resendTemplateDefinitions, values.apply),
    );
    if (values.apply)
      console.log(
        'Modelos publicados. Para ativar os envios pelos modelos, configure RESEND_USE_HOSTED_TEMPLATES=true e faça o deploy pelo Git.',
      );
    else console.log('Plano de leitura. Use --apply para publicar.');
  }
} catch (error) {
  console.error(
    error instanceof ResendSetupError
      ? error.message
      : 'Não foi possível configurar os modelos. Use --help para conferir os argumentos.',
  );
  process.exitCode = 1;
}
