import { randomUUID } from 'node:crypto';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { legacyFulfillmentStatus, legacyStatusForFulfillment, type FulfillmentStatus } from '../lib/orderStatus.js';
import { isRecord } from '../lib/shipping.js';
import { validMelhorEnvioTrackingCode, type OrderTracking } from '../lib/tracking.js';
import { queueOrderStatusEmail } from './customerEmails.js';
import { melhorEnvioConfig } from './melhorEnvio.js';
import { shipmentFailure, shipmentProvider } from './melhorEnvioShipment.js';

type VerifyPayment = (id: string, order: Record<string, unknown>) => Promise<string>;
const retryInterval = 60 * 60_000;
const regularInterval = 12 * retryInterval;
const statuses: Record<string, string> = {
  posted: 'Postado',
  received: 'Recebido no ponto de postagem',
  delivered: 'Entregue',
  undelivered: 'Entrega não concluída',
  paused: 'Entrega pausada',
  suspended: 'Envio suspenso',
  canceled: 'Envio cancelado',
  cancelled: 'Envio cancelado',
  expired: 'Envio expirado',
};

function canTrack(order: FirebaseFirestore.DocumentData | undefined) {
  if (!order || order.shipping?.provider !== 'melhor_envio' || order.paymentStatus !== 'pago' ||
    Number(order.pagbankRefundedAmountCents) > 0) return false;
  const stage = order.fulfillmentStatus || legacyFulfillmentStatus(order.status, 'pago');
  return ['pagamento_confirmado', 'em_producao', 'enviado', 'entregue'].includes(stage);
}

