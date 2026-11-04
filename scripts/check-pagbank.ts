import dotenv from "dotenv";
import { checkPagBankConfiguration } from "../src/server/pagbankDiagnostics.js";
dotenv.config({ quiet: true });
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: npm run pagbank:check -- [--remote] [--json]\n\nDefault: validate local configuration without network requests.\n--remote  Send GET requests to the public webhook health route and the official webhook-key endpoint.\n--json    Print a machine-readable report.\nNo key creation, payment, order modification or email sending is performed.",
    );
    return;
  }
  if (args.some((arg) => !["--remote", "--json"].includes(arg)))
    throw new Error("Unknown argument. Use --help.");
  const report = await checkPagBankConfiguration(
    process.env,
    args.includes("--remote"),
  );
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log("Integração: Checkout Hospedado PagBank.");
    console.log(
      `Ambiente: ${report.environment}; assinaturas: ${report.signatureMode}.`,
    );
    console.table(report.checks);
    if (report.webhookUrl)
      console.log(`Notificações de checkout e pagamento: ${report.webhookUrl}`);
    console.log(
      "Chave RSA de cartão não é necessária neste fluxo. A chave EC de webhook é diferente.",
    );
    if (report.remote) {
      console.log(
        `Endpoint publicado: ${report.remote.endpoint === "ok" ? "respondeu corretamente ao GET de diagnóstico" : "não confirmado; confira o deploy, o domínio e eventuais bloqueios de acesso"}.`,
      );
      console.log(
        `Chave de webhook: ${report.remote.webhookKey === "available" ? "disponível" : "não disponível; confirme com o PagBank a ativação do novo serviço e o endpoint de chaves da conta"}.`,
      );
    }
    console.log(
      "Diagnóstico somente de leitura. Não confirma homologação, recebimento de webhook real nem entrega de e-mails. Nenhuma chave, compra, cobrança ou mensagem foi criada.",
    );
  }
  if (!report.valid) process.exitCode = 1;
}
main().catch(() => {
  console.error(
    "Não foi possível concluir o diagnóstico. Confira a configuração local.",
  );
  process.exitCode = 1;
});
