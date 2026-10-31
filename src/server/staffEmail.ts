import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { STAFF_ROLE_LABELS, type AssignedRole } from '../lib/staffAccess.js';

export const STAFF_EMAIL_COLLECTION = '_staffNotifications';
export type StaffEmailStatus = 'accepted' | 'pending' | 'not_configured';
export function staffEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(process.env.STAFF_EMAIL_FROM?.trim() || ''));
}

export async function queueStaffEmail(db: Firestore, email: string, role: AssignedRole): Promise<{ id: string; status: StaffEmailStatus }> {
  const id = randomUUID();
  await db.collection(STAFF_EMAIL_COLLECTION).doc(id).create({ schemaVersion: 1, email, role, createdAt: new Date().toISOString(), status: 'pending', attempts: 0 });
  return { id, status: await sendStaffEmail(db, id) };
}

/** Targets and message content are server-owned; retries never accept an arbitrary email. */
export async function sendStaffEmail(db: Firestore, id: string, fetcher: typeof fetch = fetch): Promise<StaffEmailStatus> {
  if (!staffEmailConfigured()) return 'not_configured';
  const ref = db.collection(STAFF_EMAIL_COLLECTION).doc(id);
  const nonce = randomUUID();
  const locked = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref), data = snapshot.data();
    if (!data || data.schemaVersion !== 1 || typeof data.email !== 'string' || !Object.hasOwn(STAFF_ROLE_LABELS, data.role)) return null;
    if (data.status === 'accepted') return { accepted: true } as const;
    if (data.lockUntil > Date.now()) return null;
    // Provider idempotency is finite; do not automatically repeat old ambiguous attempts.
    if (data.attempts > 0 && Date.now() - Date.parse(data.createdAt) > 23 * 60 * 60_000) return null;
    transaction.update(ref, { lockNonce: nonce, lockUntil: Date.now() + 60_000, attempts: Number(data.attempts || 0) + 1 });
    return { accepted: false, email: data.email, role: data.role as AssignedRole } as const;
  });
  if (!locked) return 'pending';
  if (locked.accepted) return 'accepted';
  let accepted = false;
  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, 'Content-Type': 'application/json', 'Idempotency-Key': `staff-role-${id}` },
      body: JSON.stringify({ from: process.env.STAFF_EMAIL_FROM!.trim(), to: [locked.email],
        subject: 'Sua função na GB Gráfica foi atualizada',
        text: `Sua função foi atualizada para: ${STAFF_ROLE_LABELS[locked.role]}.\n\n${locked.role === 'none' ? 'Seu acesso ao painel foi removido.' : 'Saia e entre novamente na loja para atualizar sua sessão. As áreas disponíveis dependem das permissões da sua função.'}\n\nSe você não esperava esta alteração, entre em contato com a administração da loja.`,
      }), signal: AbortSignal.timeout(8_000), redirect: 'error',
    });
    const data = await response.json().catch(() => null);
    accepted = response.ok && typeof data?.id === 'string';
  } catch { /* No raw provider errors or credentials in logs / browser responses. */ }
  await db.runTransaction(async transaction => {
    const data = (await transaction.get(ref)).data();
    if (data?.lockNonce === nonce) transaction.update(ref, { status: accepted ? 'accepted' : 'pending', lockUntil: 0, updatedAt: new Date().toISOString() });
  });
  return accepted ? 'accepted' : 'pending';
}
