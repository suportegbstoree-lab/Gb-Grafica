import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import app from "./app.js";
import { PAGBANK_WEBHOOK_HEALTH } from "./pagbankConfiguration.js";
test("public endpoint diagnoses routing; POST validates new signatures without falling back to a legacy signature or trusting payment data", async () => {
  const keys = [
      "PAGBANK_TOKEN",
      "PAGBANK_ENV",
      "PAGBANK_WEBHOOK_SIGNATURE_MODE",
      "PAGBANK_WEBHOOK_PUBLIC_KEY",
      "LOG_LEVEL",
    ] as const,
    previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  Object.assign(process.env, {
    PAGBANK_TOKEN: "private-test-token",
    PAGBANK_ENV: "production",
    PAGBANK_WEBHOOK_SIGNATURE_MODE: "auto",
    PAGBANK_WEBHOOK_PUBLIC_KEY: pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
    LOG_LEVEL: "silent",
  });
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/webhook/pagbank`;
  const request = (body: string, headers: Record<string, string> = {}) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });
  try {
    const health = await fetch(url);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), PAGBANK_WEBHOOK_HEALTH);
    assert.match(health.headers.get("cache-control") || "", /no-store/);
    const body = "{}",
      signature = sign("sha256", Buffer.from(body), pair.privateKey).toString(
        "base64",
      ),
      legacy = createHash("sha256")
        .update(`private-test-token-${body}`)
        .digest("hex");
    let response = await request(body, { "x-payload-signature": signature });
    assert.equal(
      response.status,
      400,
      "valid crypto still requires a valid order event",
    );
    response = await request(body, {
      "x-payload-signature": "invalid",
      "x-authenticity-token": legacy,
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "WEBHOOK_SIGNATURE_INVALID");
    response = await request(body + " ", { "x-payload-signature": signature });
    assert.equal(response.status, 401, "signature covers original bytes");
    process.env.PAGBANK_WEBHOOK_SIGNATURE_MODE = "ecdsa";
    response = await request(body, { "x-authenticity-token": legacy });
    assert.equal(
      response.status,
      401,
      "strict mode refuses missing ECDSA even with valid legacy hash",
    );
    process.env.PAGBANK_WEBHOOK_SIGNATURE_MODE = "bad";
    assert.equal((await request(body)).status, 503);
    process.env.PAGBANK_ENV = "prod";
    assert.equal((await request(body)).status, 503);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    for (const k of keys) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
  }
});
