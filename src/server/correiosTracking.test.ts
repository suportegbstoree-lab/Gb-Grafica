import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { parseCorreiosTracking } from './correiosTrackingResponse';
import { syncCorreiosTracking, processTrackingJobs, cronAuthorized } from './correiosTracking';
import { CorreiosClient, correiosConfig } from './correios';
import { memoryFirestore } from '../../test/helpers/memoryFirestore';
const code = 'AA123456789BR', now = Date.parse('2026-10-30T14:00:00Z');
const delivered = { codigo: 'BDE', tipo: '01', dtHrCriado: '2026-10-30T10:00:00', descricao: 'Objeto entregue ao destinatário' };
const response = (events: unknown[], objectCode = code) => ({ objetos: [{ codObjeto: objectCode, eventos: events }] });
const event = () => parseCorreiosTracking(response([delivered]), code, now);
const initial = () => ({ data: '2026-10-29T12:00:00Z', paymentStatus: 'pago', pagbankChargeId: 'CHARGE', fulfillmentStatus: 'enviado', status: 'Enviado', tracking: { provider: 'correios', code, updatedAt: '2026-10-29T12:00:00Z' } });
test('tracking confirms only the latest BDE/01 and interprets timezone-less Correios time as Brazil -03', () => {
  assert.equal(event().at, '2026-10-30T13:00:00.000Z'); assert.equal(event().delivered, true);
  assert.equal(parseCorreiosTracking(response([{ ...delivered, codigo: 'OEC', tipo: '03', descricao: 'Objeto não entregue' }]), code, now).delivered, false);
  assert.equal(parseCorreiosTracking(response([delivered, { ...delivered, codigo: 'OEC', tipo: '03', dtHrCriado: '2026-10-30T10:05:00' }]), code, now).delivered, false);
  assert.equal(parseCorreiosTracking(response([delivered, { ...delivered, codigo: 'OEC', tipo: '03' }]), code, now).delivered, false);
});
test('tracking rejects wrong object, malformed calendar, future dates and empty results', () => {
  for (const input of [response([delivered], 'BB123456789BR'), response([]), response([{ ...delivered, dtHrCriado: '2026-02-30T10:00:00' }]), response([{ ...delivered, dtHrCriado: '2027-01-01T10:00:00' }]), { objetos: [{ codObjeto: code, eventos: [delivered], mensagem: 'Sem autorização' }] }]) assert.throws(() => parseCorreiosTracking(input, code, now));
});
test('tracking uses the official fixed GET endpoint and the server bearer token', async () => {
  const config = correiosConfig({ CORREIOS_ORIGIN_CEP: '14400000', CORREIOS_SERVICES: '03220:SEDEX', CORREIOS_TOKEN: 'server-token' });
  const client = new CorreiosClient(config, async () => { throw new Error('POST unexpected'); }, () => now, async (url, auth) => {
    assert.equal(url, `https://api.correios.com.br/srorastro/v1/objetos/${code}?resultado=T`); assert.equal(auth, 'Bearer server-token'); return { status: 200, data: response([delivered]) };
  });
  assert.equal((await client.track(code)).delivered, true);
  await assert.rejects(client.track('https://elsewhere.test'), /inválido/);
});
test('delivery reconciliation requires current paid charge, records proof and removes the tracking job atomically', async () => {
  const fake = memoryFirestore([['orders/order', initial()], ['_trackingJobs/order', { code, nextCheckAt: 0 }]]);
  await syncCorreiosTracking(fake.db, 'order', async () => 'CHARGE', async () => event(), now);
  assert.equal(fake.docs.get('orders/order')?.fulfillmentStatus, 'entregue'); assert.equal(fake.docs.has('_trackingJobs/order'), false);
  assert.equal([...fake.docs.keys()].filter(key => key.startsWith('orders/order/events')).length, 1);
  await assert.rejects(syncCorreiosTracking(fake.db, 'order', async () => 'CHARGE', async () => event(), now));
});
test('an in-flight tracking response cannot finish a cancelled, refunded or reassigned shipment', async () => {
  for (const mutation of [{ fulfillmentStatus: 'cancelado' }, { pagbankRefundedAmountCents: 1 }, { tracking: { provider: 'correios', code: 'BB123456789BR' } }]) {
    const fake = memoryFirestore([['orders/order', initial()]]);
    await assert.rejects(syncCorreiosTracking(fake.db, 'order', async () => 'CHARGE', async () => { fake.docs.set('orders/order', { ...fake.docs.get('orders/order'), ...mutation }); return event(); }, now));
    assert.notEqual(fake.docs.get('orders/order')?.fulfillmentStatus, 'entregue');
  }
});
test('non-delivery events update tracking without a payment call, old object history cannot conclude a new order', async () => {
  const fake = memoryFirestore([['orders/order', initial()]]);
  await syncCorreiosTracking(fake.db, 'order', async () => { throw new Error('must not verify'); }, async () => ({ ...event(), delivered: false, description: 'Em trânsito' }), now);
  assert.equal(fake.docs.get('orders/order')?.fulfillmentStatus, 'enviado');
  await assert.rejects(syncCorreiosTracking(fake.db, 'order', async () => 'CHARGE', async () => ({ ...event(), at: '2026-10-01T00:00:00Z' }), now));
});
test('maintenance authenticates by a sufficiently long secret, never a user agent or short value', () => {
  assert.equal(cronAuthorized(undefined, 'a'.repeat(32)), false); assert.equal(cronAuthorized('Bearer short', 'short'), false);
  assert.equal(cronAuthorized(`Bearer ${'a'.repeat(32)}`, 'a'.repeat(32)), true); assert.equal(cronAuthorized(`Bearer ${'b'.repeat(32)}`, 'a'.repeat(32)), false);
});

