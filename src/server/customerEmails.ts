import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { Auth, UserRecord } from 'firebase-admin/auth';
import { fulfillmentStatusLabel, legacyFulfillmentStatus } from '../lib/orderStatus.js';
import { emailAddress, emailConfiguration, unsubscribeToken } from './emailPreferences.js';
const terminal = ['accepted', 'skipped', 'needs_review'];
export const userKey = (uid: string) => createHash('sha256').update(uid).digest('hex');
export async function prepareWelcomeEmail(db: Firestore, account: UserRecord, now = Date.now()) {
  if (account.disabled || !account.emailVerified || !emailAddress(account.email)) return null;
  const id = `welcome-${userKey(account.uid)}`, ref = db.collection('_emailOutbox').doc(id);
  await db.runTransaction(async tx => {
    if ((await tx.get(ref)).exists) return;
    const created = Date.parse(account.metadata.creationTime);
    const fresh = Number.isFinite(created) && created <= now && now - created < 24 * 60 * 60_000;
    tx.create(ref, { uid: account.uid, kind: 'welcome', name: account.displayName || '', status: fresh ? 'pending' : 'skipped', attempts: 0,
      ...(fresh ? { nextAttemptAt: now } : { reason: 'existing-account' }), createdAt: new Date(now).toISOString() });
  });
  return id;
}
/** Called inside the same transaction as the verified state change. No provider calls here. */
export function queueOrderStatusEmail(tx: Transaction, db: Firestore, orderId: string, before: any, update: any, now = Date.now()) {
  if (typeof before.userId !== 'string' || !before.userId) return;
  const after = { ...before, ...update };
  const stage = (o: any) => o.fulfillmentStatus || legacyFulfillmentStatus(o.status, o.paymentStatus);
  if (before.paymentStatus === after.paymentStatus && stage(before) === stage(after) && before.tracking?.code === after.tracking?.code && before.pagbankRefundedAmountCents === after.pagbankRefundedAmountCents) return;
  const revision = Number.isSafeInteger(before.emailNotificationRevision) ? before.emailNotificationRevision + 1 : 1;
  const orderRef = db.collection('orders').doc(orderId);
  tx.set(orderRef, { emailNotificationRevision: revision }, { merge: true });
  tx.create(db.collection('_emailOutbox').doc(`order-${orderId}-${revision}`), { uid: before.userId, kind: 'order-status', orderId,
    paymentStatus: String(after.paymentStatus || 'pendente'), fulfillmentStatus: stage(after), trackingCode: String(after.tracking?.code || ''), refunded: Number(after.pagbankRefundedAmountCents) > 0,
    status: 'pending', attempts: 0, nextAttemptAt: now, createdAt: new Date(now).toISOString() });
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
function message(job: any, account: UserRecord, prefs: any) {
  const config = emailConfiguration(); let subject: string, text: string, headers: Record<string, string> | undefined;
  if (job.kind === 'welcome') { subject = 'Boas-vindas à GB Gráfica'; text = `Olá${job.name ? `, ${job.name}` : ''}! Sua conta na GB Gráfica está pronta.\n\nAcompanhe suas compras na loja: ${config.origin}\n\nPromoções e novidades são opcionais. Você pode escolher o que receber em Preferências de e-mail na loja.`; }
  else if (job.kind === 'order-status') {
    const payment: Record<string, string> = { pago: 'Pagamento confirmado', pendente: 'Aguardando pagamento', em_analise: 'Pagamento em análise', recusado: 'Pagamento recusado', cancelado: 'Pagamento cancelado', expirado: 'Pagamento expirado', erro: 'Confira o pagamento na loja' };
    const status = job.refunded ? 'Estorno registrado' : job.paymentStatus === 'pago' ? fulfillmentStatusLabel(job.fulfillmentStatus) || 'Pedido atualizado' : payment[job.paymentStatus] || 'Pedido atualizado';
    subject = `Pedido ${job.orderId} · ${status}`; text = `Seu pedido ${job.orderId} foi atualizado.\n\n${status}.${job.trackingCode ? `\nCódigo de rastreio: ${job.trackingCode}` : ''}\n\nConfira os detalhes em Meus Pedidos na loja: ${config.origin}`;
  } else {
    const url = `${config.origin}/api/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken(account.uid, prefs.email))}`;
    subject = job.subject; text = `${job.text}\n\nVocê recebeu esta mensagem porque autorizou ${job.channel === 'promotions' ? 'promoções' : 'novidades'} da GB Gráfica.\nDescadastrar: ${url}\nGerencie suas preferências na loja: ${config.origin}`;
    headers = { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  }
  return { from: job.kind === 'campaign' ? config.marketingFrom : config.from, to: [emailAddress(account.email)], subject, text, html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#202431"><h1 style="color:#d14d8c;font-size:24px">GB Gráfica</h1>${text.split('\n').map(line => `<p>${escape(line).replace(/https:\/\/[^\s<]+/g, url => `<a href="${url}">${url}</a>`) || '&nbsp;'}</p>`).join('')}</div>`, ...(headers ? { headers } : {}), ...(config.replyTo ? { reply_to: config.replyTo } : {}) };
}
export async function sendCustomerEmail(db: Firestore, auth: Pick<Auth, 'getUser'>, id: string, fetcher: typeof fetch = fetch, now = Date.now()) {
  const ref = db.collection('_emailOutbox').doc(id), initial = (await ref.get()).data();
  if (!initial || terminal.includes(initial.status)) return initial?.status || 'skipped';
  let account: UserRecord | undefined;
  try { account = await auth.getUser(initial.uid); } catch (error) {
    if ((error as any).code !== 'auth/user-not-found') {
      await db.runTransaction(async tx => { const current = (await tx.get(ref)).data(); if (current && !terminal.includes(current.status) && !(current.lockUntil > now)) tx.set(ref, { nextAttemptAt: now + 15 * 60000 }, { merge: true }); });
      return 'pending';
    }
  }
  const nonce = randomUUID();
  const locked = await db.runTransaction(async tx => {
    const job = (await tx.get(ref)).data(); if (!job || terminal.includes(job.status) || job.lockUntil > now || job.nextAttemptAt > now) return null;
    const prefs = (await tx.get(db.collection('_emailPreferences').doc(job.uid))).data();
    const campaignRef = job.campaignId ? db.collection('_emailCampaigns').doc(job.campaignId) : null;
    const campaign = campaignRef ? (await tx.get(campaignRef)).data() : null;
    const finish = (status: string, reason: string, extra = {}) => {
      tx.set(ref, { status, reason, nextAttemptAt: FieldValue.delete(), lockUntil: 0, ...extra }, { merge: true });
      if (campaignRef && campaign) {
        const processedCount = (campaign.processedCount || 0) + 1;
        tx.set(campaignRef, { processedCount, acceptedCount: (campaign.acceptedCount || 0) + (status === 'accepted' ? 1 : 0), skippedCount: (campaign.skippedCount || 0) + (status === 'skipped' ? 1 : 0), reviewCount: (campaign.reviewCount || 0) + (status === 'needs_review' ? 1 : 0), ...(campaign.status === 'queued' && campaign.fanoutDone && processedCount >= campaign.queuedCount ? { status: 'completed' } : {}) }, { merge: true });
      }
    };
    if (!account || account.disabled || !account.emailVerified || !emailAddress(account.email)) { finish('skipped', 'account-unavailable-or-unverified'); return null; }
    if (job.kind === 'campaign' && (campaign?.status !== 'queued' || !prefs?.[job.channel] || prefs.email !== emailAddress(account.email) || !prefs[`${job.channel}Since`] || prefs[`${job.channel}Since`] > campaign.queuedAt)) { finish('skipped', 'consent-or-campaign-changed'); return null; }
    if (job.payload && job.payload.to[0] !== emailAddress(account.email)) { finish('skipped', 'email-changed'); return null; }
    if (job.firstAttemptAt && now - job.firstAttemptAt > 23 * 60 * 60_000) { finish('needs_review', 'idempotency-window'); return null; }
    const config = emailConfiguration();
    if (!config.configured || (job.kind === 'campaign' && !config.marketingConfigured)) { tx.set(ref, { status: 'not_configured', nextAttemptAt: now + 15 * 60_000 }, { merge: true }); return null; }
    const payload = job.payload || message(job, account, prefs);
    tx.set(ref, { payload, status: 'pending', lockNonce: nonce, lockUntil: now + 60_000, attempts: (job.attempts || 0) + 1, firstAttemptAt: job.firstAttemptAt || now }, { merge: true });
    return payload;
  });
  if (!locked) return (await ref.get()).data()?.status || 'pending';
  let accepted = false, providerId = '';
  try { const response = await fetcher('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, 'Content-Type': 'application/json', 'Idempotency-Key': `customer-email-${id}` }, body: JSON.stringify(locked) }); const data = await response.json().catch(() => null); accepted = response.ok && typeof data?.id === 'string'; providerId = accepted ? data.id : ''; } catch {}
  await db.runTransaction(async tx => {
    const job = (await tx.get(ref)).data();
    const campaignRef = job?.campaignId ? db.collection('_emailCampaigns').doc(job.campaignId) : null;
    const campaign = campaignRef ? (await tx.get(campaignRef)).data() : null;
    if (job?.lockNonce !== nonce) return;
    tx.set(ref, { status: accepted ? 'accepted' : 'pending', providerId, lockUntil: 0, nextAttemptAt: accepted ? FieldValue.delete() : now + 15 * 60_000 }, { merge: true });
    if (accepted && campaignRef && campaign) { const processedCount = (campaign.processedCount || 0) + 1; tx.set(campaignRef, { processedCount, acceptedCount: (campaign.acceptedCount || 0) + 1, ...(campaign.status === 'queued' && campaign.fanoutDone && processedCount >= campaign.queuedCount ? { status: 'completed' } : {}) }, { merge: true }); }
  });
  return accepted ? 'accepted' : 'pending';
}

export async function sendLatestOrderEmail(db: Firestore, auth: Pick<Auth, 'getUser'>, orderId: string) {
  if (!emailConfiguration().configured) return;
  const order = (await db.collection('orders').doc(orderId).get()).data();
  if (order?.emailNotificationRevision) await sendCustomerEmail(db, auth, `order-${orderId}-${order.emailNotificationRevision}`).catch(() => undefined);
}
