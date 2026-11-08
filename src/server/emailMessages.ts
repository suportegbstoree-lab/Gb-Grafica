import type { Order, SiteConfig } from "../types.js";
import {
  formatBrazilianPhone,
  formatMoney,
  parseMoneyToCents,
} from "../lib/commerce.js";
import {
  fulfillmentStatusLabel,
  type FulfillmentStatus,
} from "../lib/orderStatus.js";
import {
  emailBranding,
  escapeEmailHtml as escape,
  plainEmailBlocks,
  safeEmailUrl,
  type EmailMessage,
} from "./resendEmailTemplates.js";

const p = (value: string) =>
  `<p style="margin:0 0 18px;line-height:1.7">${escape(value).replace(/\n/g, "<br>")}</p>`;
const heading = (value: string) =>
  `<h2 style="margin:24px 0 0;padding:10px 12px;background:#b92f71;color:#ffffff;font-size:14px;line-height:1.4">${escape(value)}</h2>`;
function button(label: string, url: string) {
  const safe = safeEmailUrl(url);
  return safe
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:6px 0 22px"><tr><td style="background:#202029;border-radius:6px"><a class="gb-button" href="${escape(safe)}" style="display:inline-block;padding:13px 22px;border:1px solid #202029;border-radius:6px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none">${escape(label)}</a></td></tr></table>`
    : "";
}
function rows(values: [string, string][]) {
  return values
    .filter(([, value]) => value)
    .map(
      ([label, value]) =>
        `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;border:1px solid #e8e2e6"><tr><td width="40%" valign="top" style="padding:9px 12px;background:#fcf8fa;font-size:12px;color:#6d5e67">${escape(label)}</td><td valign="top" style="padding:9px 12px;color:#25232a;font-size:13px;word-break:break-word">${escape(value).replace(/\n/g, "<br>")}</td></tr></table>`,
    );
}
const paymentLabels: Record<string, string> = {
  pago: "Pagamento confirmado",
  pendente: "Aguardando pagamento",
  em_analise: "Pagamento em análise",
  recusado: "Pagamento recusado",
  cancelado: "Pagamento cancelado",
  expirado: "Pagamento expirado",
  erro: "Confira o pagamento na loja",
};
function deliveryLines(order: Order, config: Partial<SiteConfig>) {
  if (order.metodoEntrega === "retirada")
    return [
      "Retirada na loja",
      config.endereco_comercial || "Combine a retirada com o atendimento.",
    ];
  const a = order.enderecoEntrega;
  return [
    order.shipping?.service_name
      ? `Correios · ${order.shipping.service_name}`
      : "Entrega no endereço informado",
    ...(a
      ? [
          `${a.rua}, ${a.numero}${a.complemento ? ` — ${a.complemento}` : ""}`,
          `${a.bairro} · ${a.cidade}/${a.estado}`,
          `CEP ${a.cep}`,
        ]
      : []),
  ];
}
export function orderReceiptEmailMessage(
  orderId: string,
  order: Order,
  merchant = false,
  config: Partial<SiteConfig> = {},
): EmailMessage {
  const origin = emailBranding().storeUrl;
  const intro = merchant
    ? "Um novo pedido foi recebido pela GB Gráfica. Confira os dados abaixo e a ficha anexada antes de produzir."
    : `Olá${order.clienteNome ? `, ${order.clienteNome}` : ""}! Obrigada por escolher a GB Gráfica. Recebemos seu pedido.`;
  const instructions =
    order.paymentStatus === "pago"
      ? `O pagamento deste pedido está confirmado. Acompanhe a produção ${merchant ? "no painel da equipe" : "em Meus Pedidos na loja"}.`
      : "O processamento segue após a confirmação do pagamento e a conferência da arte. Esta ficha inicial não confirma pagamento.";
  const date = new Date(order.data);
  const method = {
    cartao: "Cartão",
    pix: "Pix",
    pagbank: "PagBank — modalidade escolhida no checkout",
  }[order.metodoPagamento || "pagbank"];
  const details: [string, string][] = [
    ["Número do pedido", orderId],
    [
      "Data do pedido",
      Number.isFinite(date.getTime())
        ? date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
        : String(order.data),
    ],
    ["Forma de pagamento", method],
    [
      "Pagamento",
      paymentLabels[order.paymentStatus || "pendente"] || "Confira na loja",
    ],
  ];
  const contact = [
    order.clienteNome,
    order.clienteEmail,
    order.clienteTelefone ? formatBrazilianPhone(order.clienteTelefone) : "",
  ]
    .filter(Boolean)
    .join("\n");
  const delivery = deliveryLines(order, config).join("\n");
  const blocks = [
    p(intro),
    p(instructions),
    button(
      merchant ? "Abrir painel da equipe" : "Ver pedido na loja",
      merchant ? `${origin}/admin` : origin,
    ),
    ...(!merchant
      ? [
          p(
            "Entre com sua conta e acesse Meus Pedidos para acompanhar os detalhes.",
          ),
        ]
      : []),
    heading("Detalhes do pedido"),
    ...rows(details),
  ];
  blocks.push(
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:20px;border-collapse:collapse;border:1px solid #e8e2e6"><tr><td class="gb-column" width="50%" valign="top" style="padding:14px;border:1px solid #e8e2e6;font-size:13px;word-break:break-word"><strong style="color:#b92f71">Contato do cliente</strong><br>${escape(contact).replace(/\n/g, "<br>")}</td><td class="gb-column" width="50%" valign="top" style="padding:14px;border:1px solid #e8e2e6;font-size:13px;word-break:break-word"><strong style="color:#b92f71">Envio ou retirada</strong><br>${escape(delivery).replace(/\n/g, "<br>")}</td></tr></table>`,
  );
  blocks.push(heading("Itens do pedido"));
  const lines = [
    intro,
    instructions,
    ...details.map(([key, value]) => `${key}: ${value}`),
    `Cliente: ${contact}`,
    `Envio ou retirada: ${delivery}`,
    "Itens do pedido:",
  ];
  blocks.push(
    '<table width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background:#fcf8fa;border:1px solid #e8e2e6"><tr><th align="left" style="padding:10px 12px;font-size:12px">Produto</th><th align="center" width="48" style="padding:10px 4px;font-size:12px">Qtd.</th><th align="right" width="94" style="padding:10px 12px;font-size:12px">Valor</th></tr></table>',
  );
  for (const item of order.itens || []) {
    const selections = Object.entries(item.selecoes || {})
      .map(([key, value]) => `${key}: ${value}`)
      .join(" · ");
    const customization =
      item.personalizacaoTexto?.texto || item.textoPersonalizado || "";
    const children = item.bundleItems
      ?.map((child) => `${child.quantidade} × ${child.nome}`)
      .join("; ");
    const description = [
      selections,
      customization ? `Personalização: ${customization}` : "",
      children ? `Inclui: ${children}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const cents = parseMoneyToCents(item.preco);
    const price =
      cents === null
        ? "Confira na loja"
        : formatMoney((cents * item.quantidade) / 100);
    blocks.push(
      `<table width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;border:1px solid #e8e2e6"><tr><td valign="top" style="padding:12px;font-size:13px;color:#25232a;word-break:break-word"><strong>${escape(item.nome)}</strong>${description ? `<br><span style="font-size:12px;color:#71636c">${escape(description).replace(/\n/g, "<br>")}</span>` : ""}</td><td align="center" valign="top" width="48" style="padding:12px 4px;font-size:13px">${escape(item.quantidade)}</td><td align="right" valign="top" width="94" style="padding:12px;font-size:13px;white-space:nowrap">${escape(price)}</td></tr></table>`,
    );
    lines.push(
      `${item.quantidade} × ${item.nome} — ${price}${description ? `\n${description}` : ""}`,
    );
  }
  const total =
    Number.isSafeInteger(order.totalCents) && order.totalCents! >= 0
      ? order.totalCents!
      : parseMoneyToCents(order.total);
  const totals: [string, string][] = [];
  if (order.subtotal !== undefined)
    totals.push(["Subtotal", formatMoney(order.subtotal)]);
  if (order.frete !== undefined)
    totals.push(["Frete", formatMoney(order.frete)]);
  totals.push([
    "Total do pedido",
    total === null ? "Confira na loja" : formatMoney(total / 100),
  ]);
  blocks.push(...rows(totals));
  lines.push(...totals.map(([key, value]) => `${key}: ${value}`));
  if (order.observacoes) {
    blocks.push(heading("Observações"), p(order.observacoes));
    lines.push(`Observações: ${order.observacoes}`);
  }
  blocks.push(
    p(
      "A ficha inicial do pedido segue em PDF anexo. Guarde-a para sua referência.",
    ),
  );
  lines.push(
    "A ficha inicial do pedido segue em PDF anexo.",
    `Acompanhe na loja: ${origin}`,
  );
  return { blocks, text: lines.join("\n\n") };
}
export function welcomeEmailMessage(name = ""): EmailMessage {
  const intro = `Olá${name ? `, ${name}` : ""}! Sua conta na GB Gráfica está pronta.`;
  const note =
    "Agora você pode personalizar seus produtos e acompanhar suas compras em Meus Pedidos. Promoções e novidades são opcionais: escolha o que deseja receber em Preferências de e-mail na loja.";
  return {
    text: `${intro}\n\n${note}\n\nConheça a loja: ${emailBranding().storeUrl}`,
    blocks: [
      p(intro),
      p(note),
      button("Conhecer os personalizados", emailBranding().storeUrl),
    ],
  };
}
export function orderStatusEmailMessage(
  orderId: string,
  job: {
    refunded?: boolean;
    paymentStatus?: string;
    fulfillmentStatus?: FulfillmentStatus;
    trackingCode?: string;
  },
): EmailMessage {
  const status = job.refunded
    ? "Estorno registrado"
    : job.paymentStatus === "pago" && job.fulfillmentStatus
      ? fulfillmentStatusLabel(job.fulfillmentStatus) || "Pedido atualizado"
      : paymentLabels[job.paymentStatus || "pendente"] || "Pedido atualizado";
  const details: [string, string][] = [
    ["Pedido", orderId],
    ["Atualização", status],
    ["Código de rastreio", job.trackingCode || ""],
  ];
  return {
    text: `Seu pedido ${orderId} foi atualizado.\n\n${details
      .map(([key, value]) => (value ? `${key}: ${value}` : ""))
      .filter(Boolean)
      .join(
        "\n",
      )}\n\nConfira os detalhes em Meus Pedidos na loja: ${emailBranding().storeUrl}`,
    blocks: [
      p("Temos uma atualização sobre o seu pedido."),
      heading(status),
      ...rows(details),
      p(
        "Entre com sua conta e acesse Meus Pedidos para consultar o andamento completo.",
      ),
      button("Acompanhar na loja", emailBranding().storeUrl),
    ],
  };
}
export function staffRoleEmailMessage(
  roleName: string,
  removed: boolean,
): EmailMessage {
  const note = removed
    ? "Seu acesso ao painel foi removido."
    : "Saia e entre novamente na loja para atualizar sua sessão. As áreas disponíveis dependem das permissões da sua função.";
  return {
    text: `Sua função foi atualizada para: ${roleName}.\n\n${note}\n\nSe você não esperava esta alteração, entre em contato com a administração da loja.`,
    blocks: [
      p("A administração atualizou seu acesso à equipe da GB Gráfica."),
      ...rows([["Função", roleName]]),
      p(note),
      ...(!removed
        ? [
            button(
              "Acessar painel da equipe",
              `${emailBranding().storeUrl}/admin`,
            ),
          ]
        : []),
      p(
        "Se você não esperava esta alteração, entre em contato com a administração da loja.",
      ),
    ],
  };
}
export function staffDocumentEmailMessage(input: {
  reference: string;
  url: string;
  expiresAt: string;
  attached: boolean;
}): EmailMessage {
  const date = new Date(input.expiresAt);
  const expires = Number.isFinite(date.getTime())
    ? date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : input.expiresAt;
  const note = input.attached
    ? "O documento também está anexado a este e-mail."
    : "Use o link para baixar o documento em qualidade integral.";
  return {
    text: `O PDF gerado pela GB Gráfica está disponível.\nReferência: ${input.reference}\nDisponível até: ${expires}\n\n${input.url}\n\n${note}`,
    blocks: [
      p("Seu arquivo está pronto para consulta."),
      ...rows([
        ["Documento", input.reference],
        ["Disponível até", expires],
      ]),
      p(note),
      button("Abrir PDF", input.url),
      p(
        "O acesso pelo link expira na data informada. Salve o arquivo antes do vencimento, se necessário.",
      ),
    ],
  };
}
export function campaignEmailMessage(
  content: string,
  channel: string,
  unsubscribeUrl: string,
): EmailMessage {
  const origin = emailBranding().storeUrl;
  const note = `Você recebeu esta mensagem porque autorizou ${channel === "promotions" ? "promoções" : "novidades"} da GB Gráfica.`;
  return {
    text: `${content}\n\n${note}\nDescadastrar: ${unsubscribeUrl}\nGerencie suas preferências na loja: ${origin}`,
    blocks: [
      ...plainEmailBlocks(content),
      button("Ver novidades na loja", origin),
      p(note),
      ...plainEmailBlocks(`Descadastrar: ${unsubscribeUrl}`),
      p("Você também pode gerenciar suas preferências de e-mail na loja."),
    ],
  };
}
