import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { memoryFirestore } from "../../test/helpers/memoryFirestore.js";
import {
  changeEmailCampaign,
  createEmailCampaign,
  deleteEmailCampaign,
  updateEmailCampaign,
} from "./emailCampaigns.js";
import { previewEmailCampaign } from "./emailCampaignPreview.js";
import { campaignEmailMessage } from "./emailMessages.js";
import { renderEmailPreview } from "./resendEmailTemplates.js";
import { CATALOG_RETENTION_MS } from "../lib/catalogRetention.js";

const fields = {
  subject: "Oferta de novembro",
  text: "Cadernos personalizados\n\nConheça as novidades.",
  channel: "promotions",
};
const env = {
  APP_URL: "https://store.example.test",
  RESEND_API_KEY: "private-test-key",
  EMAIL_FROM: "no-reply@example.test",
  EMAIL_MARKETING_FROM: "promo@example.test",
  EMAIL_REPLY_TO: "suporte@example.test",
  EMAIL_UNSUBSCRIBE_SECRET: "s".repeat(64),
};
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
});
afterEach(() => {
  for (const [key, value] of Object.entries(previous))
    value === undefined ? delete process.env[key] : (process.env[key] = value);
});
const status = (expected: number) => (error: any) => error.status === expected;

test("editing replaces the existing draft, preserves its provenance and counters, and creates no send jobs", async () => {
  const { db, docs } = memoryFirestore();
  const draft = await createEmailCampaign(db, "creator", fields);
  const saved = await updateEmailCampaign(db, draft.id, "editor", {
    ...fields,
    subject: "Assunto revisado",
    text: "Mensagem nova",
    channel: "news",
    expectedRevision: draft.revision,
    status: "queued",
    createdBy: "forged",
    queuedCount: 100,
  });
  assert.equal(saved.id, draft.id);
  assert.notEqual(saved.revision, draft.revision);
  assert.equal(saved.subject, "Assunto revisado");
  assert.equal(saved.channel, "news");
  assert.equal(saved.text, "Mensagem nova");
  const stored = docs.get(`_emailCampaigns/${draft.id}`)!;
  assert.equal(stored.status, "draft");
  assert.equal(stored.createdBy, "creator");
  assert.equal(stored.createdAt, draft.createdAt);
  assert.equal(stored.queuedCount, 0);
  assert.equal(stored.updatedBy, "editor");
  assert.equal(
    [...docs.keys()].filter((key) => key.startsWith("_emailCampaigns/")).length,
    1,
  );
  assert.equal(
    [...docs.keys()].filter((key) => key.startsWith("_emailOutbox/")).length,
    0,
  );
});
test("two sessions cannot overwrite each other and stale deletion cannot remove the newer revision", async () => {
  const { db, docs } = memoryFirestore();
  const draft = await createEmailCampaign(db, "admin", fields);
  const attempts = await Promise.allSettled(
    ["A", "B"].map((subject) =>
      updateEmailCampaign(db, draft.id, "admin", {
        ...fields,
        subject,
        expectedRevision: draft.revision,
      }),
    ),
  );
  assert.equal(attempts.filter((row) => row.status === "fulfilled").length, 1);
  assert.ok(
    attempts.some(
      (row) => row.status === "rejected" && row.reason.status === 409,
    ),
  );
  await assert.rejects(
    deleteEmailCampaign(db, draft.id, draft.revision),
    status(409),
  );
  assert.ok(docs.has(`_emailCampaigns/${draft.id}`));
});
test("only drafts can be edited or deleted, including by a caller bypassing the UI", async () => {
  for (const phase of ["queued", "completed", "cancelled"]) {
    const { db, docs } = memoryFirestore();
    const draft = await createEmailCampaign(db, "admin", fields);
    docs.set(`_emailCampaigns/${draft.id}`, { ...draft, status: phase });
    await assert.rejects(
      updateEmailCampaign(db, draft.id, "admin", {
        ...fields,
        expectedRevision: draft.revision,
      }),
      status(409),
    );
    await assert.rejects(
      deleteEmailCampaign(db, draft.id, draft.revision),
      status(409),
    );
    assert.equal(docs.get(`_emailCampaigns/${draft.id}`)?.status, phase);
    assert.equal(
      [...docs.keys()].filter((key) => key.startsWith("_catalogTrash/")).length,
      0,
    );
  }
});
test("deletion removes a draft immediately, archives it privately for seven days and never creates email jobs", async () => {
  const { db, docs } = memoryFirestore();
  const draft = await createEmailCampaign(db, "admin", fields),
    before = Date.now();
  await deleteEmailCampaign(db, draft.id, draft.revision);
  assert.equal(docs.has(`_emailCampaigns/${draft.id}`), false);
  const archive = [...docs].find(([key]) =>
    key.startsWith("_catalogTrash/"),
  )![1];
  assert.equal(archive.source, `_emailCampaigns/${draft.id}`);
  assert.equal((archive.data as any).text, fields.text);
  assert.ok(Number(archive.cleanupAt) >= before + CATALOG_RETENTION_MS);
  assert.equal(
    Number(archive.cleanupAt) - Number(archive.removedAt),
    CATALOG_RETENTION_MS,
  );
  assert.equal(
    [...docs.keys()].filter((key) => key.startsWith("_emailOutbox/")).length,
    0,
  );
  await assert.rejects(
    deleteEmailCampaign(db, draft.id, draft.revision),
    status(404),
  );
});
test("legacy drafts without a revision can be edited once without an account migration", async () => {
  const { db, docs } = memoryFirestore();
  const draft = await createEmailCampaign(db, "admin", fields);
  const old: any = { ...draft };
  delete old.revision;
  docs.set(`_emailCampaigns/${draft.id}`, old);
  const saved = await updateEmailCampaign(db, draft.id, "admin", {
    ...fields,
    expectedRevision: null,
  });
  assert.ok(saved.revision);
  await assert.rejects(
    updateEmailCampaign(db, draft.id, "admin", {
      ...fields,
      expectedRevision: null,
    }),
    status(409),
  );
});
test("draft validation rejects missing revisions, invalid identifiers and invalid message content", async () => {
  const { db } = memoryFirestore();
  const draft = await createEmailCampaign(db, "admin", fields);
  for (const invalid of [
    { ...fields },
    { ...fields, expectedRevision: "bad" },
    { ...fields, subject: "A\nB", expectedRevision: draft.revision },
    { ...fields, text: "", expectedRevision: draft.revision },
    { ...fields, text: "a".repeat(10001), expectedRevision: draft.revision },
  ])
    await assert.rejects(
      updateEmailCampaign(db, draft.id, "admin", invalid),
      status(422),
    );
  await assert.rejects(
    deleteEmailCampaign(db, "../users", draft.revision),
    status(422),
  );
  await assert.rejects(
    deleteEmailCampaign(db, draft.id, undefined),
    status(422),
  );
});
test("sending an old reviewed revision is refused and a send racing with deletion has only one winner", async () => {
  const a = memoryFirestore();
  const draft = await createEmailCampaign(a.db, "admin", fields);
  const saved = await updateEmailCampaign(a.db, draft.id, "admin", {
    ...fields,
    text: "Nova oferta",
    expectedRevision: draft.revision,
  });
  await assert.rejects(
    changeEmailCampaign(a.db, draft.id, "admin", "queue", draft.revision),
    status(409),
  );
  const results = await Promise.allSettled([
    changeEmailCampaign(a.db, draft.id, "admin", "queue", saved.revision),
    deleteEmailCampaign(a.db, draft.id, saved.revision),
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(a.docs.get(`_emailCampaigns/${draft.id}`)?.status, "queued");
});
test("the preview is the exact sending HTML except for the recipient-specific unsubscribe URL", () => {
  const input = {
    ...fields,
    text: "Oferta <especial> & novidades\n\nhttps://store.example.test/promocoes",
  };
  const preview = previewEmailCampaign(input);
  const message = campaignEmailMessage(
    input.text,
    input.channel,
    "https://store.example.test/api/email/unsubscribe?token=PREVIA_LINK_INDIVIDUAL",
  );
  assert.equal(preview.html, renderEmailPreview("campaign", message));
  assert.equal(preview.subject, input.subject);
  assert.equal(preview.from, env.EMAIL_MARKETING_FROM);
  assert.equal(preview.replyTo, env.EMAIL_REPLY_TO);
  assert.match(preview.html, /gb-grafica-banner.png/);
  assert.match(preview.html, /Oferta &lt;especial&gt; &amp; novidades/);
  assert.doesNotMatch(preview.html, /private-test-key/);
});
test("previews allow empty new drafts but reject HTML injection, unsafe field types and oversized bodies", () => {
  assert.match(
    previewEmailCampaign({ ...fields, subject: "", text: "" }).html,
    /Novidades da GB Gráfica/,
  );
  assert.doesNotMatch(
    previewEmailCampaign({
      ...fields,
      text: '<script>bad()</script><img src=x onerror="bad()">',
    }).html,
    /<script>|<img src=x/,
  );
  for (const invalid of [
    null,
    { ...fields, text: {} },
    { ...fields, channel: "everyone" },
    { ...fields, subject: "x".repeat(161) },
  ])
    assert.throws(() => previewEmailCampaign(invalid), status(422));
});