function enableTracking(t: TestContext) {
  const enabled = process.env.CORREIOS_TRACKING_ENABLED, batch = process.env.CORREIOS_TRACKING_BATCH_SIZE;
  process.env.CORREIOS_TRACKING_ENABLED = 'true';
  process.env.CORREIOS_TRACKING_BATCH_SIZE = '10';
  t.after(() => {
    if (enabled === undefined) delete process.env.CORREIOS_TRACKING_ENABLED; else process.env.CORREIOS_TRACKING_ENABLED = enabled;
    if (batch === undefined) delete process.env.CORREIOS_TRACKING_BATCH_SIZE; else process.env.CORREIOS_TRACKING_BATCH_SIZE = batch;
  });
}
function afterTrackingQuery(t: TestContext, fake: ReturnType<typeof memoryFirestore>, change: () => void) {
  const collection = fake.db.collection.bind(fake.db);
  t.mock.method(fake.db, 'collection', (path: string) => {
    const ref = collection(path);
    if (path === '_trackingJobs') {
      const get = ref.get.bind(ref);
      t.mock.method(ref, 'get', async () => { const snapshot = await get(); change(); return snapshot; });
    }
    return ref;
  });
}
const neverVerify = async () => { throw new Error('unexpected payment verification'); };
const neverFetch = async () => { throw new Error('unexpected tracking request'); };
const dueJob = () => ({ code, nextCheckAt: now - 1, attempts: 0 });

test('the automatic queue reconciles legacy Enviado orders using the same payment and delivery guards', async t => {
  enableTracking(t);
  const order: Record<string, unknown> = initial(); delete order.fulfillmentStatus;
  const fake = memoryFirestore([['orders/order', order], ['_trackingJobs/order', dueJob()]]);
  let verified = 0;
  assert.deepEqual(await processTrackingJobs(fake.db, async () => { verified++; return 'CHARGE'; }, now, async () => event()), { checked: 1, failed: 0 });
  assert.equal(verified, 1);
  assert.equal(fake.docs.get('orders/order')?.fulfillmentStatus, 'entregue');
  assert.equal(fake.docs.has('_trackingJobs/order'), false);
});

test('a code correction after the queue query preserves the replacement job and skips the obsolete snapshot', async t => {
  enableTracking(t);
  const replacement = { code: 'BB123456789BR', nextCheckAt: now, attempts: 0 };
  const fake = memoryFirestore([['orders/order', initial()], ['_trackingJobs/order', dueJob()]]);
  afterTrackingQuery(t, fake, () => {
    fake.docs.set('orders/order', { ...initial(), tracking: { provider: 'correios', code: replacement.code } });
    fake.docs.set('_trackingJobs/order', replacement);
  });
  assert.deepEqual(await processTrackingJobs(fake.db, neverVerify, now, neverFetch), { checked: 0, failed: 0 });
  assert.deepEqual(fake.docs.get('_trackingJobs/order'), replacement);
  t.mock.restoreAll();
  assert.deepEqual(await processTrackingJobs(fake.db, neverVerify, now, async requestedCode => {
    assert.equal(requestedCode, replacement.code);
    return { ...event(), delivered: false, description: 'Em trânsito' };
  }), { checked: 1, failed: 0 });
  assert.deepEqual(fake.docs.get('_trackingJobs/order'), { ...replacement, nextCheckAt: now + 86_400_000 });
});

