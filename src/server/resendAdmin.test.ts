import test from "node:test";
import assert from "node:assert/strict";
import {
  ResendAdmin,
  resendDomainName,
  inspectResendSenders,
} from "./resendAdmin.js";
import { resendTemplateDefinitions } from './resendEmailTemplates.js';
const id = "12345678-1234-1234-1234-123456789abc";
const pending = {
  id,
  name: "gblgrafica.com.br",
  status: "pending",
  capabilities: { sending: "enabled", receiving: "disabled" },
  records: [
    {
      type: "TXT",
      name: "resend._domainkey",
      value: "public-dkim",
      record: "DKIM",
      status: "pending",
    },
  ],
};

test('template setup plans by alias, creates missing versions and resumes unpublished drafts', async () => {
  const definitions = resendTemplateDefinitions.slice(0, 3);
  const draftId = '22345678-1234-1234-1234-123456789abc';
  const publishedId = '32345678-1234-1234-1234-123456789abc';
  const listing = { has_more: false, data: [
    { id: draftId, name: definitions[1].name, alias: definitions[1].alias, status: 'draft' },
    { id: publishedId, name: definitions[2].name, alias: definitions[2].alias, status: 'published' },
  ] };
  const plan = fixture([listing]);
  assert.deepEqual((await plan.client.setupTemplates(definitions)).map(item => item.status), ['criar e publicar', 'publicar', 'publicado']);
  assert.deepEqual(plan.calls.map(call => call.method), ['GET']);

  const apply = fixture([listing, { id }, { id }, { id: draftId }]);
  const published = await apply.client.setupTemplates(definitions, true);
  assert.deepEqual(published.map(item => item.id), [id, draftId, publishedId]);
  assert.ok(published.every(item => item.status === 'publicado'));
  assert.deepEqual(apply.calls.map(call => [call.method, new URL(call.url).pathname]), [
    ['GET', '/templates'], ['POST', '/templates'], ['POST', `/templates/${id}/publish`], ['POST', `/templates/${draftId}/publish`],
  ]);
  assert.deepEqual(apply.calls[1].body, definitions[0]);
});
function fixture(responses: unknown[]) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const fetcher: typeof fetch = async (url, options) => {
    calls.push({
      url: String(url),
      method: options?.method || "GET",
      body: options?.body ? JSON.parse(String(options.body)) : undefined,
    });
    assert.equal(options?.redirect, "error");
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      "Bearer test-admin-key",
    );
    assert.ok(responses.length, "unexpected API request");
    const value = responses.shift();
    if (value instanceof Error) throw value;
    return value instanceof Response ? value : Response.json(value);
  };
  return {
    calls,
    client: new ResendAdmin("test-admin-key", fetcher, async () => {}),
  };
}
test("domain planning is GET-only and validates names before contacting the provider", async () => {
  const { client, calls } = fixture([{ data: [], has_more: false }]);
  assert.equal(
    (await client.setupDomain("GBLGRAFICA.COM.BR")).action,
    "create",
  );
  assert.deepEqual(
    calls.map((x) => x.method),
    ["GET"],
  );
  for (const name of [
    "https://example.com",
    "mail@example.com",
    "../example.com",
    "a\nb.com",
    "-bad.com",
  ])
    await assert.rejects(client.setupDomain(name));
  assert.equal(calls.length, 1);
  assert.equal(resendDomainName(" gblgrafica.com.br "), "gblgrafica.com.br");
});
test("existing domains expose their actual DNS records without creating a duplicate", async () => {
  const { client, calls } = fixture([{ data: [pending] }, pending]);
  const result = await client.setupDomain(pending.name);
  assert.equal(result.action, "verify");
  assert.equal(result.domain?.records?.[0].value, "public-dkim");
  assert.deepEqual(
    calls.map((x) => x.method),
    ["GET", "GET"],
  );
});
test("apply creates sending-only domain once and requests asynchronous verification without claiming readiness", async () => {
  const { client, calls } = fixture([
    { data: [] },
    { id },
    pending,
    { id },
    pending,
  ]);
  const result = await client.setupDomain(pending.name, true);
  assert.equal(result.action, "pending-dns");
  assert.equal(result.created, true);
  assert.deepEqual(calls[1].body, {
    name: pending.name,
    capabilities: { sending: "enabled", receiving: "disabled" },
  });
  assert.equal(calls[3].url, `https://api.resend.com/domains/${id}/verify`);
  assert.deepEqual(
    calls.map((x) => x.method),
    ["GET", "POST", "GET", "POST", "GET"],
  );
  assert.ok(calls.every((x) => !x.url.includes("/emails")));
});
test("rerunning apply on a verified domain is read-only; disabled sending is never changed implicitly", async () => {
  const ready = { ...pending, status: "verified" },
    a = fixture([{ data: [ready] }, ready]);
  assert.equal(
    (await a.client.setupDomain(pending.name, true)).action,
    "ready",
  );
  assert.ok(a.calls.every((x) => x.method === "GET"));
  const disabled = { ...ready, capabilities: { sending: "disabled" } },
    b = fixture([{ data: [disabled] }, disabled]);
  await assert.rejects(b.client.setupDomain(pending.name, true), /desativado/);
  assert.ok(b.calls.every((x) => x.method === "GET"));
});
test("sender inspection uses exact domains, shares domain lookups and reports missing domains", async () => {
  const ready = { ...pending, status: "verified" },
    { client, calls } = fixture([{ data: [ready] }, ready]);
  const rows = await inspectResendSenders(client, {
    EMAIL_FROM: "no-reply@gblgrafica.com.br",
    EMAIL_MARKETING_FROM: "promo@gblgrafica.com.br",
    OTHER: "a@other.test",
  });
  assert.deepEqual(
    rows.map((x) => x.sending),
    [true, true, false],
  );
  assert.equal(calls.length, 2);
});
test("pagination follows the provider cursor and rejects repeated pages instead of guessing absence", async () => {
  const { client, calls } = fixture([
    { data: [pending], has_more: true },
    { data: [pending], has_more: true },
  ]);
  await assert.rejects(client.listDomains(), /Paginação/);
  assert.match(calls[1].url, new RegExp(`after=${id}`));
});
test("provider errors hide response bodies and ambiguous mutations are not retried automatically", async () => {
  const denied = fixture([
    new Response("private response test-admin-key", { status: 403 }),
  ]);
  await assert.rejects(
    denied.client.listDomains(),
    (error) =>
      /Full access/.test(String(error)) &&
      !String(error).includes("test-admin-key"),
  );
  const a = fixture([{ data: [] }, new Error("secret transport contents")]);
  await assert.rejects(
    a.client.setupDomain(pending.name, true),
    (error) =>
      /diagnóstico/.test(String(error)) &&
      !String(error).includes("secret transport"),
  );
  assert.equal(a.calls.length, 2);
});
