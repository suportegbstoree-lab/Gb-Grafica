import { randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { EMAIL_AUTOMATION_EVENTS, type EmailAutomationEvent, type EmailAutomationRule, type EmailChannel } from '../lib/email.js';
import { emailCampaignInput, newEmailCampaign, queuedEmailCampaign } from './emailCampaigns.js';
import { EmailError } from './emailPreferences.js';

const collection = '_emailAutomations';
const defaults: Record<EmailAutomationEvent, { subject: string; text: string }> = {
  product: { subject: 'Novidade na GB Gráfica', text: 'Conheça {{nome}}, que acaba de chegar à loja.' },
  promotion: { subject: 'Nova promoção na GB Gráfica', text: 'Confira a promoção {{nome}} na loja.' },
  coupon: { subject: 'Novo cupom na GB Gráfica', text: 'Use o código {{codigo}} na loja. Confira as condições do cupom.' },
};
const channelFor = (event: EmailAutomationEvent): EmailChannel => event === 'product' ? 'news' : 'promotions';

export async function listEmailAutomations(db: Firestore): Promise<EmailAutomationRule[]> {
  const snapshots = await Promise.all(EMAIL_AUTOMATION_EVENTS.map(event => db.collection(collection).doc(event).get()));
  return EMAIL_AUTOMATION_EVENTS.map((event, index) => {
    const data = snapshots[index].data();
    return { event, enabled: data?.enabled === true, subject: data?.subject ?? defaults[event].subject,
      text: data?.text ?? defaults[event].text, revision: data?.revision ?? null };
  });
}
export async function saveEmailAutomation(db: Firestore, actor: string, event: string, input: any) {
  if (!EMAIL_AUTOMATION_EVENTS.includes(event as EmailAutomationEvent) || typeof input?.enabled !== 'boolean')
    throw new EmailError(422, 'Regra de automação inválida.');
  const kind = event as EmailAutomationEvent;
  const fields = emailCampaignInput({ ...input, channel: channelFor(kind) });
  const ref = db.collection(collection).doc(kind);
  await db.runTransaction(async tx => {
    const old = (await tx.get(ref)).data();
    if ((old?.revision ?? null) !== input.expectedRevision)
      throw new EmailError(409, 'A regra mudou. Atualize a lista antes de salvar.');
    tx.set(ref, { subject: fields.subject, text: fields.text, enabled: input.enabled,
      revision: randomUUID(), updatedBy: actor, updatedAt: new Date().toISOString() });
  });
}

export async function prepareEmailAutomation(
  db: Firestore, tx: Transaction, event: EmailAutomationEvent,
  sourceId: string, name: string, startAt = 0, now = Date.now(),
) {
  const rule = (await tx.get(db.collection(collection).doc(event))).data();
  if (rule?.enabled !== true || typeof rule.updatedBy !== 'string') return;
  const values: Record<string, string> = { nome: name.replace(/[\x00-\x1f\x7f]/g, ' ').trim(), codigo: event === 'coupon' ? sourceId : '' };
  const expand = (value: string) => value.replace(/\{\{\s*(nome|codigo)\s*\}\}/g, (_, key: string) => values[key]);
  const fields = {
    channel: channelFor(event),
    subject: expand(rule.subject).slice(0, 160).trim() || defaults[event].subject,
    text: expand(rule.text).slice(0, 10000).trim() || name,
  };
  const ref = db.collection('_emailCampaigns').doc(randomUUID());
  const campaign = {
    ...newEmailCampaign(fields, rule.updatedBy, now),
    ...(startAt > now ? { status: 'scheduled', scheduledAt: startAt, scheduledBy: rule.updatedBy }
      : queuedEmailCampaign(rule.updatedBy, now)),
    automationEvent: event, automationSourceId: sourceId,
  };
  return () => tx.create(ref, campaign);
}
