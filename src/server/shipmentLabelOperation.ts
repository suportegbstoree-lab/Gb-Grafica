import type { Firestore } from 'firebase-admin/firestore';
import { isRecord } from '../lib/shipping.js';
import { legacyFulfillmentStatus } from '../lib/orderStatus.js';
import type { ShipmentLabelView } from '../lib/shipmentLabel.js';
import { melhorEnvioConfig, type MelhorEnvioConfig } from './melhorEnvio.js';
import { shipmentCartBody, shipmentFailure, shipmentProvider, ShipmentProviderError } from './melhorEnvioShipment.js';

type Row = Record<string, unknown>;
interface SavedLabel extends ShipmentLabelView {
  environment: MelhorEnvioConfig['environment'];
  updatedAt: number;
}

const view = (row?: SavedLabel): ShipmentLabelView => row ? {
  phase: row.phase, amountCents: row.amountCents,
  ...(row.providerId ? { providerId: row.providerId } : {}),
  ...(row.tracking ? { tracking: row.tracking } : {}),
} : { phase: 'none', amountCents: null };

function activePaidDelivery(order: Row | undefined, chargeId?: string) {
  if (!order) throw shipmentFailure(404, 'Pedido não encontrado.');
  if (order.metodoEntrega !== 'entrega' || !isRecord(order.shipping) || order.shipping.provider !== 'melhor_envio')
    throw shipmentFailure(422, 'Este pedido não tem entrega cotada pelo Melhor Envio.');
  if (order.paymentStatus !== 'pago' || Number(order.pagbankRefundedAmountCents) > 0 ||
    (chargeId !== undefined && order.pagbankChargeId !== chargeId))
    throw shipmentFailure(409, 'A etiqueta exige um pedido com pagamento confirmado e sem estorno.');
  return order;
}
function prePosting(order: Row) {
  const phase = order.fulfillmentStatus ?? legacyFulfillmentStatus(String(order.status), 'pago');
  if (phase !== 'pagamento_confirmado' && phase !== 'em_producao')
    throw shipmentFailure(409, 'Prepare a etiqueta antes de registrar a postagem.');
}

