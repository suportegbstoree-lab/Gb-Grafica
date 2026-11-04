export const PAGBANK_WEBHOOK_PATH = "/api/webhook/pagbank";
export type PagBankEnvironment = "sandbox" | "production";
export type PagBankSignatureMode = "auto" | "ecdsa";
export function pagBankEnvironment(value: unknown): PagBankEnvironment | null {
  if (value === undefined || value === "") return "sandbox";
  return typeof value === "string" &&
    ["sandbox", "production"].includes(value.trim().toLowerCase())
    ? (value.trim().toLowerCase() as PagBankEnvironment)
    : null;
}
export function pagBankSignatureMode(
  value: unknown,
): PagBankSignatureMode | null {
  if (value === undefined || value === "") return "auto";
  return typeof value === "string" &&
    ["auto", "ecdsa"].includes(value.trim().toLowerCase())
    ? (value.trim().toLowerCase() as PagBankSignatureMode)
    : null;
}
export function pagBankBaseUrl(environment: PagBankEnvironment) {
  return environment === "production"
    ? "https://api.pagseguro.com"
    : "https://sandbox.api.pagseguro.com";
}
export function pagBankPublicUrl(value: string, production: boolean): string {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && !production && local))
  )
    throw new Error(
      "APP_URL deve ser HTTPS, sem credenciais, query ou fragmento; HTTP é permitido somente em loopback no desenvolvimento.",
    );
  return url.origin + url.pathname.replace(/\/+$/, "");
}
export function pagBankWebhookUrl(publicUrl: string) {
  const url = `${publicUrl.replace(/\/+$/, "")}${PAGBANK_WEBHOOK_PATH}`;
  if (url.length > 100)
    throw new Error("A URL pública do webhook excede 100 caracteres.");
  return url;
}
export const PAGBANK_WEBHOOK_HEALTH = Object.freeze({
  status: "ok",
  service: "pagbank-webhook",
  notification_method: "POST",
});
