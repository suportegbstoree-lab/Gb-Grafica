import { config as loadEnv } from "dotenv";
import { parseArgs } from "node:util";
import {
  emailAddress,
  emailConfiguration,
} from "../src/server/emailPreferences.js";
import {
  inspectResendSenders,
  ResendAdmin,
  ResendSetupError,
} from "../src/server/resendAdmin.js";
loadEnv({ path: [".env.local", ".env"], quiet: true });
try {
  const { values } = parseArgs({
    options: { remote: { type: "boolean", default: false } },
    strict: true,
  });
  const config = emailConfiguration();
  console.table({
    chaveResendDefinida: Boolean(process.env.RESEND_API_KEY?.trim()),
    remetenteValido: Boolean(config.from),
    remetentePromocionalValido: Boolean(config.marketingFrom),
    respostaValida:
      !process.env.EMAIL_REPLY_TO?.trim() || Boolean(config.replyTo),
    destinatarioDaLojaValido: Boolean(
      emailAddress(process.env.ORDER_NOTIFICATION_EMAIL?.trim()),
    ),
    urlDaLojaValida: Boolean(config.origin),
    descadastroConfigurado:
      (process.env.EMAIL_UNSUBSCRIBE_SECRET?.length || 0) >= 32,
    cronConfigurado: (process.env.CRON_SECRET?.length || 0) >= 32,
    avisosConfigurados: config.configured,
    campanhasConfiguradas: config.marketingConfigured,
  });
  if (!config.configured) process.exitCode = 1;
  if (values.remote) {
    const client = new ResendAdmin(
      process.env.RESEND_ADMIN_API_KEY || process.env.RESEND_API_KEY || "",
    );
    const rows = await inspectResendSenders(client, {
      EMAIL_FROM: config.from,
      EMAIL_MARKETING_FROM: config.marketingFrom,
      ORDER_EMAIL_FROM: emailAddress(
        (
          process.env.ORDER_EMAIL_FROM ||
          process.env.EMAIL_FROM ||
          process.env.STAFF_EMAIL_FROM
        )?.trim(),
      ),
      STAFF_EMAIL_FROM: emailAddress(
        (process.env.STAFF_EMAIL_FROM || process.env.EMAIL_FROM)?.trim(),
      ),
    });
    console.table(rows);
    if (rows.some((row) => !row.sending)) process.exitCode = 1;
    console.log(
      "Consultas GET ao Resend. A chave administrativa confirma os domínios da conta; não comprova a permissão da chave de envio configurada na Vercel.",
    );
  }
  console.log(
    "Não confirma entrega na caixa de entrada, cota nem cron publicado. Nenhum e-mail, chave, registro DNS ou campanha foi criado.",
  );
} catch (error) {
  console.error(
    error instanceof ResendSetupError ||
      (error as any)?.code?.startsWith("ERR_PARSE_ARGS")
      ? (error as Error).message
      : "Não foi possível concluir o diagnóstico de e-mail.",
  );
  process.exitCode = 1;
}
