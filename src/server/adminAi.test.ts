import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminAiError, adminAiInstruction, generateAdminAiText, vertexAiConfig } from './adminAi.js';

const config = vertexAiConfig('demo-admin-ai', {});
const reply = (text = 'Descrição segura') => Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
const errorCode = (code: string) => (error: unknown) => error instanceof AdminAiError && error.code === code;

test('IA preserva o modelo e a localização anteriores e não aceita destinos externos', () => {
	assert.equal(config.model, 'gemini-3.8-flash');
	assert.equal(config.location, 'global');
	assert.equal(new URL(config.endpoint).hostname, 'aiplatform.googleapis.com');
	assert.equal(vertexAiConfig('demo-admin-ai', { FIREBASE_AI_LOCATION: 'us-central1' }).endpoint.startsWith('https://us-central1-aiplatform.googleapis.com/'), true);
	assert.equal(vertexAiConfig('demo-admin-ai', { VITE_GEMINI_MODEL: 'gemini-custom' }).model, 'gemini-custom');
	assert.equal(vertexAiConfig('demo-admin-ai', { FIREBASE_AI_MODEL: 'gemini-server', VITE_GEMINI_MODEL: 'gemini-client' }).model, 'gemini-server');
	for (const env of [{ FIREBASE_AI_LOCATION: 'evil.example' }, { FIREBASE_AI_MODEL: '../outro-modelo' }]) assert.throws(() => vertexAiConfig('demo-admin-ai', env), errorCode('AI_CONFIGURATION_ERROR'));
	assert.throws(() => vertexAiConfig(undefined, {}), errorCode('AI_CONFIGURATION_ERROR'));
});

test('prompts dos quatro recursos ficam no servidor, sem aceitar controles de infraestrutura', () => {
	assert.match(adminAiInstruction({ action: 'generate', title: 'Caneca' }), /Gere uma descrição.*Caneca/);
	assert.match(adminAiInstruction({ action: 'improveTitle', title: 'Caneca' }), /Melhore o título/);
	assert.match(adminAiInstruction({ action: 'improveDescription', description: 'Descrição atual' }), /sem inventar especificações/);
	assert.match(adminAiInstruction({ action: 'custom', title: 'Caneca', prompt: 'Tom informal' }), /Tom informal/);
	for (const extra of ['model', 'project', 'url', 'admin', 'role', 'systemInstruction', 'apiKey']) assert.throws(() => adminAiInstruction({ action: 'generate', title: 'Caneca', [extra]: 'forjado' }), errorCode('AI_INVALID_INPUT'));
	for (const value of [null, [], {}, { action: 'desconhecida' }, { action: 'generate', title: '' }, { action: 'custom', title: 'Caneca', prompt: 'x'.repeat(4001) }, { action: 'improveDescription', description: '\u0000' }]) assert.throws(() => adminAiInstruction(value), AdminAiError);
});

test('provider recebe só o token OAuth do servidor, texto e orçamento de saída', async () => {
	const text = await generateAdminAiText(config, 'Texto permitido', async () => 'oauth-do-servidor', {
		fetch: async (url, init) => {
			assert.equal(url, config.endpoint);
			assert.equal(init.redirect, 'error');
			assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer oauth-do-servidor');
			assert.equal(new Headers(init.headers).has('X-Firebase-AppCheck'), false);
			assert.deepEqual(JSON.parse(String(init.body)), { contents: [{ role: 'user', parts: [{ text: 'Texto permitido' }] }], generationConfig: { maxOutputTokens: 2048 } });
			return reply();
		},
	});
	assert.equal(text, 'Descrição segura');
	assert.doesNotMatch(text, /oauth-do-servidor/);
});

test('erros de IAM, API, quota e rede não ecoam conteúdo ou credenciais e não são repetidos', async () => {
	for (const [status, expected] of [[400, 'AI_PROVIDER_CONFIGURATION'], [401, 'AI_PROVIDER_CONFIGURATION'], [403, 'AI_PROVIDER_CONFIGURATION'], [404, 'AI_PROVIDER_CONFIGURATION'], [429, 'AI_PROVIDER_RATE_LIMIT'], [500, 'AI_PROVIDER_UNAVAILABLE']] as const) {
		let calls = 0;
		await assert.rejects(generateAdminAiText(config, 'prompt-privado', async () => 'oauth-secreto', { fetch: async () => { calls++; return new Response('oauth-secreto prompt-privado', { status }); } }), error => {
			assert.ok(errorCode(expected)(error));
			assert.doesNotMatch(String(error), /oauth-secreto|prompt-privado/);
			return true;
		});
		assert.equal(calls, 1);
	}
	await assert.rejects(generateAdminAiText(config, 'prompt', async () => 'oauth', { fetch: async () => { throw new Error('segredo-interno'); } }), errorCode('AI_PROVIDER_UNAVAILABLE'));
});

test('falha e timeout de credencial não alcançam o modelo', async () => {
	let calls = 0;
	const fetcher: typeof fetch = async () => { calls++; return reply(); };
	await assert.rejects(generateAdminAiText(config, 'prompt', async () => { throw new Error('chave-privada'); }, { fetch: fetcher }), errorCode('AI_CREDENTIAL_UNAVAILABLE'));
	await assert.rejects(generateAdminAiText(config, 'prompt', () => new Promise(() => {}), { fetch: fetcher, credentialTimeoutMs: 5 }), errorCode('AI_CREDENTIAL_UNAVAILABLE'));
	assert.equal(calls, 0);
});

test('timeout do modelo aborta a operação sem fazer retry', async () => {
	let calls = 0;
	let signal: AbortSignal;
	await assert.rejects(generateAdminAiText(config, 'prompt', async () => 'oauth', { timeoutMs: 5, fetch: async (_url, init) => {
		calls++; signal = init.signal;
		return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('abortado')), { once: true }));
	} }), errorCode('AI_TIMEOUT'));
	assert.equal(signal.aborted, true);
	assert.equal(calls, 1);
});

test('não expõe partes de raciocínio e rejeita JSON inválido, texto ausente ou saída excessiva', async () => {
	const text = await generateAdminAiText(config, 'prompt', async () => 'oauth', { fetch: async () => Response.json({ candidates: [{ content: { parts: [{ thought: true, text: 'raciocinio-interno' }, { text: 'Resposta final' }] } }] }) });
	assert.equal(text, 'Resposta final');
	for (const response of [new Response('invalido'), Response.json({}), reply('x'.repeat(12001)), new Response('x'.repeat(270 * 1024))]) {
		await assert.rejects(generateAdminAiText(config, 'prompt', async () => 'oauth', { fetch: async () => response }), AdminAiError);
	}
});
