import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryFirestore } from '../../test/helpers/memoryFirestore';
import { queueStaffEmail, sendStaffEmail } from './staffEmail';

test('staff email queue truthfully reports missing configuration without external requests', async () => {
  const old = process.env.RESEND_API_KEY; process.env.RESEND_API_KEY = '';
  try { const fake = memoryFirestore(); const result = await queueStaffEmail(fake.db, 'employee@example.test', 'designer'); assert.equal(result.status, 'not_configured'); assert.equal(fake.docs.get(`_staffNotifications/${result.id}`)?.status, 'pending'); }
  finally { old === undefined ? delete process.env.RESEND_API_KEY : process.env.RESEND_API_KEY = old; }
});
test('staff email retries use server recipient and a stable idempotency key, accepted messages are not sent twice', async () => {
  const oldKey = process.env.RESEND_API_KEY, oldFrom = process.env.STAFF_EMAIL_FROM;
  process.env.RESEND_API_KEY = 'test-key'; process.env.STAFF_EMAIL_FROM = 'loja@example.test';
  try {
    const fake = memoryFirestore([['_staffNotifications/notice', { schemaVersion: 1, email: 'employee@example.test', role: 'designer', createdAt: new Date().toISOString(), status: 'pending', attempts: 0 }]]);
    let count = 0;
    const fetcher = async (input: unknown, init?: RequestInit) => { count++; assert.equal(input, 'https://api.resend.com/emails'); assert.equal(new Headers(init?.headers).get('idempotency-key'), 'staff-role-notice'); assert.deepEqual(JSON.parse(String(init?.body)).to, ['employee@example.test']); return count === 1 ? Response.json({}, { status: 503 }) : Response.json({ id: 'provider-message' }); };
    assert.equal(await sendStaffEmail(fake.db, 'notice', fetcher as typeof fetch), 'pending');
    assert.equal(await sendStaffEmail(fake.db, 'notice', fetcher as typeof fetch), 'accepted');
    assert.equal(await sendStaffEmail(fake.db, 'notice', fetcher as typeof fetch), 'accepted'); assert.equal(count, 2);
    fake.docs.set('_staffNotifications/old', { ...fake.docs.get('_staffNotifications/notice'), createdAt: '2020-01-01T00:00:00Z', status: 'pending' });
    assert.equal(await sendStaffEmail(fake.db, 'old', fetcher as typeof fetch), 'pending'); assert.equal(count, 2);
  } finally { for (const [key, value] of [['RESEND_API_KEY', oldKey], ['STAFF_EMAIL_FROM', oldFrom]]) value === undefined ? delete process.env[key!] : process.env[key!] = value; }
});
