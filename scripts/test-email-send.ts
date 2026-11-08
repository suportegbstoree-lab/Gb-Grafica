import { config } from "dotenv";
import { parseArgs } from "node:util";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EmailTestError,
  emailTestSamples,
  sendEmailTestSuite,
  singleTestEmail,
} from "../src/server/emailTestSend.js";
import {
  emailBranding,
  emailTemplateTitles,
  escapeEmailHtml,
  renderEmailPreview,
} from "../src/server/resendEmailTemplates.js";

config({ path: [".env.local", ".env"], quiet: true });
try {
  const { values } = parseArgs({
    strict: true,
    allowPositionals: false,
    options: {
      email: { type: "string" },
      "dry-run": { type: "boolean" },
      "preview-dir": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      'npm run email:test:send -- --email "voce@dominio.com.br"\nEnvia uma amostra fictícia de cada template somente ao endereço informado. Usa RESEND_API_KEY.\n--dry-run: mostra o plano sem enviar.\n--preview-dir CAMINHO: salva os sete HTMLs e o banner localmente, sem enviar; --email é opcional neste modo.\nCarrega .env.local e .env, preservando variáveis exportadas.',
    );
  } else {
    const preview = values["preview-dir"];
    const recipient =
      values.email || (preview ? "cliente@example.invalid" : "");
    if (!singleTestEmail(recipient))
      throw new EmailTestError(
        'Informe um único endereço válido: npm run email:test:send -- --email "voce@dominio.com.br"',
      );
    if (preview) {
      const directory = path.resolve(preview);
      await mkdir(directory, { recursive: true });
      const samples = await emailTestSamples();
      for (const sample of samples) {
        const html = renderEmailPreview(sample.kind, sample.message).replaceAll(
          escapeEmailHtml(emailBranding().bannerUrl),
          "./gb-grafica-banner.png",
        );
        await writeFile(path.join(directory, `${sample.kind}.html`), html);
      }
      await copyFile(
        fileURLToPath(
          new URL("../public/email/gb-grafica-banner.png", import.meta.url),
        ),
        path.join(directory, "gb-grafica-banner.png"),
      );
      await writeFile(
        path.join(directory, "index.html"),
        `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Templates GB Gráfica</title><body style="font:16px Arial;margin:40px;line-height:2"><h1>Templates da GB Gráfica</h1><p>Amostras com dados fictícios. Nenhum envio foi realizado.</p><ul>${samples.map((sample) => `<li><a href="${sample.kind}.html">${emailTemplateTitles[sample.kind]}</a></li>`).join("")}</ul></body></html>`,
      );
      console.log(
        `Prévia dos ${samples.length} templates salva em ${directory}. Abra index.html. Nenhum e-mail foi enviado.`,
      );
    } else {
      console.log(
        `Destinatário único: ${singleTestEmail(recipient)}. Modo: ${values["dry-run"] ? "plano sem envio" : "envio real de amostras"}.`,
      );
      const result = await sendEmailTestSuite(recipient, {
        dryRun: values["dry-run"],
        onResult: (row) =>
          console.log(`${row.template}: ${row.status} — ${row.detail}`),
      });
      console.log(
        values["dry-run"]
          ? `Plano: ${result.results.length} templates. Nenhum e-mail foi enviado.`
          : `Execução: ${result.runId}. Aceitos: ${result.results.filter((row) => row.status === "accepted").length}/${result.results.length}.`,
      );
      if (
        result.results.some(
          (row) => !["accepted", "planned"].includes(row.status),
        )
      )
        process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(
    error instanceof EmailTestError
      ? error.message
      : (error as any)?.code?.startsWith("ERR_PARSE_ARGS")
        ? "Argumentos inválidos. Use npm run email:test:send -- --help."
        : "Não foi possível concluir o teste. Confira a configuração e o diretório de prévia.",
  );
  process.exitCode = 1;
}
