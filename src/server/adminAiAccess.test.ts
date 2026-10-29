import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import test, { after, before, beforeEach, mock } from 'node:test';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import clientConfig from '../../firebase-applet-config.json' with { type: 'json' };
import app from './app.js';

const keys = ['NODE_ENV', 'APP_URL', 'LOG_LEVEL', 'FIREBASE_APP_CHECK_MODE', 'FIREBASE_FIRESTORE_DATABASE_ID', 'FIREBASE_STORAGE_BUCKET', 'FIREBASE_AI_MODEL', 'FIREBASE_AI_LOCATION'] as const;
const previous = new Map(keys.map(key => [key, process.env[key]]));
const nativeFetch = globalThis.fetch;
const documents = new Map<string, Record<string, unknown>>();
const verified: string[] = [];
const providerCalls: { url: string; init: RequestInit }[] = [];
let oauthCalls = 0;
let providerStatus = 200;
let generation = 0;
let accountEpoch = 'a'.repeat(32);
let registryUnavailable = false;
let server: Server;
let firebaseApp: App;
let baseUrl: string;

function uid(kind: string) { return `${kind}-${generation}`; }
function reference(path: string) {
	return { path, async get() {
		if (path.startsWith('_adminAccess/')) {
			if (registryUnavailable) throw new Error('registry unavailable');
			const value = documents.get('_adminAccess/current');
			return { exists: value !== undefined, data: () => value };
		}
		if (path.startsWith('users/')) return { exists: [ `users/${uid('legacy')}`, `users/${uid('versioned')}` ].includes(path), data: () => ({ role: 'admin' }) };
		const value = documents.get(path);
		return { exists: value !== undefined, data: () => value };
	} };
}
type Ref = ReturnType<typeof reference>;
const transaction = {
	get: (ref: Ref) => ref.get(),
	set: (ref: Ref, data: Record<string, unknown>) => { documents.set(ref.path, data); },
	update: (ref: Ref, data: Record<string, unknown>) => { documents.set(ref.path, { ...documents.get(ref.path), ...data }); },
};

before(async () => {
	Object.assign(process.env, { NODE_ENV: 'production', APP_URL: 'https://loja.example', LOG_LEVEL: 'silent', FIREBASE_APP_CHECK_MODE: 'off', FIREBASE_FIRESTORE_DATABASE_ID: 'admin-ai-access-tests', FIREBASE_STORAGE_BUCKET: 'demo-admin-ai.invalid', FIREBASE_AI_LOCATION: 'global', FIREBASE_AI_MODEL: 'gemini-test' });
	firebaseApp = initializeApp({ projectId: 'demo-admin-ai' });
	mock.method(firebaseApp.options.credential, 'getAccessToken', async () => { oauthCalls++; return { access_token: 'oauth-servidor-sentinel', expires_in: 3600 }; });
	const auth = getAuth(firebaseApp);
	mock.method(auth, 'verifyIdToken', async (token: string, checkRevoked?: boolean) => {
		assert.equal(checkRevoked, true);
		verified.push(token);
		if (['revoked', 'expired', 'disabled', 'invalid', 'auth-unavailable'].includes(token)) {
			const code = token === 'revoked' ? 'auth/id-token-revoked' : token === 'expired' ? 'auth/id-token-expired' : token === 'disabled' ? 'auth/user-disabled' : token === 'auth-unavailable' ? 'auth/internal-error' : 'auth/invalid-id-token';
			throw Object.assign(new Error('falha-ficticia-sem-credenciais'), { code });
		}
		return { uid: uid(token), sub: uid(token), admin: ['admin', 'stale', 'account-disabled', 'claim-unavailable', 'versioned'].includes(token), ...(token === 'versioned' ? { gbAdminEpoch: 'a'.repeat(32) } : {}) } as unknown as DecodedIdToken;
	});
	mock.method(auth, 'getUser', async id => {
		if (id === uid('claim-unavailable')) throw Object.assign(new Error('falha-ficticia'), { code: 'auth/internal-error' });
		return { uid: id, disabled: id === uid('account-disabled'), customClaims: { admin: id !== uid('stale'), ...(id === uid('versioned') ? { gbAdminEpoch: accountEpoch } : {}) } } as unknown as Awaited<ReturnType<typeof auth.getUser>>;
	});
	mock.method(getAppCheck(firebaseApp), 'verifyToken', async () => ({ appId: clientConfig.appId } as Awaited<ReturnType<ReturnType<typeof getAppCheck>['verifyToken']>>));
	const db = getFirestore(firebaseApp, 'admin-ai-access-tests');
	mock.method(db, 'collection', ((path: string) => {
		assert.ok(['users', '_rateLimits', '_adminAccess'].includes(path), `Coleção inesperada: ${path}`);
		return { doc: (id: string) => reference(`${path}/${id}`) };
	}) as typeof db.collection);
	mock.method(db, 'runTransaction', (async (callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction)) as typeof db.runTransaction);
	mock.method(globalThis, 'fetch', async (input, init) => {
		providerCalls.push({ url: String(input), init });
		if (providerStatus !== 200) return new Response('oauth-servidor-sentinel texto-privado-sentinel', { status: providerStatus });
		return Response.json({ candidates: [{ content: { parts: [{ text: 'Texto permitido' }] } }] });
	});
	server = createServer(app);
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Servidor indisponível.');
	baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
	generation++;
	documents.clear(); documents.set('_adminAccess/current', { schemaVersion: 1, enabled: true, epoch: 'legacy' }); accountEpoch = 'a'.repeat(32); registryUnavailable = false; verified.length = 0; providerCalls.length = 0; oauthCalls = 0; providerStatus = 200;
	process.env.FIREBASE_APP_CHECK_MODE = 'off';
	process.env.FIREBASE_AI_MODEL = 'gemini-test';
});

