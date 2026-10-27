import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import test, { after, before, beforeEach, mock } from 'node:test';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import config from '../../firebase-applet-config.json' with { type: 'json' };
import app from './app.js';

const projectId = 'demo-gb-appcheck';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const environment = ['NODE_ENV', 'APP_URL', 'LOG_LEVEL', 'FIREBASE_APP_CHECK_MODE', 'FIREBASE_APP_CHECK_ALLOWED_APP_IDS', 'FIREBASE_STORAGE_BUCKET', 'ARTWORK_UPLOAD_RELAY_MODE', 'PAGBANK_TOKEN'] as const;
const original = new Map(environment.map(key => [key, process.env[key]]));
let firebaseApp: App;
let server: Server;
let baseUrl = '';

function token(overrides: Record<string, unknown> = {}, headerOverrides: Record<string, unknown> = {}): string {
	const now = Math.floor(Date.now() / 1000);
	const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-only', ...headerOverrides })).toString('base64url');
	const payload = Buffer.from(JSON.stringify({
		iss: 'https://firebaseappcheck.googleapis.com/123', aud: [`projects/${projectId}`],
		sub: config.appId, iat: now, exp: now + 3600, ...overrides,
	})).toString('base64url');
	return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')}`;
}

async function request(path = '/api/app-check/status', value?: string, init: RequestInit = {}) {
	const headers = new Headers(init.headers);
	if (value !== undefined) headers.set('X-Firebase-AppCheck', value);
	return fetch(`${baseUrl}${path}`, { ...init, headers });
}

before(async () => {
	Object.assign(process.env, { NODE_ENV: 'production', APP_URL: 'https://loja.example', LOG_LEVEL: 'silent', FIREBASE_STORAGE_BUCKET: 'demo-appcheck.invalid' });
	firebaseApp = initializeApp({ projectId });
	// Só a obtenção das chaves públicas é substituída. O Firebase Admin real
	// valida o JWT e a assinatura RSA, sem rede nem credenciais do projeto real.
	const verifier = getAppCheck(firebaseApp) as unknown as {
		appCheckTokenVerifier: { signatureVerifier: { keyFetcher: { fetchPublicKeys(): Promise<Record<string, string>> } } };
	};
	mock.method(verifier.appCheckTokenVerifier.signatureVerifier.keyFetcher, 'fetchPublicKeys', async () => ({
		'test-only': publicKey.export({ type: 'spki', format: 'pem' }).toString(),
	}));
	server = createServer(app);
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Servidor de teste indisponível.');
	baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
	process.env.FIREBASE_APP_CHECK_MODE = 'enforce';
	delete process.env.FIREBASE_APP_CHECK_ALLOWED_APP_IDS;
	delete process.env.ARTWORK_UPLOAD_RELAY_MODE;
	delete process.env.PAGBANK_TOKEN;
});

