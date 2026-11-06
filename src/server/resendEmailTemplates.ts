import { createHash } from 'node:crypto';

const titles = {
  welcome: 'Boas-vindas à GB Gráfica',
  'order-received': 'Pedido recebido',
  'order-internal': 'Novo pedido para a loja',
  'order-status': 'Atualização do seu pedido',
  'staff-role': 'Acesso da equipe atualizado',
  'staff-document': 'Seu PDF está disponível',
  campaign: 'Novidades da GB Gráfica',
} as const;

export type EmailTemplateKind = keyof typeof titles;
export interface ResendTemplateDefinition {
  name: string;
  alias: string;
  html: string;
  text: string;
  variables: { key: string; type: 'string' }[];
}

function definition(kind: EmailTemplateKind): ResendTemplateDefinition {
  const title = titles[kind];
  const content = {
    name: `GB Gráfica · ${title}`,
    html: `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#faf6f8;color:#25212a;font-family:Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #eadfe5">
<tr><td style="background:#902453;color:#fff;padding:20px 24px;font-size:21px;font-weight:bold">GB Gráfica</td></tr>
<tr><td style="padding:24px;font-size:16px;line-height:1.6;overflow-wrap:anywhere">
<h1 style="margin:0 0 18px;font-size:24px;line-height:1.3;color:#25212a">${title}</h1>
{{{GB_MESSAGE_HTML}}}
</td></tr>
<tr><td style="padding:16px 24px;background:#faf6f8;color:#5d5260;font-size:13px">GB Gráfica · Personalizados</td></tr>
</table></td></tr></table></body></html>`,
    text: '{{{GB_MESSAGE_TEXT}}}',
    variables: [
      { key: 'GB_MESSAGE_HTML', type: 'string' as const },
      { key: 'GB_MESSAGE_TEXT', type: 'string' as const },
    ],
  };
  const revision = createHash('sha256')
    .update(JSON.stringify(content))
    .digest('hex')
    .slice(0, 12);
  return { ...content, alias: `gb-${kind}-${revision}` };
}

const kinds = Object.keys(titles) as EmailTemplateKind[];
const definitions = new Map(kinds.map((kind) => [kind, definition(kind)]));
export const resendTemplateDefinitions = [...definitions.values()];

const entities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function messageHtml(text: string): string {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const escaped = line.replace(/[&<>"']/g, (char) => entities[char]);
      const linked = escaped.replace(
        /https:\/\/[^\s<>]+/g,
        (url) =>
          `<a href="${url}" style="color:#902453;text-decoration:underline">${url}</a>`,
      );
      return `<p style="margin:0 0 14px">${linked}</p>`;
    })
    .join('');
}

/** Save the result with the existing send attempt before calling Resend. */
export function resendEmailContent(
  kind: EmailTemplateKind,
  content: { text: string; html?: string },
  newAttempt = true,
) {
  if (
    !newAttempt ||
    process.env.RESEND_USE_HOSTED_TEMPLATES?.trim().toLowerCase() !== 'true'
  )
    return content;
  return {
    template: {
      id: definitions.get(kind)!.alias,
      variables: {
        GB_MESSAGE_HTML: messageHtml(content.text),
        GB_MESSAGE_TEXT: content.text,
      },
    },
  };
}
