import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import type { UserRecord } from 'firebase-admin/auth';
import { memoryFirestore } from '../../test/helpers/memoryFirestore';
import { emailConfiguration, readEmailPreferences, saveEmailPreferences, unsubscribeEmail, unsubscribeToken } from './emailPreferences';
import { EMAIL_CONSENT_VERSION } from '../lib/email';
import { prepareWelcomeEmail, queueOrderStatusEmail, sendCustomerEmail } from './customerEmails';
import { createEmailCampaign, changeEmailCampaign, expandEmailCampaign, dispatchCustomerEmails } from './emailCampaigns';
const env = { RESEND_API_KEY: 'test-key', RESEND_USE_HOSTED_TEMPLATES: 'false', EMAIL_FROM: 'store@example.test', EMAIL_MARKETING_FROM: '', EMAIL_REPLY_TO: '', APP_URL: 'https://store.example.test', EMAIL_UNSUBSCRIBE_SECRET: 'test-only-secret-'.repeat(4) };
const old = new Map(Object.keys(env).map(key => [key, process.env[key]]));
beforeEach(() => Object.assign(process.env, env));
after(() => { for (const [key, value] of old) value === undefined ? delete process.env[key] : process.env[key] = value; });
const account = (uid = 'alice'): UserRecord => ({ uid, email: `${uid}@example.test`, emailVerified: true, disabled: false, displayName: 'Alice', metadata: { creationTime: new Date().toISOString() } } as UserRecord);
const auth = { getUser: async (uid: string) => account(uid) };
const consent = (promotions = true, news = false, revision: string | null = null) => ({ promotions, news, expectedRevision: revision, consentVersion: EMAIL_CONSENT_VERSION });
const accepted = (bodies: any[] = []) => (async (_url: any, options: any) => { bodies.push(JSON.parse(options.body)); return new Response(JSON.stringify({ id: 'provider-id' }), { status: 200 }); }) as typeof fetch;

test('campaigns use their own sender and support reply address while transactional emails keep the default', async () => {
  process.env.EMAIL_MARKETING_FROM = 'promo@example.test'; process.env.EMAIL_REPLY_TO = 'suporte@example.test';
  const { db, docs } = memoryFirestore(), bodies: any[] = [];
  await saveEmailPreferences(db, account(), consent());
  const campaign = await createEmailCampaign(db, 'admin', { channel: 'promotions', subject: 'Oferta', text: 'Conteúdo' });
  await changeEmailCampaign(db, campaign.id, 'admin', 'queue'); await expandEmailCampaign(db, campaign.id);
  const id = [...docs.keys()].find(path => path.startsWith('_emailOutbox/'))!.split('/')[1];
  await sendCustomerEmail(db, auth, id, accepted(bodies));
  assert.equal(bodies[0].from, 'promo@example.test'); assert.equal(bodies[0].reply_to, 'suporte@example.test');
  await sendCustomerEmail(db, auth, (await prepareWelcomeEmail(db, account()))!, accepted(bodies));
  assert.equal(bodies[1].from, 'store@example.test'); assert.equal(bodies[1].reply_to, 'suporte@example.test');
  process.env.EMAIL_MARKETING_FROM = 'invalid';
  assert.equal(emailConfiguration().configured, true); assert.equal(emailConfiguration().marketingConfigured, false);
});

