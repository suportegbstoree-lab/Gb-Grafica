import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createEmailRouters } from './emailRouter';
import { EmailError, saveEmailPreferences, unsubscribeToken } from './emailPreferences';
import { EMAIL_CONSENT_VERSION } from '../lib/email';
import { memoryFirestore } from '../../test/helpers/memoryFirestore';
async function scenario(run: (c: { call: (path: string, token?: string, body?: unknown, form?: boolean) => Promise<Response>; docs: Map<string, any>; db: any; check: (value: boolean) => void; account: any }) => Promise<void>) {
  const memory = memoryFirestore(), account = { uid: 'alice', email: 'alice@example.test', emailVerified: true, disabled: false, metadata: { creationTime: new Date().toISOString() } };
  let appCheck = true;
  const app = express(); app.use(express.json());
  const routers = createEmailRouters({ services: () => ({ db: memory.db, auth: { getUser: async () => account } }) as any,
    user: async req => { if (!['alice', 'admin'].includes(req.get('authorization') || '')) throw new EmailError(401, 'Entre com sua conta.'); return { uid: 'alice' }; },
    manage: async req => { if (req.get('authorization') !== 'admin') throw new EmailError(403, 'Sem permissão.'); return { uid: 'admin' }; },
    appCheck: (_req, res, next) => { if (!appCheck) res.status(403).json({ error: 'App Check' }); else next(); }, limit() {}, });
  app.use('/api/email', routers.customer); app.use('/api/admin/email', routers.admin);
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  try { await run({ docs: memory.docs, db: memory.db, account, check: value => { appCheck = value; }, call: (path, token = 'alice', body, form = false) => fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: token, ...(body === undefined ? {} : { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }) }, ...(body === undefined ? {} : { body: form ? new URLSearchParams(body as any).toString() : JSON.stringify(body) }) }) }); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
test('preferences are private, bind consent to the authenticated account and reject unauthenticated/unverified changes', async () => scenario(async c => {
  assert.equal((await c.call('/api/email/preferences', 'stranger')).status, 401);
  assert.equal((await c.call('/api/email/preferences', 'alice', { uid: 'victim', email: 'victim@example.test', promotions: true, news: false, expectedRevision: null, consentVersion: EMAIL_CONSENT_VERSION })).status, 200);
  assert.equal(c.docs.has('_emailPreferences/victim'), false); assert.equal(c.docs.get('_emailPreferences/alice').email, 'alice@example.test');
  c.account.emailVerified = false;
  const old = c.docs.get('_emailPreferences/alice'); assert.equal((await c.call('/api/email/preferences', 'alice', { promotions: true, news: true, expectedRevision: old.revision, consentVersion: EMAIL_CONSENT_VERSION })).status, 403);
}));
test('campaigns require their own management permission and user-controlled HTML stays text', async () => scenario(async c => {
  assert.equal((await c.call('/api/admin/email', 'alice')).status, 403);
  assert.equal((await c.call('/api/admin/email/campaigns', 'alice', { subject: 'Spam', text: 'Spam', channel: 'news' })).status, 403);
  const response = await c.call('/api/admin/email/campaigns', 'admin', { subject: 'Aviso', text: '<script>forged</script>', channel: 'news', createdBy: 'forged' }); assert.equal(response.status, 201);
  const campaign = await response.json(); assert.equal(campaign.createdBy, 'admin'); assert.equal(campaign.status, 'draft');
  assert.equal([...c.docs.keys()].filter(key => key.startsWith('_emailOutbox/')).length, 0, 'drafts never send');
  assert.equal((await c.call(`/api/admin/email/campaigns/${campaign.id}/cancel`, 'admin', {})).status, 200);
}));

test('draft editing, deletion and previews require management permission and App Check', async () => scenario(async c => {
  const input = { subject: 'Oferta', text: 'Texto de campanha', channel: 'promotions' };
  const created = await (await c.call('/api/admin/email/campaigns', 'admin', input)).json();
  const updatePath = `/api/admin/email/campaigns/${created.id}/update`, deletePath = `/api/admin/email/campaigns/${created.id}/delete`;
  for (const path of ['/api/admin/email/preview', updatePath, deletePath]) {
    assert.equal((await c.call(path, 'alice', { ...input, expectedRevision: created.revision })).status, 403);
    c.check(false);
    assert.equal((await c.call(path, 'admin', { ...input, expectedRevision: created.revision })).status, 403);
    c.check(true);
  }
  const preview = await c.call('/api/admin/email/preview', 'admin', input);
  assert.equal(preview.status, 200); assert.match(preview.headers.get('cache-control') || '', /no-store/);
  assert.match((await preview.json()).html, /Texto de campanha/);
  const edited = await c.call(updatePath, 'admin', { ...input, text: 'Texto revisado', expectedRevision: created.revision });
  assert.equal(edited.status, 200); const saved = await edited.json();
  assert.equal(c.docs.get(`_emailCampaigns/${created.id}`).text, 'Texto revisado');
  assert.equal((await c.call(deletePath, 'admin', { expectedRevision: created.revision })).status, 409);
  assert.equal((await c.call(deletePath, 'admin', { expectedRevision: saved.revision })).status, 200);
  assert.equal(c.docs.has(`_emailCampaigns/${created.id}`), false);
  assert.equal([...c.docs.keys()].filter(key => key.startsWith('_emailOutbox/')).length, 0);
}));
test('unsubscribe GET never changes consent and one-click POST works without login or App Check', async () => scenario(async c => {
  const old = process.env.EMAIL_UNSUBSCRIBE_SECRET; process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-only-unsubscribe-secret'.repeat(3);
  try {
    await saveEmailPreferences(c.db, c.account, { promotions: true, news: true, expectedRevision: null, consentVersion: EMAIL_CONSENT_VERSION });
    const token = unsubscribeToken('alice', 'alice@example.test'); c.check(false);
    assert.equal((await c.call('/api/email/preferences', '')).status, 403);
    const path = `/api/email/unsubscribe?token=${token}`;
    assert.equal((await c.call(path, '')).status, 200); assert.equal(c.docs.get('_emailPreferences/alice').promotions, true);
    const response = await c.call(path, '', { 'List-Unsubscribe': 'One-Click' }, true); assert.equal(response.status, 200); assert.equal(await response.text(), '');
    assert.equal(c.docs.get('_emailPreferences/alice').promotions, false); assert.equal(c.docs.get('_emailPreferences/alice').news, false);
    assert.equal((await c.call('/api/email/unsubscribe?token=forged', '', { confirm: 'yes' }, true)).status, 400);
  } finally { old === undefined ? delete process.env.EMAIL_UNSUBSCRIBE_SECRET : process.env.EMAIL_UNSUBSCRIBE_SECRET = old; }
}));