after(async () => {
	await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	mock.restoreAll();
	await deleteApp(firebaseApp);
	for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

function request(token?: string, body: unknown = { action: 'generate', title: 'Produto' }, headers: Record<string, string> = {}) {
	return nativeFetch(`${baseUrl}/api/admin/ai/suggestions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) });
}

async function denied(response: Response, status: number, code: string) {
	assert.equal(response.status, status);
	const body = await response.json();
	assert.equal(body.code, code);
	assert.equal(body.request_id, response.headers.get('x-request-id'));
	assert.match(response.headers.get('cache-control') || '', /no-store/);
	assert.equal(providerCalls.length, 0);
	assert.equal(oauthCalls, 0);
}

test('IA recusa anonimato e usuário comum mesmo com papel administrativo forjado no corpo', async () => {
	await denied(await request(), 401, 'AUTHENTICATION_REQUIRED');
	await denied(await request('regular', { action: 'generate', title: 'Produto', admin: true, role: 'admin', uid: uid('admin') }), 403, 'ACCESS_DENIED');
});

test('IA recusa sessão revogada, expirada, inválida ou desativada antes de chamar o provedor', async () => {
	for (const token of ['revoked', 'expired', 'invalid', 'disabled']) await denied(await request(token), 401, 'AUTHENTICATION_REQUIRED');
	await denied(await request('auth-unavailable'), 503, 'SERVICE_UNAVAILABLE');
});

test('claim antiga não permite IA quando o privilégio atual e o perfil legado foram removidos', async () => {
	await denied(await request('stale'), 403, 'ACCESS_DENIED');
	await denied(await request('account-disabled'), 403, 'ACCESS_DENIED');
	await denied(await request('claim-unavailable'), 503, 'SERVICE_UNAVAILABLE');
});

test('administrador atual e administrador legado mantêm os quatro recursos do painel', async () => {
	for (const role of ['admin', 'legacy']) {
		for (const body of [
			{ action: 'generate', title: 'Caneca' }, { action: 'improveTitle', title: 'Caneca' },
			{ action: 'improveDescription', description: 'Descrição atual' }, { action: 'custom', title: 'Caneca', prompt: 'Texto personalizado' },
		]) {
			const response = await request(role, body);
			assert.equal(response.status, 200);
			assert.deepEqual(await response.json(), { text: 'Texto permitido' });
		}
	}
	assert.equal(providerCalls.length, 8);
	for (const call of providerCalls) {
		assert.equal(new URL(call.url).hostname, 'aiplatform.googleapis.com');
		assert.equal(new Headers(call.init.headers).get('Authorization'), 'Bearer oauth-servidor-sentinel');
		assert.equal(call.init.redirect, 'error');
	}
});

test('App Check em enforce protege IA independentemente do login administrativo', async () => {
	process.env.FIREBASE_APP_CHECK_MODE = 'enforce';
	await denied(await request('admin'), 401, 'APP_CHECK_REQUIRED');
	assert.equal(verified.length, 0);
	await denied(await request('regular', undefined, { 'X-Firebase-AppCheck': 'atestado-ficticio' }), 403, 'ACCESS_DENIED');
	assert.equal((await request('admin', undefined, { 'X-Firebase-AppCheck': 'atestado-ficticio' })).status, 200);
});

test('campos de infraestrutura e ações inválidas não chegam ao provedor nem ao orçamento', async () => {
	for (const body of [{ action: 'outro' }, { action: 'generate', title: 'Produto', model: 'modelo-caro' }, { action: 'generate', title: 'Produto', url: 'https://externo.invalid' }, { action: 'custom', title: 'Produto', prompt: '' }]) {
		const response = await request('admin', body);
		assert.equal(response.status, 422);
		assert.equal(providerCalls.length, 0);
		assert.equal([...documents.keys()].filter(key => key.startsWith('_rateLimits/')).length, 0);
	}
});

test('a décima primeira geração em um minuto é recusada sem chamar novamente o modelo', async () => {
	for (let index = 0; index < 10; index++) assert.equal((await request('admin')).status, 200);
	const response = await request('admin');
	assert.equal(response.status, 429);
	assert.equal(providerCalls.length, 10);
});

test('orçamento persistido de outra instância também impede geração', async () => {
	const id = createHash('sha256').update(`admin-ai:${uid('admin')}`).digest('hex');
	documents.set(`_rateLimits/${id}`, { count: 10, resetAt: Date.now() + 60_000 });
	await denied(await request('admin'), 429, 'RATE_LIMITED');
});

test('limite global do projeto protege a IA mesmo para um administrador sem consumo individual', async () => {
	const id = createHash('sha256').update('admin-ai:project').digest('hex');
	documents.set(`_rateLimits/${id}`, { count: 60, resetAt: Date.now() + 60_000 });
	await denied(await request('admin'), 429, 'RATE_LIMITED');
});

test('falhas do provedor e configuração não vazam tokens ou textos privados', async () => {
	process.env.FIREBASE_AI_MODEL = '../modelo';
	await denied(await request('admin'), 503, 'AI_CONFIGURATION_ERROR');
	process.env.FIREBASE_AI_MODEL = 'gemini-test';
	providerStatus = 403;
	const lines: string[] = [];
	const log = mock.method(console, 'log', line => lines.push(String(line)));
	const error = mock.method(console, 'error', line => lines.push(String(line)));
	process.env.LOG_LEVEL = 'info';
	try {
		const response = await request('admin', { action: 'generate', title: 'texto-privado-sentinel' });
		assert.equal(response.status, 503);
		const body = await response.text();
		assert.doesNotMatch(body + lines.join(''), /oauth-servidor-sentinel|texto-privado-sentinel/);
		assert.equal(providerCalls.length, 1);
	} finally {
		process.env.LOG_LEVEL = 'silent'; log.mock.restore(); error.mock.restore();
	}
});

test('CORS continua rejeitando origem alheia e o preflight não exige App Check', async () => {
	await denied(await request('admin', undefined, { Origin: 'https://externo.invalid' }), 403, 'ORIGIN_NOT_ALLOWED');
	process.env.FIREBASE_APP_CHECK_MODE = 'enforce';
	const response = await nativeFetch(`${baseUrl}/api/admin/ai/suggestions`, { method: 'OPTIONS', headers: { Origin: 'https://loja.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,x-firebase-appcheck' } });
	assert.equal(response.status, 204);
});


test('registry revocation blocks stale admin claims and legacy roles before any paid generation', async () => {
  documents.set('_adminAccess/current', { schemaVersion: 1, enabled: false, epoch: 'b'.repeat(32) });
  await denied(await request('admin'), 403, 'ACCESS_DENIED');
  await denied(await request('legacy'), 403, 'ACCESS_DENIED');
  documents.delete('_adminAccess/current');
  await denied(await request('admin'), 403, 'ACCESS_DENIED');
});

test('versioned authorization rejects old tokens and disagreement with current Auth even if legacy role persists', async () => {
  documents.set('_adminAccess/current', { schemaVersion: 1, enabled: true, epoch: 'a'.repeat(32) });
  await denied(await request('admin'), 403, 'ACCESS_DENIED');
  assert.equal((await request('versioned')).status, 200);
  providerCalls.length = 0; oauthCalls = 0;
  accountEpoch = 'b'.repeat(32);
  await denied(await request('versioned'), 403, 'ACCESS_DENIED');
});

test('authorization registry outage returns a controlled failure without calling the provider', async () => {
  registryUnavailable = true;
  await denied(await request('admin'), 503, 'SERVICE_UNAVAILABLE');
});
