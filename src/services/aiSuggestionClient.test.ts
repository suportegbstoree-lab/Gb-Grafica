import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiSuggestionClient } from './aiSuggestionClient.js';

test('IA sem sessão não faz chamada à API', async () => {
	let calls = 0;
	const suggest = createAiSuggestionClient(async () => null, async () => { calls++; throw new Error('não deve chamar'); });
	await assert.rejects(suggest('generate', { title: 'Produto' }), /Faça login/);
	assert.equal(calls, 0);
});

test('as quatro funções da IA enviam apenas ação e texto ao endpoint administrativo', async () => {
	for (const [action, payload] of [
		['generate', { title: 'Caneca' }], ['improveTitle', { title: 'Caneca' }],
		['improveDescription', { description: 'Descrição atual' }], ['custom', { title: 'Caneca', prompt: 'Tom informal' }],
	] as const) {
		const suggest = createAiSuggestionClient(async () => 'token-do-usuario', async (url, init) => {
			assert.equal(url, '/api/admin/ai/suggestions');
			assert.equal(init.method, 'POST');
			assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer token-do-usuario');
			assert.deepEqual(JSON.parse(String(init.body)), { action, ...payload });
			return Response.json({ text: '  Resposta da IA  ' });
		});
		assert.equal(await suggest(action, payload), 'Resposta da IA');
	}
});

test('IA propaga erro público com referência e não aceita uma resposta vazia ou inválida', async () => {
	const denied = createAiSuggestionClient(async () => 'token', async () => Response.json({ error: 'Acesso restrito.', request_id: 'trace-ai-1234' }, { status: 403 }));
	await assert.rejects(denied('generate', { title: 'Produto' }), /Acesso restrito/);
	for (const value of ['', ' ', null, 5, undefined]) {
		const suggest = createAiSuggestionClient(async () => 'token', async () => Response.json({ text: value }));
		await assert.rejects(suggest('generate', { title: 'Produto' }), /resposta vazia/);
	}
});
