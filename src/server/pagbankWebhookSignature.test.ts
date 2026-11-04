import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  PagBankWebhookKeys,
  webhookPublicKey,
  webhookSignatures,
  verifyWebhookPayload,
} from "./pagbankWebhookSignature.js";
const pair = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const encoded = (key: ReturnType<typeof pair>["publicKey"]) =>
  key.export({ format: "der", type: "spki" }).toString("base64");
const raw = Buffer.from('{"reference_id":"GB-1234567890","nome":"João"}');
const signed = (key: ReturnType<typeof pair>["privateKey"], body = raw) =>
  sign("sha256", body, key).toString("base64");
test("ECDSA verifies exact UTF-8 bytes, accepts multiple signatures during rotation and refuses RSA/private keys", () => {
  const key = pair(),
    other = pair(),
    header = signed(other.privateKey) + ", " + signed(key.privateKey);
  assert.equal(
    verifyWebhookPayload(
      raw,
      webhookSignatures(header),
      webhookPublicKey(encoded(key.publicKey)),
    ),
    true,
  );
  assert.equal(
    verifyWebhookPayload(
      Buffer.concat([raw, Buffer.from(" ")]),
      webhookSignatures(header),
      key.publicKey,
    ),
    false,
  );
  assert.equal(
    verifyWebhookPayload(
      raw,
      webhookSignatures([signed(other.privateKey), signed(key.privateKey)]),
      key.publicKey,
    ),
    true,
  );
  assert.equal(
    verifyWebhookPayload(raw, webhookSignatures("not-base64"), key.publicKey),
    false,
  );
  assert.throws(() =>
    webhookPublicKey(
      generateKeyPairSync("rsa", { modulusLength: 2048 })
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    ),
  );
  assert.throws(() =>
    webhookPublicKey(
      key.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    ),
  );
});
test("concurrent webhooks share one authenticated GET, cache is separated by environment and token, and key rotation refreshes", async () => {
  const old = pair(),
    renewed = pair();
  let count = 0,
    now = 100000;
  const calls: any[] = [];
  const keys = new PagBankWebhookKeys(
    async (input, init) => {
      calls.push([String(input), init]);
      count++;
      return new Response(
        JSON.stringify({
          public_key: encoded(count === 1 ? old.publicKey : renewed.publicKey),
          links: [{ href: "https://untrusted.test/key" }],
        }),
      );
    },
    () => now,
  );
  const input = {
    rawBody: raw,
    header: signed(old.privateKey),
    environment: "production" as const,
    token: "private-token",
  };
  assert.ok(
    (
      await Promise.all(Array.from({ length: 12 }, () => keys.verify(input)))
    ).every((v) => v === "valid"),
  );
  assert.equal(count, 1);
  now += 31000;
  assert.equal(
    await keys.verify({ ...input, header: signed(renewed.privateKey) }),
    "valid",
  );
  assert.equal(count, 2);
  await keys.key("sandbox", "private-token");
  await keys.key("production", "another-token");
  assert.equal(count, 4);
  assert.equal(calls[0][0], "https://api.pagseguro.com/public-keys/webhook");
  assert.equal(
    calls[2][0],
    "https://sandbox.api.pagseguro.com/public-keys/webhook",
  );
  for (const [url, init] of calls) {
    assert.equal(init.redirect, "error");
    assert.equal(init.method || "GET", "GET");
    assert.match(url, /^https:\/\/(?:sandbox\.)?api\.pagseguro\.com\//);
    assert.ok(init.headers.Authorization.startsWith("Bearer "));
  }
});
test("only the documented alternative key path is tried on 404 and redirects, invalid keys and oversized replies fail closed", async () => {
  const key = pair(),
    urls: string[] = [];
  const resolver = new PagBankWebhookKeys(async (url) => {
    urls.push(String(url));
    return urls.length === 1
      ? new Response("", { status: 404 })
      : new Response(JSON.stringify({ public_key: encoded(key.publicKey) }));
  });
  assert.equal(
    await resolver.verify({
      rawBody: raw,
      header: signed(key.privateKey),
      environment: "production",
      token: "test",
    }),
    "valid",
  );
  assert.deepEqual(urls, [
    "https://api.pagseguro.com/public-keys/webhook",
    "https://api.pagseguro.com/public-keys?type=webhook",
  ]);
  for (const response of [
    new Response("", {
      status: 302,
      headers: { Location: "https://untrusted.test" },
    }),
    new Response(JSON.stringify({ public_key: "invalid" })),
    new Response("a".repeat(17000)),
  ]) {
    const result = await new PagBankWebhookKeys(async () => response).verify({
      rawBody: raw,
      header: signed(key.privateKey),
      environment: "production",
      token: "test",
    });
    assert.equal(result, "unavailable");
  }
});
test("invalid headers never trigger provider reads; unavailable keys are throttled and static public keys require no network", async () => {
  let calls = 0,
    now = 100000;
  const key = pair(),
    resolver = new PagBankWebhookKeys(
      () => {
        calls++;
        throw new Error("secret upstream details");
      },
      () => now,
    );
  const input = {
    rawBody: raw,
    environment: "production" as const,
    token: "private-secret",
  };
  for (const header of [
    undefined,
    "bad",
    [],
    Array(17).fill(signed(key.privateKey)),
    "a".repeat(8193),
  ])
    assert.equal(await resolver.verify({ ...input, header }), "invalid");
  assert.equal(calls, 0);
  assert.equal(
    await resolver.verify({ ...input, header: signed(key.privateKey) }),
    "unavailable",
  );
  assert.equal(
    await resolver.verify({ ...input, header: signed(key.privateKey) }),
    "unavailable",
  );
  assert.equal(calls, 1);
  now += 31000;
  await resolver.verify({ ...input, header: signed(key.privateKey) });
  assert.equal(calls, 2);
  assert.equal(
    await resolver.verify({
      ...input,
      header: signed(key.privateKey),
      publicKey: encoded(key.publicKey),
    }),
    "valid",
  );
  assert.equal(calls, 2);
});
