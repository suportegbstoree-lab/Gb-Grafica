import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import axios, { type AxiosRequestConfig } from 'axios';
import { memoryFirestore } from '../../test/helpers/memoryFirestore.js';
import { processMelhorEnvioTracking, syncMelhorEnvioTracking } from './melhorEnvioTracking.js';

const orderId = 'GB-RASTREIO-TESTE';
const orderPath = `orders/${orderId}`;
const labelPath = `_melhorEnvioLabels/${orderId}`;
const providerId = 'a33865e5-6c42-484d-9ec2-8a94e29484b7';
const chargeId = 'CHAR_RASTREIO';
const now = Date.parse('2026-09-10T18:00:00Z');
const postedAt = '2026-09-09T17:00:00.000Z';
const deliveredAt = '2026-09-10T12:00:00.000Z';
const env = {
  MELHOR_ENVIO_ENV: 'sandbox', MELHOR_ENVIO_TOKEN: 'token-de-teste', MELHOR_ENVIO_SERVICES: '',
  MELHOR_ENVIO_ORIGIN_CEP: '14400000', MELHOR_ENVIO_CONTACT_EMAIL: 'tecnico@example.test',
  MELHOR_ENVIO_TRACKING_ENABLED: 'false',
};
const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
beforeEach(() => { Object.assign(process.env, env); });
afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function scenario() {
  const { db, docs } = memoryFirestore([
    [orderPath, { userId: 'customer', data: '2026-09-01T12:00:00Z', paymentStatus: 'pago', fulfillmentStatus: 'em_producao',
      pagbankChargeId: chargeId, shipping: { provider: 'melhor_envio', environment: 'sandbox' } }],
    [labelPath, { phase: 'issued', environment: 'sandbox', providerId, nextTrackingAt: now - 1 }],
  ]);
  let calls = 0, checks = 0;
  let event: Record<string, unknown> = { status: 'generated' };
  mock.method(axios, 'request', async (request: AxiosRequestConfig) => {
    calls++;
    assert.equal(request.method, 'GET');
    assert.equal(request.url, `https://sandbox.melhorenvio.com.br/api/v2/me/orders/${providerId}`);
    return { status: 200, data: { id: providerId, ...event } };
  });
  const verify = async () => { checks++; return chargeId; };
  return {
    docs, sync: (environment = 'sandbox') => syncMelhorEnvioTracking(db, orderId, environment, verify, now),
    process: () => processMelhorEnvioTracking(db, () => 'sandbox', verify, now),
    setEvent: (value: Record<string, unknown>) => { event = value; },
    calls: () => calls, checks: () => checks,
  };
}

test('separates issuance, posting and delivery and saves late tracking codes', async () => {
  const s = scenario();
  assert.equal((await s.sync()).fulfillmentStatus, 'em_producao');
  assert.equal(s.docs.get(orderPath)?.tracking, undefined);
  s.setEvent({ status: 'posted', posted_at: '2026-09-09 17:00:00' });
  const posted = await s.sync();
  assert.equal(posted.fulfillmentStatus, 'enviado');
  assert.equal(posted.tracking.eventAt, postedAt);
  assert.equal(posted.tracking.code, '');
  s.setEvent({ status: 'delivered', posted_at: postedAt, delivered_at: deliveredAt });
  assert.equal((await s.sync()).fulfillmentStatus, 'entregue');
  assert.equal(typeof s.docs.get(labelPath)?.nextTrackingAt, 'number');
  s.setEvent({ status: 'delivered', delivered_at: deliveredAt, tracking: 'BR2684621549924' });
  assert.equal((await s.sync()).tracking.code, 'BR2684621549924');
  assert.equal(s.docs.get(labelPath)?.nextTrackingAt, undefined);
  assert.equal(s.docs.get('_emailOutbox/order-GB-RASTREIO-TESTE-3')?.trackingCode, 'BR2684621549924');
  s.setEvent({ status: 'posted', posted_at: postedAt, tracking: '123456' });
  const stale = await s.sync();
  assert.equal(stale.fulfillmentStatus, 'entregue');
  assert.equal(stale.tracking.deliveredAt, deliveredAt);
  assert.equal(stale.tracking.code, 'BR2684621549924');
  assert.equal(s.checks(), 2);
});

test('does not use a different environment, refunded order or pre-order event', async () => {
  const s = scenario();
  await assert.rejects(s.sync('production'), /mesmo ambiente/);
  s.docs.get(orderPath)!.pagbankRefundedAmountCents = 1;
  await assert.rejects(s.sync(), /pagamento confirmado/);
  assert.equal(s.calls(), 0);
  delete s.docs.get(orderPath)!.pagbankRefundedAmountCents;
  s.setEvent({ status: 'posted', posted_at: '2026-08-01T12:00:00Z' });
  assert.equal((await s.sync()).fulfillmentStatus, 'em_producao');
  assert.equal(s.checks(), 0);
});

test('automatic tracking is opt-in and concurrent maintenance runs claim each label once', async () => {
  const s = scenario();
  assert.deepEqual(await s.process(), { checked: 0, failed: 0 });
  assert.equal(s.calls(), 0);
  process.env.MELHOR_ENVIO_TRACKING_ENABLED = 'true';
  s.setEvent({ status: 'posted', posted_at: postedAt, tracking: 'BR2684621549924' });
  const results = await Promise.all([s.process(), s.process()]);
  assert.equal(results.reduce((count, result) => count + result.checked, 0), 1);
  assert.equal(s.calls(), 1);
  assert.equal(s.docs.get(orderPath)?.fulfillmentStatus, 'enviado');
  assert.ok(Number(s.docs.get(labelPath)?.nextTrackingAt) > now);
});
