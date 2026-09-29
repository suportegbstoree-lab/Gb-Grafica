import assert from 'node:assert/strict';
import test from 'node:test';
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
