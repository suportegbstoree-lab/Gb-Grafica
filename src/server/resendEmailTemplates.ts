import { createHash } from "node:crypto";

export const emailTemplateTitles = {
  welcome: "Boas-vindas à GB Gráfica",
  "order-received": "Pedido recebido",
  "order-internal": "Novo pedido para a loja",
  "order-status": "Atualização do seu pedido",
  "staff-role": "Acesso da equipe atualizado",
  "staff-document": "Seu PDF está disponível",
  campaign: "Novidades da GB Gráfica",
} as const;
export type EmailTemplateKind = keyof typeof emailTemplateTitles;
export interface EmailMessage {
  text: string;
  blocks?: string[];
  html?: string;
}
export interface ResendTemplateDefinition {
  name: string;
  alias: string;
  html: string;
  text: string;
  variables: { key: string; type: "string" }[];
}
export const EMAIL_BANNER_PATH = "/email/gb-grafica-banner.png";
const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const escapeEmailHtml = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (char) => entities[char]);
export function safeEmailUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.username || url.password) return "";
    if (
      url.protocol === "https:" ||
      (process.env.NODE_ENV !== "production" &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname))
    )
      return url.href;
  } catch {
    /* A bad URL is rendered as text, never as an executable link. */
  }
  return "";
}
export function emailBranding() {
  const configured = safeEmailUrl(process.env.APP_URL);
  const storeUrl = configured
    ? new URL(configured).origin
    : "https://www.gblgrafica.com.br";
  const support = process.env.EMAIL_REPLY_TO?.trim() || "";
  return {
    storeUrl,
    bannerUrl:
      safeEmailUrl(process.env.EMAIL_BANNER_URL) ||
      `${storeUrl}${EMAIL_BANNER_PATH}`,
    supportEmail: /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(support)
      ? support
      : "suporte@gblgrafica.com.br",
  };
}
export function plainEmailBlocks(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .filter((line) => line.trim())
    .map((paragraph) => {
      const parts = paragraph.split(/(https:\/\/[^\s<>"']+)/g).map((part) => {
        const url = safeEmailUrl(part);
        return url
          ? `<a href="${escapeEmailHtml(url)}" style="color:#b92f71;text-decoration:underline;word-break:break-word">${escapeEmailHtml(part)}</a>`
          : escapeEmailHtml(part).replace(/\n/g, "<br>");
      });
      return `<p style="margin:0 0 18px;line-height:1.7">${parts.join("")}</p>`;
    });
}
function frame(
  kind: EmailTemplateKind,
  body: string,
  branding: ReturnType<typeof emailBranding>,
  preheader: string,
) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${emailTemplateTitles[kind]}</title>
<style>@media only screen and (max-width:480px){.gb-pad{padding:24px 18px!important}.gb-column{display:block!important;width:100%!important;box-sizing:border-box!important}.gb-button{display:block!important;text-align:center!important}.gb-title{font-size:24px!important}}</style></head>
<body style="margin:0;padding:0;background:#f3f3f5;color:#25232a;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
<div style="display:none;font-size:1px;color:#f3f3f5;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${preheader}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f3f5"><tr><td align="center" style="padding:24px 8px">
<!--[if mso]><table role="presentation" width="640" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #e6e3e6;border-collapse:collapse">
<tr><td style="padding:0;background:#000000"><a href="${branding.storeUrl}" style="text-decoration:none"><img src="${branding.bannerUrl}" width="640" alt="GB Gráfica — personalizados feitos com cuidado" style="display:block;width:100%;max-width:640px;height:auto;border:0;color:#ffffff;font-size:22px"></a></td></tr>
<tr><td class="gb-pad" style="padding:32px 30px 24px;color:#25232a;font-size:14px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word">
<p style="margin:0 0 8px;color:#b92f71;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase">GB GRÁFICA · PERSONALIZADOS</p>
<h1 class="gb-title" style="margin:0 0 22px;color:#1d1c22;font-size:28px;line-height:1.25">${emailTemplateTitles[kind]}</h1>
${body}
</td></tr>
<tr><td class="gb-pad" style="padding:22px 30px;background:#fbf1f6;border-top:1px solid #f0dfe8;color:#655963;font-size:12px;line-height:1.7">
<strong style="color:#25232a">Precisa de ajuda?</strong><br>Responda a este e-mail ou escreva para <a href="mailto:${branding.supportEmail}" style="color:#b92f71;text-decoration:underline">${branding.supportEmail}</a>.<br>
<a href="${branding.storeUrl}" style="color:#655963;text-decoration:underline">Visitar a GB Gráfica</a></td></tr>
</table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}
// Resend: at most 50 variables and 2,000 characters per string value.
// Pack complete blocks so variables never cut tags or tables in half.
const HTML_PARTS = 16,
  TEXT_PARTS = 8,
  PART_LENGTH = 1900;
