import { sendOrderEmail } from './orderDocuments.js';
import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { EmailError, emailConfiguration } from './emailPreferences.js';
import { sendCustomerEmail, userKey } from './customerEmails.js';
import { prepareCatalogRetention } from './catalogRetention.js';
import type { EmailCampaignInput } from '../lib/email.js';
export function emailCampaignInput(input: any, allowEmpty = false): EmailCampaignInput {
  if (!['promotions', 'news'].includes(input?.channel) || typeof input.subject !== 'string' || (!allowEmpty && !input.subject.trim()) || input.subject.length > 160 || /[\x00-\x1f\x7f]/.test(input.subject) || typeof input.text !== 'string' || (!allowEmpty && !input.text.trim()) || input.text.length > 10000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.text)) throw new EmailError(422, 'Informe o tipo, assunto (até 160 caracteres) e mensagem (até 10.000 caracteres).');
  return { channel: input.channel, subject: input.subject.trim(), text: input.text.trim() };
}
const campaignRef = (db: Firestore, id: string) => {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new EmailError(422, 'Campanha inválida.');
  return db.collection('_emailCampaigns').doc(id);
};
function validRevision(value: unknown) {
  if (!(value === null || typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value))) throw new EmailError(422, 'Atualize a lista de campanhas antes de continuar.');
}
function matchesRevision(data: any, expected: unknown) {
  validRevision(expected);
  if ((data.revision ?? null) !== expected) throw new EmailError(409, 'Esta campanha mudou em outra sessão. Feche a edição, atualize a lista e confira a versão mais recente.');
}
export function newEmailCampaign(fields: EmailCampaignInput, actor: string, now: number) {
  return { ...fields, revision: randomUUID(), status: 'draft', queuedCount: 0, processedCount: 0, acceptedCount: 0, skippedCount: 0, reviewCount: 0, createdAt: new Date(now).toISOString(), createdBy: actor };
}
export function queuedEmailCampaign(actor: string, now: number) {
  return { status: 'queued', cursor: '', fanoutDone: false, queuedAt: new Date(now).toISOString(), queuedBy: actor, scheduledAt: null };
}
export async function createEmailCampaign(db: Firestore, actor: string, input: any) {
  const id = randomUUID(), campaign = newEmailCampaign(emailCampaignInput(input), actor, Date.now());
  await campaignRef(db, id).create(campaign);
  return { id, ...campaign };
}
const editableCampaign = (status: unknown) => status === 'draft' || status === 'completed';

