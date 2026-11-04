import {
  pagBankEnvironment,
  pagBankSignatureMode,
  pagBankPublicUrl,
  pagBankWebhookUrl,
  PAGBANK_WEBHOOK_HEALTH,
} from "./pagbankConfiguration.js";
import {
  PagBankWebhookKeys,
  pagBankSmallJson,
  webhookPublicKey,
} from "./pagbankWebhookSignature.js";
export interface PagBankDiagnostic {
  environment: string;
  signatureMode: string;
  webhookUrl: string | null;
  checks: Record<string, boolean>;
  remote?: {
    endpoint: "ok" | "unavailable";
    webhookKey: "available" | "unavailable";
  };
  valid: boolean;
}
export async function checkPagBankConfiguration(
  environment: NodeJS.ProcessEnv,
  remote = false,
  fetcher: typeof fetch = fetch,
): Promise<PagBankDiagnostic> {
  const selected = pagBankEnvironment(environment.PAGBANK_ENV),
    mode = pagBankSignatureMode(environment.PAGBANK_WEBHOOK_SIGNATURE_MODE);
  let publicUrl: string | null = null,
    webhookUrl: string | null = null;
  try {
    publicUrl = pagBankPublicUrl(
      environment.APP_URL || "",
      environment.NODE_ENV === "production" || selected === "production",
    );
    webhookUrl = pagBankWebhookUrl(publicUrl);
  } catch {}
  let keyValid = true;
  if (environment.PAGBANK_WEBHOOK_PUBLIC_KEY?.trim()) {
    try {
      webhookPublicKey(environment.PAGBANK_WEBHOOK_PUBLIC_KEY);
    } catch {
      keyValid = false;
    }
  }
  const checks = {
    environmentValid: selected !== null,
    tokenConfigured: Boolean(environment.PAGBANK_TOKEN?.trim()),
    publicUrlValid: Boolean(publicUrl),
    webhookUrlValid: Boolean(webhookUrl),
    signatureModeValid: mode !== null,
    configuredWebhookKeyValid: keyValid,
  };
  const result: PagBankDiagnostic = {
    environment: selected || "invalid",
    signatureMode: mode || "invalid",
    webhookUrl,
    checks,
    valid: Object.values(checks).every(Boolean),
  };
  if (remote && result.valid && selected && webhookUrl) {
    let endpoint: "ok" | "unavailable" = "unavailable";
    try {
      const response = await fetcher(webhookUrl, {
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await pagBankSmallJson(response);
        if (
          data.status === PAGBANK_WEBHOOK_HEALTH.status &&
          data.service === PAGBANK_WEBHOOK_HEALTH.service &&
          data.notification_method === "POST"
        )
          endpoint = "ok";
      } else await response.body?.cancel().catch(() => undefined);
    } catch {}
    let key: unknown = null;
    if (environment.PAGBANK_WEBHOOK_PUBLIC_KEY?.trim())
      key = webhookPublicKey(environment.PAGBANK_WEBHOOK_PUBLIC_KEY);
    else
      key = await new PagBankWebhookKeys(fetcher).key(
        selected,
        environment.PAGBANK_TOKEN!.trim(),
      );
    result.remote = { endpoint, webhookKey: key ? "available" : "unavailable" };
    result.valid = endpoint === "ok" && (mode !== "ecdsa" || Boolean(key));
  }
  return result;
}
