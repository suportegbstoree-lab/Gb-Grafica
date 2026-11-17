import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { memoryFirestore } from '../../test/helpers/memoryFirestore.js';
import { NfeDraftError } from './nfeDraftError.js';
import { simulateNfe } from './nfeSimulation.js';

const previous = process.env.NFE_ENV;
beforeEach(() => { process.env.NFE_ENV = 'simulacao'; });
afterEach(() => {
  if (previous === undefined) delete process.env.NFE_ENV;
  else process.env.NFE_ENV = previous;
});
const isStatus = (status: number) => (error: unknown) => error instanceof NfeDraftError && error.status === status;

test('simulation is opt-in and leaves fiscal and order records unchanged', async () => {
  const { db, docs } = memoryFirestore([['orders/GB-REAL01234', { paymentStatus: 'pago' }]]);
  for (const value of [undefined, 'disabled', 'homologacao', 'production']) {
    if (value === undefined) delete process.env.NFE_ENV;
    else process.env.NFE_ENV = value;
    assert.equal((await simulateNfe(db, 'admin')).enabled, false);
    await assert.rejects(simulateNfe(db, 'admin', { action: 'review', revision: null }), isStatus(409));
  }
  assert.deepEqual([...docs], [['orders/GB-REAL01234', { paymentStatus: 'pago' }]]);
});

test('timeout commits exactly one attempt and a consultation recovers it after reconnecting', async () => {
  const { db, docs } = memoryFirestore();
  const { status } = await simulateNfe(db, 'admin', { action: 'review', revision: null });
  const emit = { action: 'emit', scenario: 'timeout', revision: status.revision };
  const [first, retry] = await Promise.allSettled([simulateNfe(db, 'admin', emit), simulateNfe(db, 'admin', emit)]);
  assert.equal(first.status, 'rejected');
  if (first.status === 'rejected') assert.ok(isStatus(504)(first.reason));
  assert.equal(retry.status, 'fulfilled');
  const retryState = retry.status === 'fulfilled' ? retry.value.status : null;
  const reopened = await simulateNfe(db, 'admin');
  assert.equal(reopened.status.phase, 'uncertain');
  assert.equal(reopened.status.attemptId, retryState?.attemptId);
  assert.match(reopened.status.attemptId!, /^SIM-[0-9a-f-]{36}$/);
  assert.equal((await simulateNfe(db, 'another-admin')).status.phase, 'draft');
  await assert.rejects(simulateNfe(db, 'admin', { action: 'reset', revision: reopened.status.revision }), isStatus(409));
  const result = await simulateNfe(db, 'admin', { action: 'consult', revision: reopened.status.revision });
  assert.equal(result.status.phase, 'authorized');
  assert.equal(result.status.attemptId, reopened.status.attemptId);
  assert.equal((await simulateNfe(db, 'admin', emit)).status.phase, 'authorized');
  assert.doesNotMatch(JSON.stringify(result), /accessKey|protocol|xml|danfe/i);
  assert.deepEqual([...docs.keys()], ['_fiscalSimulations/admin']);
});

test('authorization, rejection and cancellation keep a consistent simulation revision', async () => {
  const { db } = memoryFirestore();
  const perform = (action: string, revision: string | null, scenario?: string) =>
    simulateNfe(db, 'admin', { action, revision, scenario }).then(view => view.status);
  const reviewed = await perform('review', null);
  await assert.rejects(perform('emit', reviewed.revision, 'invalid'), isStatus(422));
  const processing = await perform('emit', reviewed.revision, 'success');
  assert.equal(processing.phase, 'processing');
  const authorized = await perform('consult', processing.revision);
  await assert.rejects(perform('cancel', processing.revision), isStatus(409));
  const canceled = await perform('cancel', authorized.revision);
  assert.equal(canceled.phase, 'canceled');
  assert.equal(canceled.attemptId, processing.attemptId);
  const reset = await perform('reset', canceled.revision);
  const anotherReview = await perform('review', reset.revision);
  const anotherAttempt = await perform('emit', anotherReview.revision, 'rejection');
  const rejected = await perform('consult', anotherAttempt.revision);
  assert.equal(rejected.phase, 'rejected');
  assert.notEqual(rejected.attemptId, canceled.attemptId);
  await assert.rejects(perform('cancel', rejected.revision), isStatus(409));
});
