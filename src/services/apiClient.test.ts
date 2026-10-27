import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Server } from 'node:http';
import { APP_CHECK_HEADER, createApiFetch } from './apiClient.js';

test('anexa o App Check às chamadas da API sem perder outros headers', async () => {
	let receivedInit: RequestInit | undefined;
	const request = createApiFetch(
		async (_input, init) => {
			receivedInit = init;
			return new Response(null, { status: 204 });
		},
		async () => 'app-check-token',
	);

	await request('/api/checkout', {
		method: 'POST',
		headers: {
			Authorization: 'Bearer firebase-token',
			'Content-Type': 'application/json',
		},
	});

	const headers = new Headers(receivedInit?.headers);
	assert.equal(headers.get(APP_CHECK_HEADER), 'app-check-token');
	assert.equal(headers.get('Authorization'), 'Bearer firebase-token');
	assert.equal(headers.get('Content-Type'), 'application/json');
});

test('continua a requisição sem header quando o App Check não está configurado', async () => {
	let receivedInit: RequestInit | undefined;
	const request = createApiFetch(
		async (_input, init) => {
			receivedInit = init;
			return new Response(null, { status: 204 });
		},
		async () => null,
	);

	await request('/api/health');

	const headers = new Headers(receivedInit?.headers);
	assert.equal(headers.has(APP_CHECK_HEADER), false);
});

test('não envia a sessão App Check a destinos externos ou a caminhos fora da API', async () => {
	let tokenCalls = 0;
	const request = createApiFetch(async (_input, init) => {
		assert.equal(new Headers(init?.headers).has(APP_CHECK_HEADER), false);
		return new Response(null, { status: 204 });
	}, async () => { tokenCalls++; return 'segredo-app-check'; }, { origin: 'https://loja.example' });
	for (const target of ['https://externo.example/api/checkout', '//externo.example/api/checkout', '/logo.png', 'https://loja.example.evil/api/checkout', 'https://user:pass@loja.example/api/checkout']) {
		await request(target);
	}
	assert.equal(tokenCalls, 0);
});

test('preserva headers e corpo de um Request e renova uma única vez antes do handler', async () => {
	const refreshed: boolean[] = [];
	const bodies: string[] = [];
	const request = createApiFetch(async (input, init) => {
		const headers = new Headers(init?.headers);
		assert.equal(headers.get('Authorization'), 'Bearer id-token');
		bodies.push(await (input as Request).text());
		return headers.get(APP_CHECK_HEADER) === 'expirado'
			? Response.json({ code: 'APP_CHECK_INVALID' }, { status: 401 })
			: Response.json({ ok: true });
	}, async force => { refreshed.push(force); return force ? 'renovado' : 'expirado'; }, { origin: 'https://loja.example' });
	const input = new Request('https://loja.example/api/checkout', {
		method: 'POST', headers: { Authorization: 'Bearer id-token' }, body: '{"pedido":"unico"}',
	});
	assert.equal((await request(input)).status, 200);
	assert.deepEqual(refreshed, [false, true]);
	assert.deepEqual(bodies, ['{"pedido":"unico"}', '{"pedido":"unico"}']);
	assert.equal(input.bodyUsed, false);
});

test('não repete pagamentos por falha de autenticação, permissão, provedor ou rede', async () => {
	for (const [status, code] of [[401, 'AUTHENTICATION_REQUIRED'], [403, 'FORBIDDEN'], [502, 'PAGBANK_ERROR'], [503, 'APP_CHECK_UNAVAILABLE'], [200, 'APP_CHECK_INVALID']] as const) {
		let attempts = 0;
		const refreshed: boolean[] = [];
		const request = createApiFetch(async () => { attempts++; return Response.json({ code }, { status }); }, async force => { refreshed.push(force); return 'token'; });
		assert.equal((await request('/api/checkout', { method: 'POST', body: '{}' })).status, status);
		assert.equal(attempts, 1);
		assert.deepEqual(refreshed, [false]);
	}
	let attempts = 0;
	const request = createApiFetch(async () => { attempts++; throw new Error('rede'); }, async () => 'token');
	await assert.rejects(request('/api/checkout', { method: 'POST', body: '{}' }), /rede/);
	assert.equal(attempts, 1);
});

test('uma segunda rejeição App Check é devolvida sem loop', async () => {
	let attempts = 0;
	const request = createApiFetch(async () => { attempts++; return Response.json({ code: 'APP_CHECK_REQUIRED' }, { status: 401 }); }, async () => 'token');
	const response = await request('/api/checkout');
	assert.equal(response.status, 401);
	assert.equal((await response.json()).code, 'APP_CHECK_REQUIRED');
	assert.equal(attempts, 2);
});

test('não repete quando a renovação falha e preserva a resposta original', async () => {
	let attempts = 0;
	const request = createApiFetch(async () => { attempts++; return Response.json({ code: 'APP_CHECK_INVALID' }, { status: 401 }); }, async force => force ? null : 'expirado');
	const response = await request('/api/checkout');
	assert.equal((await response.json()).code, 'APP_CHECK_INVALID');
	assert.equal(attempts, 1);
});

test('redirect de uma API não encaminha o token a outro servidor', async () => {
	let externalCalls = 0;
	let apiCalls = 0;
	const external = createServer((_req, res) => { externalCalls++; res.end('externo'); });
	const origin = async (server: Server) => {
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('Servidor indisponível.');
		return `http://127.0.0.1:${address.port}`;
	};
	const externalOrigin = await origin(external);
	const api = createServer((req, res) => {
		apiCalls++;
		assert.equal(req.headers['x-firebase-appcheck'], 'nao-pode-sair-da-api');
		res.writeHead(302, { Location: `${externalOrigin}/coleta` }).end();
	});
	try {
		const apiOrigin = await origin(api);
		const request = createApiFetch(fetch, async () => 'nao-pode-sair-da-api', { origin: apiOrigin });
		await assert.rejects(request(`${apiOrigin}/api/checkout`));
		assert.equal(apiCalls, 1);
		assert.equal(externalCalls, 0);
	} finally {
		await Promise.all([external, api].map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
	}
});

test('não solicita renovação quando o Request original foi cancelado', async () => {
	const controller = new AbortController();
	controller.abort();
	const calls: boolean[] = [];
	const request = createApiFetch(async () => Response.json({ code: 'APP_CHECK_INVALID' }, { status: 401 }), async refresh => { calls.push(refresh); return 'token'; }, { origin: 'https://loja.example' });
	await request(new Request('https://loja.example/api/checkout', { signal: controller.signal }));
	assert.deepEqual(calls, [false]);
});

test('não insiste na emissão quando o SDK já falhou em obter o primeiro token', async () => {
	const calls: boolean[] = [];
	const request = createApiFetch(async () => Response.json({ code: 'APP_CHECK_REQUIRED' }, { status: 401 }), async refresh => { calls.push(refresh); return null; });
	assert.equal((await request('/api/checkout')).status, 401);
	assert.deepEqual(calls, [false]);
});