export async function syncMelhorEnvioTracking(db: Firestore, id: string, paymentEnvironment: string, verify: VerifyPayment, now = Date.now()) {
  const orderRef = db.collection('orders').doc(id), labelRef = db.collection('_melhorEnvioLabels').doc(id);
  const [orderDoc, labelDoc] = await Promise.all([orderRef.get(), labelRef.get()]);
  const order = orderDoc.data(), label = labelDoc.data();
  if (!order || !canTrack(order) || label?.phase !== 'issued' || typeof label.providerId !== 'string')
    throw shipmentFailure(409, 'O pedido precisa ter uma etiqueta emitida e pagamento confirmado.');
  const config = melhorEnvioConfig();
  if (config.environment !== paymentEnvironment || label.environment !== config.environment ||
    (order.shipping.environment && order.shipping.environment !== config.environment))
    throw shipmentFailure(409, 'A etiqueta e os serviços de pagamento e frete precisam estar no mesmo ambiente.');
  const event = await shipmentProvider(config).details(label.providerId);
  const createdAt = Date.parse(order.data);
  const providerAt = event.deliveredAt ?? event.postedAt;
  const eventAt = providerAt && Number.isFinite(createdAt) &&
    Date.parse(providerAt) >= createdAt && Date.parse(providerAt) <= now + 5 * 60_000 ? providerAt : undefined;
  const delivered = !event.unavailable && event.state === 'delivered' && !!event.deliveredAt && eventAt === event.deliveredAt;
  const posted = !event.unavailable && ['posted', 'undelivered'].includes(event.state) && !!event.postedAt && eventAt === event.postedAt;
  const initialStage = order.fulfillmentStatus || legacyFulfillmentStatus(order.status, 'pago');
  const transition: FulfillmentStatus | null = initialStage === 'entregue' ? null
    : delivered ? 'entregue' : posted && initialStage !== 'enviado' ? 'enviado' : null;
  const verified = transition ? await verify(id, order) : null;
  return db.runTransaction(async tx => {
    const [currentDoc, currentLabelDoc] = await Promise.all([tx.get(orderRef), tx.get(labelRef)]);
    const current = currentDoc.data(), currentLabel = currentLabelDoc.data();
    if (!current || !canTrack(current) || currentLabel?.providerId !== label.providerId || currentLabel.phase !== 'issued' ||
      currentLabel.environment !== label.environment || (current.shipping.environment && current.shipping.environment !== config.environment) ||
      (current.fulfillmentStatus || legacyFulfillmentStatus(current.status, 'pago')) !== initialStage)
      throw shipmentFailure(409, 'O pedido mudou durante a consulta. Atualize a tela.');
    if (transition && (!verified || current.pagbankChargeId !== verified))
      throw shipmentFailure(409, 'O estado financeiro mudou durante a consulta.');
    const previous = isRecord(current.tracking) && current.tracking.provider === 'melhor_envio' ? current.tracking : {};
    const previousEventAt = typeof previous.eventAt === 'string' ? previous.eventAt : undefined;
    const outOfOrder = Boolean(previousEventAt && (eventAt ? previousEventAt > eventAt : !statuses[event.state]));
    const previousCode = validMelhorEnvioTrackingCode(previous.code) ? previous.code : '';
    const code = (outOfOrder ? previousCode : event.tracking) || previousCode || event.tracking ||
      (validMelhorEnvioTrackingCode(currentLabel.tracking) ? currentLabel.tracking : '');
    const stage = outOfOrder ? initialStage : transition || initialStage;
    const terminal = stage === 'entregue';
    const stop = (terminal && !!code) || event.discarded;
    const updatedAt = new Date(now).toISOString();
    const previousStatus = typeof previous.status === 'string' ? previous.status : '';
    const status = terminal ? 'Entregue' : (outOfOrder && previousStatus) || statuses[event.state] || (stage === 'enviado' ? 'Postado' : 'Etiqueta emitida');
    const latestEventAt = (outOfOrder ? previousEventAt : eventAt) || previousEventAt;
    const deliveredAt = delivered && !outOfOrder ? event.deliveredAt : typeof previous.deliveredAt === 'string' ? previous.deliveredAt : undefined;
    const tracking: OrderTracking = {
      provider: 'melhor_envio', code, status, updatedAt,
      ...(latestEventAt ? { eventAt: latestEventAt } : {}),
      ...(deliveredAt ? { deliveredAt } : {}),
    };
    tx.set(labelRef, {
      ...(code ? { tracking: code } : {}),
      nextTrackingAt: stop ? FieldValue.delete() : now + regularInterval,
    }, { merge: true });
    if (stage === 'enviado' || terminal) {
      const update = {
        tracking,
        ...(stage !== initialStage ? { fulfillmentStatus: stage, status: legacyStatusForFulfillment(stage), fulfillmentUpdatedAt: updatedAt } : {}),
      };
      queueOrderStatusEmail(tx, db, id, current, update, now);
      tx.set(orderRef, update, { merge: true });
      if (stage !== initialStage)
        tx.create(orderRef.collection('events').doc(randomUUID()), {
          type: 'melhor_envio_tracking_confirmed', status: stage, code, createdAt: updatedAt,
        });
    }
    return { tracking, fulfillmentStatus: stage };
  });
}

export async function processMelhorEnvioTracking(db: Firestore, paymentEnvironment: () => string, verify: VerifyPayment, now = Date.now()) {
  let checked = 0, failed = 0;
  if (process.env.MELHOR_ENVIO_TRACKING_ENABLED !== 'true') return { checked, failed };
  let environment: string;
  try {
    environment = paymentEnvironment();
    if (melhorEnvioConfig().environment !== environment) return { checked, failed };
  } catch {
    return { checked, failed: 1 };
  }
  const jobs = await db.collection('_melhorEnvioLabels').where('nextTrackingAt', '<=', now)
    .orderBy('nextTrackingAt').limit(10).get();
  await Promise.all(jobs.docs.map(async job => {
    try {
      const claimed = await db.runTransaction(async tx => {
        const label = (await tx.get(job.ref)).data();
        if (!label || typeof label.nextTrackingAt !== 'number' || label.nextTrackingAt > now) return false;
        const order = (await tx.get(db.collection('orders').doc(job.id))).data();
        const trackable = label.phase === 'issued' && label.environment === environment && canTrack(order);
        tx.set(job.ref, { nextTrackingAt: trackable ? now + retryInterval : FieldValue.delete() }, { merge: true });
        return trackable;
      });
      if (!claimed) return;
      await syncMelhorEnvioTracking(db, job.id, environment, verify, now);
      checked++;
    } catch {
      failed++;
    }
  }));
  return { checked, failed };
}
