import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { checkPagBankConfiguration } from "./pagbankDiagnostics.js";
import {
  pagBankPublicUrl,
  pagBankWebhookUrl,
  PAGBANK_WEBHOOK_HEALTH,
} from "./pagbankConfiguration.js";
const env = {
  PAGBANK_ENV: "production",
  PAGBANK_TOKEN: "private-token",
  APP_URL: "https://loja.example.test",
  NODE_ENV: "production",
};
test("local diagnosis never calls a provider, excludes credentials and validates real callback requirements", async () => {
  const result = await checkPagBankConfiguration(env, false, async () =>
    assert.fail("no network"),
  );
  assert.equal(result.valid, true);
  assert.equal(
    result.webhookUrl,
    "https://loja.example.test/api/webhook/pagbank",
  );
  assert.equal(JSON.stringify(result).includes("private-token"), false);
  for (const bad of [
    { PAGBANK_ENV: "prod" },
    { PAGBANK_TOKEN: "" },
    { APP_URL: "http://loja.example.test" },
    { APP_URL: "https://user:password@loja.example.test" },
    { APP_URL: "https://loja.example.test?token=secret" },
    { PAGBANK_WEBHOOK_SIGNATURE_MODE: "disabled" },
    { PAGBANK_WEBHOOK_PUBLIC_KEY: "not-a-key" },
  ])
    assert.equal(
      (await checkPagBankConfiguration({ ...env, ...bad })).valid,
      false,
      JSON.stringify(bad),
    );
  assert.equal(
    pagBankPublicUrl("http://127.0.0.1:3000/", false),
    "http://127.0.0.1:3000",
  );
  assert.throws(() => pagBankPublicUrl("http://other-host", false));
  assert.throws(() =>
    pagBankWebhookUrl("https://" + "a".repeat(100) + ".test"),
  );
});
test("remote diagnosis uses GET only, sends account token only to PagBank, and distinguishes optional legacy key from strict ECDSA", async () => {
  const calls: any[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push([String(url), init]);
    return String(url).includes("loja.example.test")
      ? new Response(JSON.stringify(PAGBANK_WEBHOOK_HEALTH))
      : new Response("", { status: 404 });
  };
  let result = await checkPagBankConfiguration(env, true, fetcher);
  assert.equal(result.valid, true);
  assert.equal(result.remote?.webhookKey, "unavailable");
  assert.equal(calls[0][1].headers.Authorization, undefined);
  result = await checkPagBankConfiguration(
    { ...env, PAGBANK_WEBHOOK_SIGNATURE_MODE: "ecdsa" },
    true,
    fetcher,
  );
  assert.equal(result.valid, false);
  assert.ok(
    calls.every(
      ([, init]) =>
        (init.method || "GET") === "GET" && init.redirect === "error",
    ),
  );
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    .publicKey.export({ format: "der", type: "spki" })
    .toString("base64");
  result = await checkPagBankConfiguration(
    {
      ...env,
      PAGBANK_WEBHOOK_SIGNATURE_MODE: "ecdsa",
      PAGBANK_WEBHOOK_PUBLIC_KEY: key,
    },
    true,
    async () => new Response(JSON.stringify(PAGBANK_WEBHOOK_HEALTH)),
  );
  assert.equal(result.valid, true);
  assert.equal(
    (
      await checkPagBankConfiguration(
        env,
        true,
        async () => new Response("spa html"),
      )
    ).valid,
    false,
  );
});
