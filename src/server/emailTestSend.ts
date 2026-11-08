import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Order } from "../types.js";
import { createOrderLabel } from "./productionLabel.js";
import {
  campaignEmailMessage,
  orderReceiptEmailMessage,
  orderStatusEmailMessage,
  staffDocumentEmailMessage,
  staffRoleEmailMessage,
  welcomeEmailMessage,
} from "./emailMessages.js";
import {
  emailBranding,
  emailTemplateKinds,
  emailTemplateTitles,
  resendEmailContent,
  type EmailMessage,
  type EmailTemplateKind,
} from "./resendEmailTemplates.js";

export class EmailTestError extends Error {}
export function singleTestEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  const address = value.trim();
  return address.length <= 254 &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(
      address,
    )
    ? address.toLowerCase()
    : "";
}
export interface EmailTestSample {
  kind: EmailTemplateKind;
  message: EmailMessage;
  attachments?: { filename: string; content: string; content_type: string }[];
}
/** All fixtures are local and fictional. This tool never reads or writes Firebase. */
export async function emailTestSamples(
  now = Date.now(),
): Promise<EmailTestSample[]> {
  const origin = emailBranding().storeUrl;
  const order: Order = {
    id: "GB-TESTE-001",
    userId: "test-only",
    data: new Date(now).toISOString(),
    status: "Pendente",
    paymentStatus: "pendente",
    clienteNome: "Cliente de Exemplo",
    clienteEmail: "cliente@example.invalid",
    clienteTelefone: "11999990000",
    metodoPagamento: "pagbank",
    metodoEntrega: "entrega",
    enderecoEntrega: {
      rua: "Rua de Exemplo",
      numero: "123",
      complemento: "Apto. 4",
      bairro: "Centro",
      cidade: "São Paulo",
      estado: "SP",
      cep: "01001000",
    },
    itens: [
      {
        id: "item-a",
        productId: "example-a",
        nome: "Caderno personalizado",
        imagem: "",
        quantidade: 2,
        preco: "49.90",
        selecoes: { Formato: "A5", Acabamento: "Espiral" },
        textoPersonalizado: "Maria\nMeu caderno de ideias",
      },
      {
        id: "item-b",
        productId: "example-b",
        nome: "Cartela de adesivos",
        imagem: "",
        quantidade: 1,
        preco: "15.00",
        selecoes: { Tamanho: "10 × 15 cm" },
      },
    ],
    subtotal: "114.80",
    frete: "18.50",
    total: "133.30",
    totalCents: 13330,
    observacoes: "Dados fictícios. Este e-mail não representa uma compra.",
  };
  const label = Buffer.from(await createOrderLabel(order.id, order)).toString(
    "base64",
  );
  const pdf = await PDFDocument.create(),
    page = pdf.addPage([420, 595]),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("GB GRAFICA - ARQUIVO DE TESTE", {
    x: 30,
    y: 540,
    size: 17,
    font,
  });
  page.drawText("Documento ficticio. Nenhum pedido foi criado.", {
    x: 30,
    y: 510,
    size: 12,
    font,
  });
  const attachment = {
    filename: "GB-TESTE-001-pedido.pdf",
    content: label,
    content_type: "application/pdf",
  };
  const content: Record<EmailTemplateKind, EmailTestSample> = {
    welcome: {
      kind: "welcome",
      message: welcomeEmailMessage("Cliente de Exemplo"),
    },
    "order-received": {
      kind: "order-received",
      message: orderReceiptEmailMessage(order.id, order),
      attachments: [attachment],
    },
    "order-internal": {
      kind: "order-internal",
      message: orderReceiptEmailMessage(order.id, order, true),
      attachments: [attachment],
    },
    "order-status": {
      kind: "order-status",
      message: orderStatusEmailMessage(order.id, {
        paymentStatus: "pago",
        fulfillmentStatus: "enviado",
        trackingCode: "BR123456789BR",
      }),
    },
    "staff-role": {
      kind: "staff-role",
      message: staffRoleEmailMessage("Designer — exemplo", false),
    },
    "staff-document": {
      kind: "staff-document",
      message: staffDocumentEmailMessage({
        reference: "Modelo de exemplo",
        url: `${origin}/?email-test=documento`,
        expiresAt: new Date(now + 3 * 86400000).toISOString(),
        attached: true,
      }),
      attachments: [
        {
          filename: "gb-grafica-exemplo.pdf",
          content: Buffer.from(await pdf.save()).toString("base64"),
          content_type: "application/pdf",
        },
      ],
    },
    campaign: {
      kind: "campaign",
      message: campaignEmailMessage(
        "Ideias que viram personalizados.\n\nConheça nossos cadernos, adesivos e presentes feitos para deixar cada detalhe com a sua cara. Este conteúdo é somente uma demonstração.",
        "promotions",
        `${origin}/?email-test=descadastro`,
      ),
    },
  };
  const disclaimer =
    "TESTE SOLICITADO — dados fictícios. Nenhuma compra, alteração de acesso ou inscrição em campanha foi realizada. Os links do PDF e do descadastro são demonstrativos.";
  return emailTemplateKinds.map((kind) => {
    const sample = content[kind];
    return {
      ...sample,
      message: {
        text: `${disclaimer}\n\n${sample.message.text}`,
        blocks: [
          `<p style="margin:0 0 22px;padding:12px;background:#fff5d7;color:#70530d;font-size:12px;line-height:1.6">${disclaimer}</p>`,
          ...sample.message.blocks!,
        ],
      },
    };
  });
}
export type EmailTestStatus =
  | "accepted"
  | "failed"
  | "unknown"
  | "not_sent"
  | "planned";