export async function shipmentLabelOperation(input: {
  db: Firestore;
  orderId: string;
  actor: string;
  body: Row;
  paymentEnvironment: () => string;
  verifyPayment: (order: Row) => Promise<string>;
}): Promise<ShipmentLabelView | Buffer> {
  const { db, orderId, actor, body } = input;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(orderId) || typeof body.action !== 'string' || !['status', 'prepare', 'recover', 'issue', 'print'].includes(body.action))
    throw shipmentFailure(422, 'Pedido ou operação de etiqueta inválida.');
  const orderRef = db.collection('orders').doc(orderId);
  const labelRef = db.collection('_melhorEnvioLabels').doc(orderId);
  const [orderSnap, labelSnap] = await Promise.all([orderRef.get(), labelRef.get()]);
  const order = activePaidDelivery(orderSnap.data());
  const saved = labelSnap.data() as SavedLabel | undefined;
  if (body.action === 'status') return view(saved);
  const config = melhorEnvioConfig();
  const storedEnvironment = (order.shipping as Row).environment;
  if (config.environment !== input.paymentEnvironment() ||
    (storedEnvironment && storedEnvironment !== config.environment) ||
    (saved && saved.environment !== config.environment))
    throw shipmentFailure(409, 'O pedido, o PagBank e o Melhor Envio precisam usar o mesmo ambiente. Para testar com o PagBank em produção, use o pedido de exemplo do sandbox.');
  const service = shipmentProvider(config);
  if (body.action === 'print') {
    if (!saved?.providerId || saved.phase !== 'issued')
      throw shipmentFailure(409, 'A etiqueta precisa estar emitida para baixar o PDF.');
    return service.pdf(saved.providerId);
  }
  const change = async (expected: SavedLabel | undefined, patch: Partial<SavedLabel>, chargeId?: string) =>
    db.runTransaction(async tx => {
      if (chargeId !== undefined) prePosting(activePaidDelivery((await tx.get(orderRef)).data(), chargeId));
      const current = (await tx.get(labelRef)).data() as SavedLabel | undefined;
      if (current?.phase !== expected?.phase || current?.updatedAt !== expected?.updatedAt)
        throw shipmentFailure(409, 'Outra operação alterou a etiqueta. Atualize a situação antes de continuar.');
      const next: SavedLabel = {
        phase: 'none', amountCents: null, ...current, ...patch,
        environment: config.environment, updatedAt: Math.max(Date.now(), (current?.updatedAt ?? 0) + 1),
      };
      tx.set(labelRef, { ...next, updatedBy: actor });
      return next;
    });

  if (body.action === 'prepare') {
    if (saved && saved.phase !== 'none') return view(saved);
    prePosting(order);
    const payload = shipmentCartBody(orderId, order, body, config);
    const chargeId = await input.verifyPayment(order);
    const preparing = await change(saved, { phase: 'preparing' }, chargeId);
    let cart;
    try {
      cart = await service.create(payload);
    } catch (error) {
      if (error instanceof ShipmentProviderError && error.rejected)
        await change(preparing, { phase: 'none' });
      throw error;
    }
    return view(await change(preparing, { phase: 'cart', providerId: cart.id, amountCents: cart.amountCents }));
  }

  if (body.action === 'recover') {
    if (saved?.phase !== 'preparing' || Date.now() - saved.updatedAt < 20_000 || typeof body.providerId !== 'string')
      throw shipmentFailure(409, 'Aguarde a confirmação da preparação antes de vincular o envio encontrado no Melhor Envio.');
    prePosting(order);
    const details = await service.details(body.providerId);
    const serviceCode = (order.shipping as Row).service_code;
    if (details.unavailable || `me:${details.service}` !== serviceCode ||
      !details.tags.some(tag => isRecord(tag) && tag.tag === orderId))
      throw shipmentFailure(422, 'A etiqueta do Melhor Envio precisa ter o mesmo serviço e a identificação deste pedido.');
    const chargeId = await input.verifyPayment(order);
    return view(await change(saved, {
      phase: details.issued ? 'issued' : details.paid ? 'paid' : 'cart',
      providerId: body.providerId, amountCents: details.amountCents,
      ...(details.tracking ? { tracking: details.tracking } : {}),
    }, chargeId));
  }

  if (!saved?.providerId) throw shipmentFailure(409, 'Prepare o envio antes de emitir a etiqueta.');
  if (saved.phase === 'issued') return view(saved);
  const providerId = saved.providerId;
  let current = saved;
  let details = await service.details(providerId);
  if (details.unavailable) throw shipmentFailure(409, 'A etiqueta vinculada está cancelada, suspensa ou expirada no Melhor Envio.');
  if (!details.paid) {
    if (saved.phase === 'buying') return view(saved);
    if (saved.phase !== 'cart' || !details.pending)
      throw shipmentFailure(409, 'O Melhor Envio ainda não confirmou o estado de compra da etiqueta.');
    if (details.amountCents === null)
      throw shipmentFailure(502, 'O Melhor Envio não informou o valor da etiqueta.');
    if (details.amountCents !== saved.amountCents || body.expectedAmountCents !== details.amountCents)
      return view(await change(saved, { amountCents: details.amountCents }));
    const chargeId = await input.verifyPayment(order);
    current = await change(saved, { phase: 'buying' }, chargeId);
    try {
      await service.checkout(providerId);
    } catch (error) {
      if (error instanceof ShipmentProviderError && error.rejected)
        await change(current, { phase: 'cart' });
      throw error;
    }
    details = await service.details(providerId);
    if (!details.paid) return view(current);
    if (!details.unavailable && !details.issued) return view(await change(current, { phase: 'paid' }));
  }
  if (details.unavailable) throw shipmentFailure(409, 'O Melhor Envio suspendeu a etiqueta.');
  if (details.issued) return view(await change(current, {
    phase: 'issued', ...(details.tracking ? { tracking: details.tracking } : {}),
  }));
  if (current.phase === 'generating' && Date.now() - current.updatedAt < 60_000) return view(current);
  // Save the paid state even if a refund or a failed generation blocks the next step.
  if (current.phase !== 'paid' && current.phase !== 'generating')
    current = await change(current, { phase: 'paid' });
  const chargeId = await input.verifyPayment(order);
  current = await change(current, { phase: 'generating' }, chargeId);
  try {
    await service.generate(providerId);
  } catch (error) {
    if (error instanceof ShipmentProviderError && error.rejected) await change(current, { phase: 'paid' });
    throw error;
  }
  details = await service.details(providerId);
  if (details.unavailable) throw shipmentFailure(409, 'O Melhor Envio suspendeu a etiqueta.');
  if (!details.issued) return view(current);
  return view(await change(current, { phase: 'issued', ...(details.tracking ? { tracking: details.tracking } : {}) }));
}