export async function updateEmailCampaign(db: Firestore, id: string, actor: string, input: any) {
  const fields = emailCampaignInput(input), ref = campaignRef(db, id);
  validRevision(input.expectedRevision);
  return db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    if (!data) throw new EmailError(404, 'Campanha não encontrada.');
    if (!editableCampaign(data.status)) throw new EmailError(409, 'Somente rascunhos e campanhas concluídas podem ser editados.');
    matchesRevision(data, input.expectedRevision);
    const next = { ...data, ...fields, revision: randomUUID(), updatedAt: new Date().toISOString(), updatedBy: actor };
    tx.set(ref, next);
    return { ...next, id };
  });
}
export async function deleteEmailCampaign(db: Firestore, id: string, expectedRevision: unknown) {
  const ref = campaignRef(db, id); validRevision(expectedRevision);
  await db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    if (!data) throw new EmailError(404, 'Campanha não encontrada.');
    if (!editableCampaign(data.status)) throw new EmailError(409, 'Somente rascunhos e campanhas concluídas podem ser excluídos.');
    matchesRevision(data, expectedRevision);
    const retain = await prepareCatalogRetention(db, tx, ref.path, data, null, '');
    retain(); tx.delete(ref);
  });
}
export async function changeEmailCampaign(
  db: Firestore, id: string, actor: string,
  action: 'queue' | 'cancel' | 'schedule' | 'resend',
  expectedRevision?: unknown, scheduledAt?: unknown, now = Date.now(),
) {
  const ref = campaignRef(db, id);
  if (action !== 'cancel' && !emailConfiguration().marketingConfigured)
    throw new EmailError(503, 'Configure o serviço de e-mail, a URL da loja e o segredo de descadastro antes de enviar campanhas.');
  if (action === 'schedule' && (typeof scheduledAt !== 'number' || !Number.isSafeInteger(scheduledAt) ||
    scheduledAt <= now || !Number.isFinite(new Date(scheduledAt).getTime())))
    throw new EmailError(422, 'Escolha uma data futura válida.');
  if (action === 'schedule' || action === 'resend') validRevision(expectedRevision);
  const nextId = action === 'resend' ? randomUUID() : '';
  await db.runTransaction(async tx => {
    const campaign = (await tx.get(ref)).data();
    if (!campaign) throw new EmailError(404, 'Campanha não encontrada.');
    if (expectedRevision !== undefined) matchesRevision(campaign, expectedRevision);
    const revision = randomUUID();
    if (action === 'resend') {
      if (campaign.status !== 'completed') throw new EmailError(409, 'Somente campanhas concluídas podem ser reenviadas.');
      tx.create(campaignRef(db, nextId), {
        ...newEmailCampaign(emailCampaignInput(campaign), actor, now),
        ...queuedEmailCampaign(actor, now), resendOf: id,
      });
      tx.set(ref, { revision }, { merge: true });
    } else if (action === 'schedule') {
      if (campaign.status !== 'draft') throw new EmailError(409, 'Cancele o agendamento anterior para agendar novamente.');
      tx.set(ref, { status: 'scheduled', scheduledAt, scheduledBy: actor, revision }, { merge: true });
    } else if (action === 'queue') {
      if (campaign.status === 'queued' || campaign.status === 'completed') return;
      if (campaign.status !== 'draft') throw new EmailError(409, 'Esta campanha não pode ser enviada.');
      tx.set(ref, { ...queuedEmailCampaign(actor, now), revision }, { merge: true });
    } else if (campaign.status === 'scheduled') {
      tx.set(ref, { status: 'draft', scheduledAt: null, revision }, { merge: true });
    } else {
      if (campaign.status === 'cancelled') return;
      if (!['draft', 'queued'].includes(campaign.status)) throw new EmailError(409, 'O processamento desta campanha já foi concluído.');
      tx.set(ref, { status: 'cancelled', cancelledAt: new Date(now).toISOString(), cancelledBy: actor, revision }, { merge: true });
    }
  });
}

