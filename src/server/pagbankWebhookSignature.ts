import {
  createHash,
  createPublicKey,
  verify,
  type KeyObject,
} from "node:crypto";
import {
  pagBankBaseUrl,
  type PagBankEnvironment,
} from "./pagbankConfiguration.js";
const MAX_KEY_BYTES = 16384;
const CACHE_MS = 15 * 60_000;
const REFRESH_MS = 30_000;
export function webhookPublicKey(value: string): KeyObject {
  const normalized = value.trim().replace(/\\n/g, "\n");
  if (!normalized || Buffer.byteLength(normalized) > MAX_KEY_BYTES)
    throw new Error("Chave pública de webhook inválida.");
  let key: KeyObject;
  if (normalized.startsWith("-----BEGIN PUBLIC KEY-----"))
    key = createPublicKey(normalized);
  else {
    const encoded = normalized.replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
      throw new Error("Chave pública de webhook inválida.");
    key = createPublicKey({
      key: Buffer.from(encoded, "base64"),
      type: "spki",
      format: "der",
    });
  }
  if (key.asymmetricKeyType !== "ec")
    throw new Error(
      "A chave de webhook precisa ser EC; uma chave de cartão RSA não é intercambiável.",
    );
  return key;
}
export function webhookSignatures(header: unknown): Buffer[] {
  if (
    !(
      typeof header === "string" ||
      (Array.isArray(header) && header.every((v) => typeof v === "string"))
    )
  )
    return [];
  const joined = typeof header === "string" ? header : header.join(",");
  if (joined.length > 8192) return [];
  const values = joined.split(",");
  if (values.length > 16) return [];
  return values.flatMap((value) => {
    const text = value.trim();
    if (
      text.length > 512 ||
      text.length % 4 === 1 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(text)
    )
      return [];
    const bytes = Buffer.from(text, "base64");
    return bytes.length >= 8 &&
      bytes.length <= 256 &&
      bytes.toString("base64").replace(/=+$/, "") === text.replace(/=+$/, "")
      ? [bytes]
      : [];
  });
}
export function verifyWebhookPayload(
  raw: string | Buffer,
  signatures: Buffer[],
  key: KeyObject,
): boolean {
  if (!raw.length || !signatures.length) return false;
  return signatures.some((signature) => {
    try {
      return verify(
        "sha256",
        Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8"),
        key,
        signature,
      );
    } catch {
      return false;
    }
  });
}
export async function pagBankSmallJson(response: Response): Promise<any> {
  if (!response.body) throw new Error("Resposta vazia.");
  const reader = response.body.getReader();
  let size = 0;
  const parts: Buffer[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_KEY_BYTES) throw new Error("Resposta excede o limite.");
      parts.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
interface CacheEntry {
  key: KeyObject | null;
  expiresAt: number;
  refreshAfter: number;
  pending?: Promise<KeyObject | null>;
}
export class PagBankWebhookKeys {
  private entries = new Map<string, CacheEntry>();
  constructor(
    private fetcher: typeof fetch = fetch,
    private clock: () => number = Date.now,
  ) {}
  async key(
    environment: PagBankEnvironment,
    token: string,
    force = false,
  ): Promise<KeyObject | null> {
    if (!token) return null;
    const id = `${environment}:${createHash("sha256").update(token).digest("hex")}`;
    let entry = this.entries.get(id);
    if (!entry) {
      if (this.entries.size >= 8) this.entries.clear();
      entry = { key: null, expiresAt: 0, refreshAfter: 0 };
      this.entries.set(id, entry);
    }
    if (entry.pending) return entry.pending;
    if (
      (!force && entry.expiresAt > this.clock()) ||
      entry.refreshAfter > this.clock()
    )
      return entry.expiresAt > this.clock() ? entry.key : null;
    entry.refreshAfter = this.clock() + REFRESH_MS;
    const target = entry;
    target.pending = (async () => {
      try {
        // Both formats are documented by PagBank. Only fixed paths on the selected official host; no redirects.
        let response = await this.fetcher(
          `${pagBankBaseUrl(environment)}/public-keys/webhook`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
            redirect: "error",
            signal: AbortSignal.timeout(4000),
          },
        );
        if ([404, 405].includes(response.status)) {
          await response.body?.cancel().catch(() => undefined);
          response = await this.fetcher(
            `${pagBankBaseUrl(environment)}/public-keys?type=webhook`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
              },
              redirect: "error",
              signal: AbortSignal.timeout(4000),
            },
          );
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          return target.expiresAt > this.clock() ? target.key : null;
        }
        const value = await pagBankSmallJson(response);
        if (typeof value.public_key !== "string") return null;
        const key = webhookPublicKey(value.public_key);
        target.key = key;
        target.expiresAt = this.clock() + CACHE_MS;
        return key;
      } catch {
        return target.expiresAt > this.clock() ? target.key : null;
      }
    })();
    const pending = target.pending;
    void pending.then(() => {
      if (target.pending === pending) target.pending = undefined;
    });
    return pending;
  }
  async verify(input: {
    rawBody: string | Buffer;
    header: unknown;
    environment: PagBankEnvironment;
    token: string;
    publicKey?: string;
  }): Promise<"valid" | "invalid" | "unavailable"> {
    const signatures = webhookSignatures(input.header);
    if (!input.rawBody?.length || !signatures.length) return "invalid";
    if (input.publicKey?.trim()) {
      try {
        return verifyWebhookPayload(
          input.rawBody,
          signatures,
          webhookPublicKey(input.publicKey),
        )
          ? "valid"
          : "invalid";
      } catch {
        return "unavailable";
      }
    }
    let key = await this.key(input.environment, input.token);
    if (!key) return "unavailable";
    if (verifyWebhookPayload(input.rawBody, signatures, key)) return "valid";
    key = await this.key(input.environment, input.token, true);
    return key && verifyWebhookPayload(input.rawBody, signatures, key)
      ? "valid"
      : "invalid";
  }
}