after(async () => {
	await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	mock.restoreAll();
	await deleteApp(firebaseApp);
	for (const [key, value] of original) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

test('JWT assinado e vigente é validado pelo Admin, sem devolver o token ao navegador', async () => {
	const response = await request(undefined, token());
	assert.equal(response.status, 200);
	assert.match(response.headers.get('cache-control') || '', /no-store/);
	assert.deepEqual(await response.json(), { mode: 'enforce', verified: true });
});

test('Admin e middleware rejeitam expiração, projeto errado, issuer falso, outro app e assinatura alterada', async () => {
	const valid = token();
	const [header, payload, signature] = valid.split('.');
	const mutated = Buffer.from(signature, 'base64url');
	mutated[0] ^= 1;
	for (const value of [
		token({ exp: Math.floor(Date.now() / 1000) - 3600 }),
		token({ aud: ['projects/outro-projeto'] }),
		token({ iss: 'https://atacante.invalid' }),
		token({ sub: '1:123:web:deadbeef' }),
		token({}, { alg: 'HS256' }),
		`${header}.${payload}.${mutated.toString('base64url')}`,
		'nao-e-um-jwt', 'um,dois', 'x'.repeat(8193),
	]) {
		const response = await request(undefined, value);
		assert.equal(response.status, 401);
		const result = await response.json() as Record<string, unknown>;
		assert.equal(result.code, 'APP_CHECK_INVALID');
		assert.equal(Object.hasOwn(result, 'verified'), false);
		assert.ok(!JSON.stringify(result).includes(value));
	}
});

test('monitor distingue verificação positiva de tráfego ausente ou inválido', async () => {
	process.env.FIREBASE_APP_CHECK_MODE = 'monitor';
	for (const value of [undefined, 'invalido', token({ sub: '1:123:web:deadbeef' })]) {
		const response = await request(undefined, value);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { mode: 'monitor', verified: false });
	}
	assert.deepEqual(await (await request(undefined, token())).json(), { mode: 'monitor', verified: true });
});

test('configuração inválida nunca libera a API e off informa ausência de verificação', async () => {
	process.env.FIREBASE_APP_CHECK_MODE = 'typo';
	assert.equal((await (await request()).json()).code, 'APP_CHECK_CONFIGURATION_ERROR');
	process.env.FIREBASE_APP_CHECK_MODE = 'enforce';
	process.env.FIREBASE_APP_CHECK_ALLOWED_APP_IDS = '*';
	assert.equal((await (await request(undefined, token())).json()).code, 'APP_CHECK_CONFIGURATION_ERROR');
	process.env.FIREBASE_APP_CHECK_MODE = 'off';
	assert.deepEqual(await (await request()).json(), { mode: 'off', verified: false });
});

test('App Check protege todos os caminhos do navegador antes de efeitos no banco ou no PagBank', async () => {
	process.env.ARTWORK_UPLOAD_RELAY_MODE = 'enabled';
	for (const [method, path] of [
		['POST', '/api/shipping-quote'], ['POST', '/api/checkout'],
		['GET', '/api/payment-status/GB-TEST12345678'],
		['POST', '/api/admin/orders/GB-TEST12345678/fulfillment'],
		['GET', '/api/orders/GB-TEST12345678/artwork/item'],
		['GET', '/api/orders/GB-TEST12345678/model/item'],
		['POST', '/api/artwork-uploads'],
	] as const) {
		const response = await request(path, undefined, {
			method, headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}),
		});
		assert.equal(response.status, 401, path);
		assert.equal((await response.json()).code, 'APP_CHECK_REQUIRED', path);
	}
});

test('atestado válido não substitui o login e não bloqueia health, webhook ou preflight', async () => {
	const unauthenticated = await request('/api/payment-status/GB-TEST12345678', token());
	assert.equal(unauthenticated.status, 401);
	assert.equal((await unauthenticated.json()).code, 'AUTHENTICATION_REQUIRED');
	assert.equal((await request('/api/health')).status, 200);
	const webhook = await request('/api/webhook/pagbank', undefined, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
	assert.equal((await webhook.json()).code, 'PAGBANK_NOT_CONFIGURED');
	const preflight = await request('/api/checkout', undefined, { method: 'OPTIONS', headers: {
		Origin: 'https://loja.example', 'Access-Control-Request-Method': 'POST',
		'Access-Control-Request-Headers': 'authorization,content-type,x-firebase-appcheck',
	} });
	assert.equal(preflight.status, 204);
	assert.match(preflight.headers.get('access-control-allow-headers') || '', /X-Firebase-AppCheck/i);
});

test('token e conteúdo do header não aparecem nos logs de monitoramento', async () => {
	const lines: string[] = [];
	const log = mock.method(console, 'log', line => lines.push(String(line)));
	const warn = mock.method(console, 'warn', line => lines.push(String(line)));
	process.env.LOG_LEVEL = 'info';
	process.env.FIREBASE_APP_CHECK_MODE = 'monitor';
	try {
		await request(undefined, 'segredo-appcheck-sentinel');
		await request(undefined, token());
		assert.match(lines.join('\n'), /app_check_monitor_observation/);
		assert.match(lines.join('\n'), /app_check_status/);
		assert.doesNotMatch(lines.join('\n'), /segredo-appcheck-sentinel|eyJhbGci/);
	} finally {
		process.env.LOG_LEVEL = 'silent';
		log.mock.restore();
		warn.mock.restore();
	}
});
