import { config } from "dotenv";
import { parseArgs } from "node:util";
import {
  ResendAdmin,
  ResendSetupError,
  resendDomainName,
} from "../src/server/resendAdmin.js";
config({ path: [".env.local", ".env"], quiet: true });
try {
  const { values } = parseArgs({
    options: {
      domain: { type: "string" },
      apply: { type: "boolean", default: false },
      help: { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) {
    console.log(
      "npm run email:setup -- --domain gblgrafica.com.br [--apply]\nSem --apply: somente GET. Com --apply: cadastra o domínio se ausente e solicita verificação DNS. Não envia e-mails nem altera DNS, MX, caixas de entrada ou chaves.",
    );
  } else {
    const domain = resendDomainName(values.domain);
    const result = await new ResendAdmin(
      process.env.RESEND_ADMIN_API_KEY || "",
    ).setupDomain(domain, values.apply);
    console.log(
      `Domínio: ${domain}; ação: ${result.action}; status: ${result.domain?.status || "não cadastrado"}.`,
    );
    if (result.domain?.records?.length)
      console.table(
        result.domain.records.map((record) => ({
          tipo: record.type,
          nome: record.name,
          valor: record.value,
          prioridade: record.priority ?? "",
          status: record.status || "",
          finalidade: record.record || "",
        })),
      );
    if (!values.apply && result.action !== "ready")
      console.log(
        "Plano somente de leitura. Use --apply para cadastrar/reutilizar o domínio e solicitar a verificação.",
      );
    if (result.action === "pending-dns")
      console.log(
        "Verificação assíncrona solicitada. Publique os registros de envio no provedor DNS e execute novamente; esta resposta não confirma propagação.",
      );
    console.log(
      `\nConfiguração sugerida para o servidor:\nEMAIL_FROM=not-reply@${domain}\nORDER_EMAIL_FROM=not-reply@${domain}\nSTAFF_EMAIL_FROM=not-reply@${domain}\nEMAIL_MARKETING_FROM=promo@${domain}\nEMAIL_REPLY_TO=suporte@${domain}\nORDER_NOTIFICATION_EMAIL=suporte@${domain}`,
    );
    console.log(
      "\nNenhum e-mail foi enviado. A caixa suporte precisa receber no provedor de e-mail. Não substitua os registros MX da raiz para ativar apenas o envio.",
    );
  }
} catch (error) {
  console.error(
    error instanceof ResendSetupError ||
      (error as any)?.code?.startsWith("ERR_PARSE_ARGS")
      ? (error as Error).message
      : "Não foi possível concluir a configuração. Confira os argumentos e a configuração local.",
  );
  process.exitCode = 1;
}
