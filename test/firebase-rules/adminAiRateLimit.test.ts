import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import test, { after, before, beforeEach, mock } from 'node:test';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import app from '../../src/server/app.js';

const keys = ['NODE_ENV', 'LOG_LEVEL', 'FIREBASE_APP_CHECK_MODE', 'FIREBASE_FIRESTORE_DATABASE_ID', 'FIREBASE_STORAGE_BUCKET', 'FIREBASE_AI_MODEL'] as const;
const previous = new Map(keys.map(key => [key, process.env[key]]));
const nativeFetch = globalThis.fetch;
let firebaseApp: App;
let db: Firestore;
let server: Server;
let baseUrl: string;
let epoch = 0;
let providerCalls = 0;
const budgetId = (key: string) => createHash('sha256').update(key).digest('hex');

before(async () => {
	// Este teste nunca pode apontar para o Firestore real, mesmo com credenciais no ambiente.
	assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^(localhost|127\.0\.0\.1|\[::1\]):\d+$/);
	Object.assign(process.env, { NODE_ENV: 'test', LOG_LEVEL: 'silent', FIREBASE_APP_CHECK_MODE: 'off', FIREBASE_FIRESTORE_DATABASE_ID: '(default)', FIREBASE_STORAGE_BUCKET: 'demo-gb-grafica-rules.invalid', FIREBASE_AI_MODEL: 'gemini-test' });
	firebaseApp = initializeApp({ projectId: 'demo-gb-grafica-rules' });
	mock.method(firebaseApp.options.credential, 'getAccessToken', async () => ({ access_token: 'oauth-emulator-only', expires_in: 3600 }));
	const auth = getAuth(firebaseApp);
	mock.method(auth, 'verifyIdToken', async (token: string, revoked?: boolean) => {
		assert.equal(revoked, true);
		return { uid: token, sub: token, admin: true } as unknown as DecodedIdToken;
	});
	mock.method(auth, 'getUser', async uid => ({ uid, disabled: false, customClaims: { admin: true } }) as unknown as ReturnType<typeof auth.getUser>);
	db = getFirestore(firebaseApp);
	mock.method(globalThis, 'fetch', async input => {
		assert.equal(new URL(String(input)).hostname, 'aiplatform.googleapis.com');
		providerCalls++;
		return Response.json({ candidates: [{ content: { parts: [{ text: 'Resposta fictícia' }] } }] });
	});
	server = createServer(app);
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Servidor indisponível.');
	baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
	epoch++; providerCalls = 0;
	await db.recursiveDelete(db.collection('_rateLimits'));
});

after(async () => {
	if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	if (db) await db.recursiveDelete(db.collection('_rateLimits'));
	mock.restoreAll();
	if (firebaseApp) await deleteApp(firebaseApp);
	for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

function request(uid: string) {
	return nativeFetch(`${baseUrl}/api/admin/ai/suggestions`, { method: 'POST', headers: { Authorization: `Bearer ${uid}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate', title: 'Produto de teste' }) });
}

test('IA: orçamento gravado por outra instância bloqueia um backend com contador local vazio', async () => {
	const uid = `admin-cold-${epoch}`;
	await db.collection('_rateLimits').doc(budgetId(`admin-ai:${uid}`)).set({ count: 10, resetAt: Date.now() + 60_000 });
	const response = await request(uid);
	assert.equal(response.status, 429);
	assert.equal((await response.json()).code, 'RATE_LIMITED');
	assert.equal(providerCalls, 0);
});

test('IA: consumo externo atualizado no Firestore é visto antes da próxima geração', async () => {
	const uid = `admin-shared-${epoch}`;
	for (let index = 0; index < 3; index++) assert.equal((await request(uid)).status, 200);
	const budget = db.collection('_rateLimits').doc(budgetId(`admin-ai:${uid}`));
	assert.equal((await budget.get()).data().count, 3);
	await budget.update({ count: 10 });
	assert.equal((await request(uid)).status, 429);
	assert.equal(providerCalls, 3);
});

test('IA: transação global admite só uma das doze solicitações concorrentes no último espaço', async () => {
	const budget = db.collection('_rateLimits').doc(budgetId('admin-ai:project'));
	await budget.set({ count: 59, resetAt: Date.now() + 60_000 });
	const responses = await Promise.all(Array.from({ length: 12 }, (_value, index) => request(`admin-concurrent-${epoch}-${index}`)));
	assert.equal(responses.filter(response => response.status === 200).length, 1);
	assert.equal(responses.filter(response => response.status === 429).length, 11);
	assert.equal(providerCalls, 1);
	assert.equal((await budget.get()).data().count, 60);
});
