import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppCheck } from 'firebase/app-check';
import { checkAppCheckConnection, createAppCheckTokenProvider } from './appCheckClient.js';

const instance = {} as AppCheck;

test('cliente sem App Check não solicita tokens', async () => {
	const provider = createAppCheckTokenProvider(null, async () => { throw new Error('não deve chamar'); });
	assert.equal(await provider(), null);
	assert.equal(await provider(true), null);
});

test('delega cache e renovação ao SDK e permite renovar uma sessão rejeitada', async () => {
	const calls: boolean[] = [];
	const provider = createAppCheckTokenProvider(instance, async (received, forceRefresh) => {
		assert.equal(received, instance);
		calls.push(forceRefresh);
		return { token: forceRefresh ? 'novo' : 'cache' };
	});
	assert.equal(await provider(), 'cache');
	assert.equal(await provider(true), 'novo');
	assert.deepEqual(calls, [false, true]);
});

test('falhas do SDK não vazam segredos no log e não produzem avisos repetidos', async () => {
	const warnings: string[] = [];
	let fail = true;
	const provider = createAppCheckTokenProvider(instance, async () => {
		if (fail) throw new Error('segredo-que-nao-pode-aparecer-no-log');
		return { token: 'sessao-valida' };
	}, message => warnings.push(message));
	assert.equal(await provider(), null);
	assert.equal(await provider(true), null);
	assert.equal(warnings.length, 1);
	assert.doesNotMatch(warnings.join(''), /segredo-que/);
	fail = false;
	assert.equal(await provider(), 'sessao-valida');
	fail = true;
	assert.equal(await provider(), null);
	assert.equal(warnings.length, 2);
});

test('diagnóstico exige confirmação explícita do servidor, inclusive em monitor', async () => {
	for (const value of [false, undefined, 'true']) {
		assert.equal(await checkAppCheckConnection(async path => {
			assert.equal(path, '/api/app-check/status');
			return Response.json({ mode: 'monitor', verified: value });
		}), false);
	}
	assert.equal(await checkAppCheckConnection(async () => Response.json({ mode: 'monitor', verified: true })), true);
	assert.equal(await checkAppCheckConnection(async () => Response.json({ code: 'APP_CHECK_INVALID' }, { status: 401 })), false);
});

test('um SDK que não conclui a aquisição tem espera limitada e erro controlado', async () => {
	const warnings: string[] = [];
	const provider = createAppCheckTokenProvider(instance, () => new Promise(() => {}), warning => warnings.push(warning), 10);
	assert.equal(await provider(), null);
	assert.equal(warnings.length, 1);
});