export interface EmailTestResult {
  template: EmailTemplateKind;
  status: EmailTestStatus;
  detail: string;
  providerId?: string;
}
export async function sendEmailTestSuite(
  recipient: string,
  options: {
    dryRun?: boolean;
    fetcher?: typeof fetch;
    pause?: (ms: number) => Promise<unknown>;
    runId?: string;
    samples?: EmailTestSample[];
    onResult?: (result: EmailTestResult) => void;
  } = {},
) {
  const to = singleTestEmail(recipient);
  if (!to)
    throw new EmailTestError("Informe um único endereço válido em --email.");
  const key = process.env.RESEND_API_KEY?.trim();
  if (!options.dryRun && !key)
    throw new EmailTestError(
      "Configure RESEND_API_KEY em .env.local ou no ambiente.",
    );
  const from = singleTestEmail(
    process.env.EMAIL_FROM ||
      process.env.ORDER_EMAIL_FROM ||
      process.env.STAFF_EMAIL_FROM,
  );
  const orderFrom = singleTestEmail(process.env.ORDER_EMAIL_FROM || from);
  const staffFrom = singleTestEmail(process.env.STAFF_EMAIL_FROM || from);
  const marketingFrom = singleTestEmail(
    process.env.EMAIL_MARKETING_FROM || from,
  );
  const replyTo = singleTestEmail(
    process.env.EMAIL_REPLY_TO || emailBranding().supportEmail,
  );
  if (![from, orderFrom, staffFrom, marketingFrom, replyTo].every(Boolean))
    throw new EmailTestError(
      "Confira EMAIL_FROM, ORDER_EMAIL_FROM, STAFF_EMAIL_FROM, EMAIL_MARKETING_FROM e EMAIL_REPLY_TO. Use endereços simples válidos.",
    );
  if (!options.dryRun) {
    let publicSite = false;
    try {
      const url = new URL(process.env.APP_URL || "");
      publicSite =
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    } catch {
      /* The real test must not send localhost links or banners. */
    }
    if (!publicSite || !emailBranding().bannerUrl.startsWith("https://"))
      throw new EmailTestError(
        "Configure APP_URL com a URL pública HTTPS da loja antes de enviar. O banner precisa estar publicado.",
      );
  }
  const samples = options.samples ?? (await emailTestSamples());
  const runId = options.runId || randomUUID();
  const pause = options.pause || delay,
    fetcher = options.fetcher || fetch;
  const results: EmailTestResult[] = [];
  let stopped = false;
  for (const [index, sample] of samples.entries()) {
    const report = (result: EmailTestResult) => {
      results.push(result);
      options.onResult?.(result);
    };
    if (stopped) {
      report({
        template: sample.kind,
        status: "not_sent",
        detail:
          "Lote interrompido: confira a chave, o domínio ou a cota antes de repetir.",
      });
      continue;
    }
    const payload = {
      from:
        sample.kind === "campaign"
          ? marketingFrom
          : sample.kind.startsWith("order-")
            ? orderFrom
            : sample.kind.startsWith("staff-")
              ? staffFrom
              : from,
      to: [to],
      reply_to: replyTo,
      subject: `[TESTE ${index + 1}/${samples.length}] ${emailTemplateTitles[sample.kind]}`,
      ...resendEmailContent(sample.kind, sample.message),
      ...(sample.attachments ? { attachments: sample.attachments } : {}),
    };
    if (options.dryRun) {
      report({
        template: sample.kind,
        status: "planned",
        detail: `Sem envio; remetente ${payload.from}.`,
      });
      continue;
    }
    if (index) await pause(700);
    try {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        response = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(8000),
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `email-test-${runId}-${sample.kind}`,
          },
          body: JSON.stringify(payload),
        });
        const wait = Number(response.headers.get("retry-after"));
        if (
          response.status !== 429 ||
          attempt ||
          !Number.isFinite(wait) ||
          wait <= 0 ||
          wait > 10
        )
          break;
        const error = await response
          .clone()
          .json()
          .catch(() => ({}));
        if (error?.name !== "rate_limit_exceeded") break;
        await pause(Math.ceil(wait * 1000));
      }
      const body = await response!.json().catch(() => ({}));
      if (response!.ok && typeof body?.id === "string" && body.id)
        report({
          template: sample.kind,
          status: "accepted",
          detail: "Aceito pelo Resend; confira o recebimento na caixa.",
          providerId: body.id,
        });
      else {
        stopped = [401, 403, 429].includes(response!.status);
        report({
          template: sample.kind,
          status:
            response!.status >= 500 || response!.ok ? "unknown" : "failed",
          detail: `O Resend não confirmou o envio (HTTP ${response!.status}). Confira chave, domínio, modelos publicados e cota. Não houve retentativa de resposta ambígua.`,
        });
      }
    } catch {
      report({
        template: sample.kind,
        status: "unknown",
        detail:
          "Conexão sem confirmação. Confira o painel do Resend antes de repetir este teste.",
      });
    }
  }
  return { runId, results };
}
