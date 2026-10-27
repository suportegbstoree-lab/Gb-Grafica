import { strict as assert } from 'node:assert';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAdminServices } from './firebaseAdmin.js';

const originalBucket = process.env.FIREBASE_STORAGE_BUCKET;
const originalAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

afterEach(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)));
  if (originalBucket === undefined) delete process.env.FIREBASE_STORAGE_BUCKET;
  else process.env.FIREBASE_STORAGE_BUCKET = originalBucket;
  if (originalAccount === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = originalAccount;
});

test('usa o bucket configurado ao inicializar com JSON da conta de serviço', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    project_id: 'demo-security-test',
    client_email: 'test@demo-security-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  delete process.env.FIREBASE_STORAGE_BUCKET;
  assert.equal(getAdminServices().bucket.name, 'demo-security-test.firebasestorage.app');
});

test('prioriza o bucket explícito sobre o configurado no aplicativo', () => {
  initializeApp({ projectId: 'demo-security-test', storageBucket: 'configured.example' });
  process.env.FIREBASE_STORAGE_BUCKET = 'explicit.example';
  assert.equal(getAdminServices().bucket.name, 'explicit.example');
});

test('usa projectId quando não há bucket configurado', () => {
  initializeApp({ projectId: 'demo-security-test' });
  delete process.env.FIREBASE_STORAGE_BUCKET;
  assert.equal(getAdminServices().bucket.name, 'demo-security-test.firebasestorage.app');
});

test('informa erro quando não é possível determinar o bucket', () => {
  initializeApp({});
  delete process.env.FIREBASE_STORAGE_BUCKET;
  assert.throws(() => getAdminServices(), /Bucket do Firebase Storage não configurado/);
});