test('hosted campaigns preserve unsubscribe and the exact request across retry after a setting change', async () => {
  process.env.RESEND_USE_HOSTED_TEMPLATES = 'true';
  process.env.EMAIL_MARKETING_FROM = 'promo@example.test';
  const { db, docs } = memoryFirestore(), requests: RequestInit[] = [];
  await saveEmailPreferences(db, account(), consent());
  const campaign = await createEmailCampaign(db, 'admin', { channel: 'promotions', subject: 'Oferta', text: 'Oferta <especial> & novidades' });
  await changeEmailCampaign(db, campaign.id, 'admin', 'queue'); await expandEmailCampaign(db, campaign.id);
  const id = [...docs.keys()].find(path => path.startsWith('_emailOutbox/'))!.split('/')[1];
  const now = Date.now();
  const fetcher: typeof fetch = async (_url, options) => {
    requests.push(options!);
    return requests.length === 1 ? Response.json({}, { status: 503 }) : Response.json({ id: 'provider-id' });
  };
  assert.equal(await sendCustomerEmail(db, auth, id, fetcher, now), 'pending');
  process.env.RESEND_USE_HOSTED_TEMPLATES = 'false';
  assert.equal(await sendCustomerEmail(db, auth, id, fetcher, now + 16 * 60000), 'accepted');
  assert.equal(requests[0].body, requests[1].body);
  assert.deepEqual(requests[0].headers, requests[1].headers);
  const body = JSON.parse(String(requests[0].body));
  assert.equal(body.from, 'promo@example.test');
  assert.equal(body.html, undefined); assert.equal(body.text, undefined);
  assert.match(body.template.id, /^gb-campaign-[a-f0-9]{12}$/);
  assert.match(body.template.variables.GB_MESSAGE_HTML, /Oferta &lt;especial&gt; &amp; novidades/);
  assert.match(body.template.variables.GB_MESSAGE_TEXT, /Oferta <especial> & novidades/);
  assert.match(body.headers['List-Unsubscribe'], /\/api\/email\/unsubscribe\?token=/);
  assert.equal(body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('optional email is off by default, explicit verified consent is versioned, and stale writes cannot undo opt-out', async () => {
  const { db } = memoryFirestore(); assert.deepEqual(await readEmailPreferences(db, account()), { promotions: false, news: false, revision: null, emailVerified: true });
  await assert.rejects(saveEmailPreferences(db, { ...account(), emailVerified: false } as UserRecord, consent()), (e: any) => e.status === 403);
  await assert.rejects(saveEmailPreferences(db, account(), { ...consent(), consentVersion: undefined }), (e: any) => e.status === 422);
  const saved = await saveEmailPreferences(db, account(), consent()); assert.equal(saved.promotions, true); assert.equal(saved.news, false);
  const token = unsubscribeToken('alice', 'alice@example.test');
  await unsubscribeEmail(db, token, false); assert.equal((await readEmailPreferences(db, account())).promotions, true, 'GET/scanners do not opt out');
  await unsubscribeEmail(db, token, true); assert.equal((await readEmailPreferences(db, account())).promotions, false);
  await assert.rejects(saveEmailPreferences(db, account(), consent(true, false, saved.revision)), (e: any) => e.status === 409);
  await assert.rejects(unsubscribeEmail(db, token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'), true));
});
test('welcome is queued once only for a new verified account, not retroactively for existing users', async () => {
  const { db, docs } = memoryFirestore(), bodies: any[] = [];
  const id = await prepareWelcomeEmail(db, account()); await prepareWelcomeEmail(db, account()); assert.equal(docs.size, 1);
  await Promise.all([sendCustomerEmail(db, auth, id!, accepted(bodies)), sendCustomerEmail(db, auth, id!, accepted(bodies))]); assert.equal(bodies.length, 1); assert.match(bodies[0].subject, /Boas-vindas/);
  const older = { ...account('old'), metadata: { creationTime: '2020-01-01' } } as UserRecord;
  const oldId = await prepareWelcomeEmail(db, older); assert.equal(docs.get(`_emailOutbox/${oldId}`)?.status, 'skipped');
  assert.equal(await prepareWelcomeEmail(db, { ...account('unverified'), emailVerified: false } as UserRecord), null);
});
test('order changes and emails commit atomically and no-op events create no duplicate message', async () => {
  const before = { userId: 'alice', paymentStatus: 'pendente', fulfillmentStatus: 'aguardando_pagamento' };
  const { db, docs } = memoryFirestore([['orders/order', before]]);
  await db.runTransaction(async tx => { const ref = db.collection('orders').doc('order'), current = (await tx.get(ref)).data(); const patch = { paymentStatus: 'pago', fulfillmentStatus: 'pagamento_confirmado' }; tx.set(ref, patch, { merge: true }); queueOrderStatusEmail(tx, db, 'order', current, patch); });
  assert.equal(docs.get('orders/order')?.emailNotificationRevision, 1);
  const bodies: any[] = []; await sendCustomerEmail(db, auth, 'order-order-1', accepted(bodies)); assert.match(bodies[0].subject, /Pagamento confirmado/);
  await db.runTransaction(async tx => { const current = (await tx.get(db.collection('orders').doc('order'))).data(); queueOrderStatusEmail(tx, db, 'order', current, {}); });
  assert.equal([...docs.keys()].filter(key => key.startsWith('_emailOutbox/')).length, 1);
  await assert.rejects(db.runTransaction(async tx => { queueOrderStatusEmail(tx, db, 'order', docs.get('orders/order'), { fulfillmentStatus: 'enviado' }); throw new Error('rollback'); }));
  assert.equal(docs.has('_emailOutbox/order-order-2'), false);
});
test('campaigns select the right opt-in, ignore later subscriptions, and freeze a deduplicated recipient page', async () => {
  const { db, docs } = memoryFirestore(); await saveEmailPreferences(db, account(), consent(true, false)); await saveEmailPreferences(db, account('bob'), consent(false, true));
  const campaign = await createEmailCampaign(db, 'admin', { channel: 'promotions', subject: 'Oferta', text: 'Mensagem' });
  await changeEmailCampaign(db, campaign.id, 'admin', 'queue'); await changeEmailCampaign(db, campaign.id, 'admin', 'queue');
  docs.set('_emailPreferences/later', { uid: 'later', email: 'later@example.test', promotions: true, promotionsSince: '9999-01-01' });
  assert.equal(await expandEmailCampaign(db, campaign.id), 1); assert.equal(await expandEmailCampaign(db, campaign.id), 0);
  const jobs = [...docs].filter(([path]) => path.startsWith('_emailOutbox/')); assert.equal(jobs.length, 1); assert.equal(jobs[0][1].uid, 'alice');
  const bodies: any[] = []; await sendCustomerEmail(db, auth, jobs[0][0].split('/')[1], accepted(bodies));
  assert.match(bodies[0].text, /Descadastrar:/); assert.equal(bodies[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(docs.get(`_emailCampaigns/${campaign.id}`)?.status, 'completed');
});
test('an opt-out or campaign cancellation before dispatch suppresses queued messages', async () => {
  for (const mode of ['unsubscribe', 'cancel']) {
    const { db, docs } = memoryFirestore(); await saveEmailPreferences(db, account(), consent());
    const campaign = await createEmailCampaign(db, 'admin', { channel: 'promotions', subject: 'Oferta', text: 'Mensagem' }); await changeEmailCampaign(db, campaign.id, 'admin', 'queue'); await expandEmailCampaign(db, campaign.id);
    if (mode === 'unsubscribe') await unsubscribeEmail(db, unsubscribeToken('alice', 'alice@example.test'), true); else await changeEmailCampaign(db, campaign.id, 'admin', 'cancel');
    const job = [...docs.keys()].find(key => key.startsWith('_emailOutbox/'))!; const bodies: any[] = [];
    assert.equal(await sendCustomerEmail(db, auth, job.split('/')[1], accepted(bodies)), 'skipped'); assert.equal(bodies.length, 0);
  }
});
test('retries retain the exact payload and idempotency key, back off, and stop after the provider window', async () => {
  process.env.EMAIL_REPLY_TO = 'suporte@example.test';
  const { db, docs } = memoryFirestore(), id = (await prepareWelcomeEmail(db, account()))!, calls: any[] = [], start = Date.now();
  const fail = (async (_url: any, options: any) => { calls.push(options); throw new Error('timeout'); }) as typeof fetch;
  assert.equal(await sendCustomerEmail(db, auth, id, fail, start), 'pending');
  assert.equal(await sendCustomerEmail(db, auth, id, fail, start + 1000), 'pending'); assert.equal(calls.length, 1);
  process.env.EMAIL_FROM = 'changed@example.test';
  process.env.EMAIL_REPLY_TO = 'changed-support@example.test';
  assert.equal(await sendCustomerEmail(db, auth, id, fail, start + 16 * 60000), 'pending'); assert.equal(calls[0].body, calls[1].body); assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  assert.equal(JSON.parse(calls[0].body).reply_to, 'suporte@example.test');
  assert.equal(await sendCustomerEmail(db, auth, id, fail, start + 24 * 60 * 60000), 'needs_review'); assert.equal(calls.length, 2); assert.equal(docs.get(`_emailOutbox/${id}`)?.nextAttemptAt, undefined);
});
test('changed or disabled account email never inherits optional consent', async () => {
  const { db, docs } = memoryFirestore(); await saveEmailPreferences(db, account(), consent());
  const campaign = await createEmailCampaign(db, 'admin', { channel: 'promotions', subject: 'Oferta', text: 'Mensagem' }); await changeEmailCampaign(db, campaign.id, 'admin', 'queue'); await expandEmailCampaign(db, campaign.id);
  const job = [...docs.keys()].find(key => key.startsWith('_emailOutbox/'))!.split('/')[1], bodies: any[] = [];
  const changed = { ...account(), email: 'different@example.test' } as UserRecord;
  assert.equal((await readEmailPreferences(db, changed)).promotions, false);
  assert.equal(await sendCustomerEmail(db, { getUser: async () => changed }, job, accepted(bodies)), 'skipped'); assert.equal(bodies.length, 0);
});
test('campaign fanout advances past a full page and concurrent dispatch leases cannot double-send', async () => {
  const { db, docs } = memoryFirestore();
  for (let index = 0; index < 105; index++) { const uid = `user${String(index).padStart(3, '0')}`; docs.set(`_emailPreferences/${uid}`, { uid, email: `${uid}@example.test`, promotions: true, promotionsSince: '2020-01-01' }); }
  const campaign = await createEmailCampaign(db, 'admin', { channel: 'promotions', subject: 'Oferta', text: 'Mensagem' }); await changeEmailCampaign(db, campaign.id, 'admin', 'queue');
  assert.equal(await expandEmailCampaign(db, campaign.id), 100); assert.equal(await expandEmailCampaign(db, campaign.id), 5); assert.equal(await expandEmailCampaign(db, campaign.id), 0);
  const bodies: any[] = []; const results = await Promise.all([dispatchCustomerEmails(db, auth, accepted(bodies), async () => {}), dispatchCustomerEmails(db, auth, accepted(bodies), async () => {})]);
  assert.equal(results.filter(result => result.busy).length, 1); assert.equal(bodies.length, 10);
});


test('missing configuration or a temporary Auth failure defers the job without attempting delivery', async () => {
  const { db, docs } = memoryFirestore(), id = (await prepareWelcomeEmail(db, account()))!, bodies: any[] = [], now = Date.now();
  process.env.RESEND_API_KEY = '';
  assert.equal(await sendCustomerEmail(db, auth, id, accepted(bodies), now), 'not_configured'); assert.equal(bodies.length, 0);
  process.env.RESEND_API_KEY = 'test-key';
  assert.equal(await sendCustomerEmail(db, { getUser: async () => { throw new Error('Auth unavailable'); } }, id, accepted(bodies), now + 16 * 60000), 'pending');
  assert.ok(Number(docs.get(`_emailOutbox/${id}`)?.nextAttemptAt) > now + 16 * 60000); assert.equal(bodies.length, 0);
});


test('the shared dispatcher also retries the existing purchase-confirmation queue', async () => {
  const now = Date.now(), bodies: any[] = [];
  const { db, docs } = memoryFirestore([['_orderEmails/receipt', { kind: 'customer', recipient: 'alice@example.test', orderId: 'order', status: 'pending', attempts: 0, nextAttemptAt: now, createdAt: new Date(now).toISOString() }], ['_orderDocuments/order', { pdf: Buffer.from('test-only-pdf-bytes') }]]);
  const result = await dispatchCustomerEmails(db, auth, accepted(bodies), async () => {});
  assert.equal(result.processed, 1); assert.equal(docs.get('_orderEmails/receipt')?.status, 'accepted'); assert.ok(bodies[0].attachments[0].content);
});
