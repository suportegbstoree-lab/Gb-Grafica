import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { UserRecord } from 'firebase-admin/auth';
import { EMAIL_CONSENT_VERSION } from '../lib/email.js';
export class EmailError extends Error { constructor(public status: number, message: string) { super(message); } }
export const emailAddress = (value: unknown) => typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) ? value.toLowerCase() : '';
export function emailConfiguration() {
  const from = emailAddress(process.env.EMAIL_FROM || process.env.ORDER_EMAIL_FROM || process.env.STAFF_EMAIL_FROM);
  let origin = ''; try { const url = new URL(process.env.APP_URL || ''); if (url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) origin = url.origin; } catch {}
  const configured = Boolean(process.env.RESEND_API_KEY?.trim() && from && origin);
  const marketingFrom = process.env.EMAIL_MARKETING_FROM?.trim() ? emailAddress(process.env.EMAIL_MARKETING_FROM.trim()) : from;
  const replyTo = emailAddress(process.env.EMAIL_REPLY_TO?.trim());
  return { from, marketingFrom, replyTo, origin, configured, marketingConfigured: configured && Boolean(marketingFrom) && (process.env.EMAIL_UNSUBSCRIBE_SECRET?.length || 0) >= 32 };
}
export async function readEmailPreferences(db: Firestore, account: UserRecord) {
  const value = (await db.collection('_emailPreferences').doc(account.uid).get()).data();
  const current = account.emailVerified && !account.disabled && emailAddress(account.email) === value?.email;
  return { promotions: current && value?.promotions === true, news: current && value?.news === true, revision: value?.revision || null, emailVerified: account.emailVerified && !account.disabled };
}
export async function saveEmailPreferences(db: Firestore, account: UserRecord, input: any) {
  if (typeof input?.promotions !== 'boolean' || typeof input?.news !== 'boolean' || input.consentVersion !== EMAIL_CONSENT_VERSION || !(input.expectedRevision === null || typeof input.expectedRevision === 'string')) throw new EmailError(422, 'Revise as preferências de e-mail.');
  const email = emailAddress(account.email);
  if (account.disabled || !account.emailVerified || !email) throw new EmailError(403, 'Confirme o e-mail da sua conta antes de alterar estas preferências.');
  const ref = db.collection('_emailPreferences').doc(account.uid), now = new Date().toISOString();
  await db.runTransaction(async tx => {
    const old = (await tx.get(ref)).data();
    if ((old?.revision || null) !== input.expectedRevision) throw new EmailError(409, 'As preferências mudaram. Atualize a página antes de salvar.');
    const sameEmail = old?.email === email;
    const next = { uid: account.uid, email, promotions: input.promotions, news: input.news, revision: randomUUID(), consentVersion: EMAIL_CONSENT_VERSION, updatedAt: now,
      promotionsSince: input.promotions ? sameEmail && old?.promotions ? old.promotionsSince || now : now : null,
      newsSince: input.news ? sameEmail && old?.news ? old.newsSince || now : now : null };
    tx.set(ref, next);
    tx.create(ref.collection('consents').doc(randomUUID()), { promotions: next.promotions, news: next.news, email, version: EMAIL_CONSENT_VERSION, source: 'account-settings', at: now });
  });
  return readEmailPreferences(db, account);
}
export function unsubscribeToken(uid: string, email: string) {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET || '';
  if (secret.length < 32) throw new EmailError(503, 'Configure o descadastro de e-mails antes de enviar campanhas.');
  return `${Buffer.from(uid).toString('base64url')}.${createHmac('sha256', secret).update(`${uid}\n${email}`).digest('base64url')}`;
}
export async function unsubscribeEmail(db: Firestore, token: unknown, apply: boolean) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,180}\.[A-Za-z0-9_-]{43}$/.test(token)) throw new EmailError(400, 'Link de descadastro inválido.');
  const uid = Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
  if (!uid || uid.length > 128 || uid.includes('/')) throw new EmailError(400, 'Link de descadastro inválido.');
  const ref = db.collection('_emailPreferences').doc(uid);
  await db.runTransaction(async tx => {
    const prefs = (await tx.get(ref)).data();
    if (!prefs?.email) throw new EmailError(400, 'Link de descadastro inválido.');
    const expected = Buffer.from(unsubscribeToken(uid, prefs.email)), received = Buffer.from(token);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new EmailError(400, 'Link de descadastro inválido.');
    if (!apply || (!prefs.promotions && !prefs.news)) return;
    const now = new Date().toISOString();
    tx.set(ref, { ...prefs, promotions: false, news: false, promotionsSince: null, newsSince: null, revision: randomUUID(), updatedAt: now });
    tx.create(ref.collection('consents').doc(randomUUID()), { promotions: false, news: false, email: prefs.email, version: EMAIL_CONSENT_VERSION, source: 'unsubscribe-link', at: now });
  });
}