export async function releaseScheduledCampaigns(db: Firestore, now = Date.now()) {
  const due = await db.collection('_emailCampaigns').where('scheduledAt', '>', 0)
    .where('scheduledAt', '<=', now).orderBy('scheduledAt').limit(10).get();
  for (const row of due.docs) await db.runTransaction(async tx => {
    const data = (await tx.get(row.ref)).data();
    if (data?.status !== 'scheduled' || typeof data.scheduledAt !== 'number' || data.scheduledAt > now) return;
    const revision = randomUUID();
    if (data.automationEvent === 'promotion') {
      const source = (await tx.get(db.collection('promocoes').doc(data.automationSourceId))).data();
      if (!source?.ativa || (source.endsAt && source.endsAt <= now)) {
        tx.set(row.ref, { status: 'cancelled', scheduledAt: null, revision }, { merge: true });
        return;
      }
      if (source.startsAt > now) {
        tx.set(row.ref, { scheduledAt: source.startsAt, revision }, { merge: true });
        return;
      }
    }
    tx.set(row.ref, { ...queuedEmailCampaign(data.scheduledBy, now), revision }, { merge: true });
  });
  return due.size;
}
export async function expandEmailCampaign(db: Firestore, id: string, now = Date.now()) {
  const ref = db.collection('_emailCampaigns').doc(id), initial = (await ref.get()).data();
  if (!initial || initial.status !== 'queued' || initial.fanoutDone) return 0;
  let query = db.collection('_emailPreferences').orderBy('uid').limit(100);
  if (initial.cursor) query = query.startAfter(initial.cursor);
  const page = await query.get();
  return db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (!current || current.status !== 'queued' || current.fanoutDone || current.cursor !== initial.cursor) return 0;
    const eligible = page.docs.filter(doc => { const prefs = doc.data(); return prefs.uid === doc.id && prefs[current.channel] === true && typeof prefs[`${current.channel}Since`] === 'string' && prefs[`${current.channel}Since`] <= current.queuedAt; });
    for (const person of eligible) tx.create(db.collection('_emailOutbox').doc(`campaign-${id}-${userKey(person.id)}`), { uid: person.id, kind: 'campaign', campaignId: id, channel: current.channel, subject: current.subject, text: current.text, status: 'pending', attempts: 0, nextAttemptAt: now, createdAt: new Date(now).toISOString() });
    const queuedCount = current.queuedCount + eligible.length, fanoutDone = page.size < 100;
    tx.set(ref, { queuedCount, cursor: page.docs.at(-1)?.id || current.cursor, fanoutDone, ...(fanoutDone && current.processedCount >= queuedCount ? { status: 'completed' } : {}) }, { merge: true });
    return eligible.length;
  });
}
export async function dispatchCustomerEmails(db: Firestore, auth: Pick<Auth, 'getUser'>, fetcher: typeof fetch = fetch, delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))) {
  const lock = db.collection('_emailLocks').doc('dispatch'), nonce = randomUUID(), start = Date.now();
  const acquired = await db.runTransaction(async tx => { const old = (await tx.get(lock)).data(); if (old?.expiresAt > start) return false; tx.set(lock, { nonce, expiresAt: start + 45000 }); return true; });
  if (!acquired) return { busy: true, processed: 0, workRemaining: false };
  let processed = 0, deferred = false; const legacyOrderEmails: string[] = [];
  try {
    const promoted = await releaseScheduledCampaigns(db);
    const campaigns = await db.collection('_emailCampaigns').where('status', '==', 'queued').limit(3).get();
    for (const campaign of campaigns.docs) await expandEmailCampaign(db, campaign.id);
    const jobs = await db.collection('_emailOutbox').where('nextAttemptAt', '<=', Date.now()).orderBy('nextAttemptAt').limit(10).get();
    const legacy = await db.collection('_orderEmails').where('nextAttemptAt', '<=', Date.now()).orderBy('nextAttemptAt').limit(3).get();
    const combined = [...legacy.docs.map(job => ({ job, legacy: true })), ...jobs.docs.map(job => ({ job, legacy: false }))].slice(0, 10);
    for (const item of combined) {
      const job = item.job;
      if (Date.now() - start > 20000) break;
      const result = item.legacy ? await sendOrderEmail(db, job.id, fetcher) : await sendCustomerEmail(db, auth, job.id, fetcher); if (item.legacy) legacyOrderEmails.push(result); processed++; deferred ||= ['pending', 'not_configured'].includes(result);
      await delay(600);
    }
    const due = await db.collection('_emailOutbox').where('nextAttemptAt', '<=', Date.now()).limit(1).get();
    const legacyDue = await db.collection('_orderEmails').where('nextAttemptAt', '<=', Date.now()).limit(1).get();
    const more = await db.collection('_emailCampaigns').where('status', '==', 'queued').get();
    return { busy: false, processed, legacyOrderEmails, workRemaining: !deferred && (promoted === 10 || due.size > 0 || legacyDue.size > 0 || more.docs.some(doc => !doc.data().fanoutDone)) };
  } finally { await db.runTransaction(async tx => { if ((await tx.get(lock)).data()?.nonce === nonce) tx.delete(lock); }).catch(() => undefined); }
}
