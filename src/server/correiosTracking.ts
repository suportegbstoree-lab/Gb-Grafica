import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { CorreiosTrackingEvent } from './correiosTrackingResponse.js';
import { validTrackingCode, type OrderTracking } from '../lib/tracking.js';
import { legacyFulfillmentStatus, type PaymentStatus } from '../lib/orderStatus.js';
import { isRecord } from '../lib/shipping.js';
import { CorreiosError, getCorreiosClient } from './correios.js';

export function cronAuthorized(authorization: string | undefined, secret = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 32 || secret.length > 512 || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`), received = Buffer.from(authorization);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
function invalid() { return new CorreiosError(502, 'CORREIOS_TRACKING_INVALID', 'Rastreio inválido para este pedido.'); }
function trackingStage(order: Record<string, unknown>) {
  return order.fulfillmentStatus || legacyFulfillmentStatus(order.status, order.paymentStatus as PaymentStatus | undefined);
}
function sameTrackingJob(current: Record<string, unknown> | undefined, expected: Record<string, unknown>) {
  return current?.code === expected.code && current?.nextCheckAt === expected.nextCheckAt && current?.attempts === expected.attempts;
}
export type PaymentVerifier = (id: string, order: Record<string, unknown>) => Promise<string>;
type TrackingFetcher = (code: string) => Promise<CorreiosTrackingEvent>;
export async function syncCorreiosTracking(db: Firestore, orderId: string, verifyPayment: PaymentVerifier,
  fetchEvent: TrackingFetcher = code => getCorreiosClient().track(code), now = Date.now()): Promise<OrderTracking> {
  const ref = db.collection('orders').doc(orderId), job = db.collection('_trackingJobs').doc(orderId);
  const initial = (await ref.get()).data();
  if (!initial || !isRecord(initial.tracking) || initial.tracking.provider !== 'correios' || !validTrackingCode(initial.tracking.code)) throw invalid();
  const code = initial.tracking.code;
  if (trackingStage(initial) !== 'enviado') throw new CorreiosError(409, 'TRACKING_STAGE_CHANGED', 'O pedido não está em trânsito. Atualize a lista.');
  const event = await fetchEvent(code);
  const created = typeof initial.data === 'string' ? Date.parse(initial.data) : NaN;
  if (!Number.isFinite(created) || Date.parse(event.at) < created) throw invalid();
  const verifiedCharge = event.delivered ? await verifyPayment(orderId, initial) : null;
  return db.runTransaction(async transaction => {
    const order = (await transaction.get(ref)).data();
    if (!order || !isRecord(order.tracking) || order.tracking.code !== code || trackingStage(order) !== 'enviado') throw new CorreiosError(409, 'TRACKING_STAGE_CHANGED', 'O pedido mudou durante a consulta. Atualize a lista.');
    if (typeof order.tracking.eventAt === 'string' && Date.parse(order.tracking.eventAt) > Date.parse(event.at)) {
      transaction.set(job, { code, nextCheckAt: now + 24 * 60 * 60_000, attempts: 0 });
      return order.tracking as unknown as OrderTracking;
    }
    const tracking: OrderTracking = { provider: 'correios', code, status: event.description, eventAt: event.at, eventCode: event.code, eventType: event.type, updatedAt: new Date(now).toISOString() };
    if (event.delivered) {
      if (order.paymentStatus !== 'pago' || !verifiedCharge || order.pagbankChargeId !== verifiedCharge || Number(order.pagbankRefundedAmountCents) > 0) throw new CorreiosError(409, 'TRACKING_PAYMENT_CHANGED', 'Confira o estado financeiro antes de concluir a entrega.');
      tracking.deliveredAt = event.at;
      transaction.set(ref, { tracking, fulfillmentStatus: 'entregue', status: 'Entregue', fulfillmentUpdatedAt: new Date(now).toISOString() }, { merge: true });
      transaction.create(ref.collection('events').doc(randomUUID()), { type: 'correios_delivery_confirmed', code, eventCode: event.code, eventType: event.type, eventAt: event.at, createdAt: new Date(now).toISOString() });
      transaction.delete(job);
    } else {
      transaction.set(ref, { tracking }, { merge: true });
      transaction.set(job, { code, nextCheckAt: now + 24 * 60 * 60_000, attempts: 0 });
    }
    return tracking;
  });
}

export async function processTrackingJobs(db: Firestore, verifyPayment: PaymentVerifier, now = Date.now(),
  fetchEvent?: TrackingFetcher): Promise<{ checked: number; failed: number }> {
  if (process.env.CORREIOS_TRACKING_ENABLED !== 'true') return { checked: 0, failed: 0 };
  const configuredBatch = Number(process.env.CORREIOS_TRACKING_BATCH_SIZE || 5);
  const batch = Number.isInteger(configuredBatch) && configuredBatch >= 1 && configuredBatch <= 10 ? configuredBatch : 5;
  const jobs = await db.collection('_trackingJobs').orderBy('nextCheckAt').limit(batch).get();
  let checked = 0, failed = 0;
  await Promise.all(jobs.docs.map(async snapshot => {
    const data = snapshot.data(); if (data.nextCheckAt > now) return;
    try {
      // A corrected shipment may replace this job after the query. Check both documents
      // in one transaction so cleanup cannot delete the replacement job.
      const eligible = await db.runTransaction(async transaction => {
        const current = (await transaction.get(snapshot.ref)).data();
        if (!current || !sameTrackingJob(current, data) || current.nextCheckAt > now) return false;
        const order = (await transaction.get(db.collection('orders').doc(snapshot.id))).data();
        if (!order || trackingStage(order) !== 'enviado' || !isRecord(order.tracking)
          || order.tracking.provider !== 'correios' || !validTrackingCode(order.tracking.code) || order.tracking.code !== current.code) {
          transaction.delete(snapshot.ref);
          return false;
        }
        return true;
      });
      if (!eligible) return;
      await syncCorreiosTracking(db, snapshot.id, verifyPayment, fetchEvent, now); checked++;
    } catch {
      failed++;
      // Preserve a concurrent delivery, code correction or successful reschedule.
      await db.runTransaction(async transaction => {
        const current = (await transaction.get(snapshot.ref)).data();
        if (current && sameTrackingJob(current, data)) transaction.update(snapshot.ref, { nextCheckAt: now + 24 * 60 * 60_000, attempts: Number(current.attempts || 0) + 1 });
      });
    }
  }));
  return { checked, failed };
}