const partKeys = (base: string, count: number) =>
  Array.from({ length: count }, (_, i) => (i ? `${base}_${i + 1}` : base));
const htmlKeys = partKeys("GB_MESSAGE_HTML", HTML_PARTS),
  textKeys = partKeys("GB_MESSAGE_TEXT", TEXT_PARTS);
const placeholders = (keys: string[]) =>
  keys.map((key) => `{{{${key}}}}`).join("");
function definition(kind: EmailTemplateKind): ResendTemplateDefinition {
  const content = {
    name: `GB Gráfica · ${emailTemplateTitles[kind]}`,
    html: frame(
      kind,
      placeholders(htmlKeys),
      {
        storeUrl: "{{{GB_STORE_URL}}}",
        bannerUrl: "{{{GB_BANNER_URL}}}",
        supportEmail: "{{{GB_SUPPORT_EMAIL}}}",
      },
      "{{{GB_PREHEADER}}}",
    ),
    text: placeholders(textKeys),
    variables: [
      ...htmlKeys,
      ...textKeys,
      "GB_STORE_URL",
      "GB_BANNER_URL",
      "GB_SUPPORT_EMAIL",
      "GB_PREHEADER",
    ].map((key) => ({ key, type: "string" as const })),
  };
  const revision = createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex")
    .slice(0, 12);
  return { ...content, alias: `gb-${kind}-${revision}` };
}
export const emailTemplateKinds = Object.keys(
  emailTemplateTitles,
) as EmailTemplateKind[];
const definitions = new Map(
  emailTemplateKinds.map((kind) => [kind, definition(kind)]),
);
export const resendTemplateDefinitions = [...definitions.values()];
function packedHtml(blocks: string[]): string[] | null {
  const chunks: string[] = [];
  for (const block of blocks) {
    if (block.length > PART_LENGTH) return null;
    if (chunks.length && chunks.at(-1)!.length + block.length <= PART_LENGTH)
      chunks[chunks.length - 1] += block;
    else chunks.push(block);
  }
  return chunks.length <= HTML_PARTS ? chunks : null;
}
function textParts(text: string): string[] {
  const result: string[] = [];
  for (let at = 0; at < text.length; ) {
    let end = Math.min(at + PART_LENGTH, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    result.push(text.slice(at, end));
    at = end;
  }
  return result;
}
export function renderEmailPreview(
  kind: EmailTemplateKind,
  content: EmailMessage,
): string {
  const brand = emailBranding();
  return frame(
    kind,
    content.blocks?.join("") ??
      content.html ??
      plainEmailBlocks(content.text).join(""),
    {
      storeUrl: escapeEmailHtml(brand.storeUrl),
      bannerUrl: escapeEmailHtml(brand.bannerUrl),
      supportEmail: escapeEmailHtml(brand.supportEmail),
    },
    escapeEmailHtml(content.text.replace(/\s+/g, " ").slice(0, 150)),
  );
}
/** Persist the complete result with the send attempt before calling Resend. */
export function resendEmailContent(
  kind: EmailTemplateKind,
  content: EmailMessage,
  newAttempt = true,
) {
  const direct = {
    text: content.text,
    html: renderEmailPreview(kind, content),
  };
  if (
    !newAttempt ||
    process.env.RESEND_USE_HOSTED_TEMPLATES?.trim().toLowerCase() !== "true"
  )
    return direct;
  const html = packedHtml(
    content.blocks ??
      (content.html ? [content.html] : plainEmailBlocks(content.text)),
  );
  const text = textParts(content.text),
    brand = emailBranding();
  // Large orders use the same layout inline, without dropping content.
  if (!html || text.length > TEXT_PARTS) return direct;
  const variables = {
    ...Object.fromEntries(htmlKeys.map((key, i) => [key, html[i] || ""])),
    ...Object.fromEntries(textKeys.map((key, i) => [key, text[i] || ""])),
    GB_STORE_URL: escapeEmailHtml(brand.storeUrl),
    GB_BANNER_URL: escapeEmailHtml(brand.bannerUrl),
    GB_SUPPORT_EMAIL: escapeEmailHtml(brand.supportEmail),
    GB_PREHEADER: escapeEmailHtml(
      content.text.replace(/\s+/g, " ").slice(0, 150),
    ),
  };
  if (Object.values(variables).some((value) => value.length > 2000))
    return direct;
  return { template: { id: definitions.get(kind)!.alias, variables } };
}
