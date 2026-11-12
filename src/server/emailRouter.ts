import { listEmailAutomations, saveEmailAutomation } from './emailAutomations.js';
import express from 'express';
import type { getAdminServices } from './firebaseAdmin.js';
import { EmailError, emailConfiguration, readEmailPreferences, saveEmailPreferences, unsubscribeEmail } from './emailPreferences.js';
import { prepareWelcomeEmail, sendCustomerEmail } from './customerEmails.js';
import { changeEmailCampaign, createEmailCampaign, deleteEmailCampaign, dispatchCustomerEmails, updateEmailCampaign } from './emailCampaigns.js';
import { previewEmailCampaign } from './emailCampaignPreview.js';
type Dependencies = { services: () => ReturnType<typeof getAdminServices>; user: (req: express.Request) => Promise<{ uid: string }>; manage: (req: express.Request) => Promise<{ uid: string }>; appCheck: express.RequestHandler; limit: (key: string, count: number, period: number) => void; };
const wrap = (fn: (req: express.Request, res: express.Response) => Promise<void>): express.RequestHandler => (req, res, next) => { void fn(req, res).catch(next); };
const errors: express.ErrorRequestHandler = (error, _req, res, _next) => { const status = error instanceof EmailError ? error.status : typeof error?.status === 'number' ? error.status : 500; res.status(status).json({ error: status >= 500 && !(error instanceof EmailError) ? 'Não foi possível processar os e-mails agora.' : error.message }); };
const html = (content: string) => `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Preferências · GB Gráfica</title><body style="font:16px Arial;max-width:560px;margin:10vh auto;padding:24px"><h1>GB Gráfica</h1>${content}</body></html>`;
export function createEmailRouters(deps: Dependencies) {
  const customer = express.Router(), admin = express.Router();
  customer.use((_req, res, next) => { res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }); next(); });
  customer.get('/unsubscribe', wrap(async (req, res) => {
    deps.limit(`email-unsubscribe:${req.ip}`, 30, 60000);
    await unsubscribeEmail(deps.services().db, req.query.token, false);
    res.type('html').send(html(`<p>Cancelar o recebimento de promoções e novidades? Seus avisos de compra e pedido continuam.</p><form method="post" action="/api/email/unsubscribe?token=${encodeURIComponent(String(req.query.token))}"><button name="confirm" value="yes" style="padding:12px">Descadastrar e-mails opcionais</button></form>`));
  }));
  customer.post('/unsubscribe', express.urlencoded({ extended: false, limit: '1kb' }), wrap(async (req, res) => {
    deps.limit(`email-unsubscribe:${req.ip}`, 30, 60000);
    if (req.body?.confirm !== 'yes' && req.body?.['List-Unsubscribe'] !== 'One-Click') throw new EmailError(422, 'Confirme o descadastro.');
    await unsubscribeEmail(deps.services().db, req.query.token, true);
    if (req.body?.['List-Unsubscribe'] === 'One-Click') res.status(200).end(); else res.type('html').send(html('<p>Descadastro concluído. Você não receberá mais promoções ou novidades. Os avisos dos seus pedidos continuam.</p>'));
  }));
  customer.use(deps.appCheck);
  customer.post('/session', wrap(async (req, res) => {
    const user = await deps.user(req), { db, auth } = deps.services(); deps.limit(`email-session:${user.uid}`, 6, 60000);
    const id = await prepareWelcomeEmail(db, await auth.getUser(user.uid));
    // Delivery errors remain in the durable queue; login itself is never blocked by the provider.
    if (id) await sendCustomerEmail(db, auth, id).catch(() => undefined);
    res.json({ prepared: true });
  }));
  customer.get('/preferences', wrap(async (req, res) => { const user = await deps.user(req), { db, auth } = deps.services(); deps.limit(`email-preferences:${user.uid}`, 30, 60000); res.json(await readEmailPreferences(db, await auth.getUser(user.uid))); }));
  customer.post('/preferences', wrap(async (req, res) => { const user = await deps.user(req), { db, auth } = deps.services(); deps.limit(`email-preferences:${user.uid}`, 30, 60000); res.json(await saveEmailPreferences(db, await auth.getUser(user.uid), req.body)); }));
  customer.use(errors);
  admin.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  admin.use(deps.appCheck, (req, res, next) => { void deps.manage(req).then(user => { const preview = req.path === '/preview'; deps.limit(`${preview ? 'email-preview' : 'email-admin'}:${user.uid}`, preview ? 120 : 60, 60000); res.locals.emailActor = user.uid; next(); }).catch(next); });
  admin.get('/', wrap(async (_req, res) => { const config = emailConfiguration(), { db } = deps.services();
    const campaigns = db.collection('_emailCampaigns');
    const [recent, active, automations] = await Promise.all([
      campaigns.orderBy('createdAt', 'desc').limit(30).get(),
      campaigns.where('status', 'in', ['scheduled', 'queued']).limit(100).get(),
      listEmailAutomations(db),
    ]);
    const rows = [...new Map([...active.docs, ...recent.docs].map(doc => [doc.id, doc])).values()];
    res.json({ configured: config.configured, marketingConfigured: config.marketingConfigured, automations, campaigns: rows.map(doc => ({ id: doc.id, ...doc.data(), revision: doc.data().revision ?? null })) }); }));
  admin.post('/preview', wrap(async (req, res) => { res.json(previewEmailCampaign(req.body)); }));
  admin.post('/campaigns', wrap(async (req, res) => { res.status(201).json(await createEmailCampaign(deps.services().db, res.locals.emailActor, req.body)); }));
  admin.post('/campaigns/:id/update', wrap(async (req, res) => { res.json(await updateEmailCampaign(deps.services().db, req.params.id, res.locals.emailActor, req.body)); }));
  admin.post('/campaigns/:id/delete', wrap(async (req, res) => { await deleteEmailCampaign(deps.services().db, req.params.id, req.body?.expectedRevision); res.json({ deleted: true }); }));
  admin.post('/automations/:event', wrap(async (req, res) => {
    await saveEmailAutomation(deps.services().db, res.locals.emailActor, req.params.event, req.body);
    res.json({ updated: true });
  }));
  for (const action of ['queue', 'cancel', 'schedule', 'resend'] as const) admin.post(`/campaigns/:id/${action}`, wrap(async (req, res) => { await changeEmailCampaign(deps.services().db, req.params.id, res.locals.emailActor, action, req.body?.expectedRevision, req.body?.scheduledAt); res.json({ updated: true }); }));
  admin.post('/dispatch', wrap(async (req, res) => { deps.limit(`email-dispatch:${res.locals.emailActor}`, 30, 60000); const { db, auth } = deps.services(); res.json(await dispatchCustomerEmails(db, auth)); }));
  admin.use(errors);
  return { customer, admin };
}