test('a concurrent reschedule for the same code is preserved without a duplicate tracking call', async t => {
  enableTracking(t);
  const replacement = { ...dueJob(), nextCheckAt: now + 60_000 };
  const fake = memoryFirestore([['orders/order', initial()], ['_trackingJobs/order', dueJob()]]);
  afterTrackingQuery(t, fake, () => { fake.docs.set('_trackingJobs/order', replacement); });
  assert.deepEqual(await processTrackingJobs(fake.db, neverVerify, now, neverFetch), { checked: 0, failed: 0 });
  assert.deepEqual(fake.docs.get('_trackingJobs/order'), replacement);
});

test('queue cleanup removes only obsolete shipments without making provider calls', async t => {
  enableTracking(t);
  const obsolete = [undefined, { ...initial(), fulfillmentStatus: 'entregue' }, { ...initial(), fulfillmentStatus: 'cancelado' },
    { ...initial(), tracking: { provider: 'other', code } }, { ...initial(), tracking: { provider: 'correios', code: 'BB123456789BR' } },
    { ...initial(), tracking: { provider: 'correios', code: 'invalid' } }];
  for (const order of obsolete) {
    const fake = memoryFirestore([['_trackingJobs/order', dueJob()]]);
    if (order) fake.docs.set('orders/order', order);
    assert.deepEqual(await processTrackingJobs(fake.db, neverVerify, now, neverFetch), { checked: 0, failed: 0 });
    assert.equal(fake.docs.has('_trackingJobs/order'), false);
    assert.deepEqual(fake.docs.get('orders/order'), order);
  }
});

test('a failed tracking request postpones its unchanged job and increments attempts', async t => {
  enableTracking(t);
  const fake = memoryFirestore([['orders/order', initial()], ['_trackingJobs/order', { ...dueJob(), attempts: 2 }]]);
  assert.deepEqual(await processTrackingJobs(fake.db, neverVerify, now, async () => { throw new Error('provider unavailable'); }), { checked: 0, failed: 1 });
  assert.deepEqual(fake.docs.get('_trackingJobs/order'), { code, nextCheckAt: now + 86_400_000, attempts: 3 });
  assert.equal(fake.docs.get('orders/order')?.fulfillmentStatus, 'enviado');
});

test('a late delivery response cannot change a corrected shipment or postpone its replacement job', async t => {
  enableTracking(t);
  const replacement = { code: 'BB123456789BR', nextCheckAt: now, attempts: 0 };
  const fake = memoryFirestore([['orders/order', initial()], ['_trackingJobs/order', dueJob()]]);
  assert.deepEqual(await processTrackingJobs(fake.db, async () => 'CHARGE', now, async () => {
    fake.docs.set('orders/order', { ...initial(), tracking: { provider: 'correios', code: replacement.code } });
    fake.docs.set('_trackingJobs/order', replacement);
    return event();
  }), { checked: 0, failed: 1 });
  assert.deepEqual(fake.docs.get('_trackingJobs/order'), replacement);
  assert.equal(fake.docs.get('orders/order')?.fulfillmentStatus, 'enviado');
  assert.equal([...fake.docs.keys()].some(key => key.startsWith('orders/order/events/')), false);
});

test('failure backoff preserves newer same-code schedules and jobs removed by another delivery', async t => {
  enableTracking(t);
  for (const replacement of [{ ...dueJob(), nextCheckAt: now + 3_600_000 }, undefined]) {
    const fake = memoryFirestore([['orders/order', initial()], ['_trackingJobs/order', dueJob()]]);
    assert.deepEqual(await processTrackingJobs(fake.db, neverVerify, now, async () => {
      if (replacement) fake.docs.set('_trackingJobs/order', replacement); else fake.docs.delete('_trackingJobs/order');
      throw new Error('provider unavailable');
    }), { checked: 0, failed: 1 });
    assert.deepEqual(fake.docs.get('_trackingJobs/order'), replacement);
  }
});

test('disabled tracking and jobs scheduled in the future do not call the provider', async t => {
  enableTracking(t);
  const fake = memoryFirestore([['orders/order', initial()], ['_trackingJobs/order', { ...dueJob(), nextCheckAt: now + 1 }]]);
  assert.deepEqual(await processTrackingJobs(fake.db, neverVerify, now, neverFetch), { checked: 0, failed: 0 });
  fake.docs.set('_trackingJobs/order', dueJob()); process.env.CORREIOS_TRACKING_ENABLED = 'false';
  assert.deepEqual(await processTrackingJobs(fake.db, neverVerify, now, neverFetch), { checked: 0, failed: 0 });
  assert.deepEqual(fake.docs.get('_trackingJobs/order'), dueJob());
});
