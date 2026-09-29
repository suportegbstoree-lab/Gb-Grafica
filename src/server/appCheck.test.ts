import assert from 'node:assert/strict';
import test from 'node:test';
import { configuredAppCheckMode, evaluateAppCheck } from './appCheck.js';

test('normaliza o modo do App Check e recusa configuração desconhecida', () => {
	assert.equal(configuredAppCheckMode(undefined), 'off');
	assert.equal(configuredAppCheckMode(''), 'off');
	assert.equal(configuredAppCheckMode(' MONITOR '), 'monitor');
	assert.equal(configuredAppCheckMode('enforce'), 'enforce');
	assert.equal(configuredAppCheckMode('enabled'), null);
});

test('modo off não consulta o verificador', async () => {
	let verifierRequested = false;
	const result = await evaluateAppCheck({
		mode: 'off',
		headerValue: undefined,
		getVerifier: () => {
			verifierRequested = true;
			return async () => undefined;
		},
	});

	assert.deepEqual(result, { allowed: true, verified: false });
	assert.equal(verifierRequested, false);
});

test('modo monitor registra token ausente sem bloquear a requisição', async () => {
	const result = await evaluateAppCheck({
		mode: 'monitor',
		headerValue: undefined,
		getVerifier: () => async () => undefined,
	});

	assert.deepEqual(result, {
		allowed: true,
		verified: false,
		failureReason: 'missing',
	});
});

test('modo enforce bloqueia token ausente ou malformado', async () => {
	const missing = await evaluateAppCheck({
		mode: 'enforce',
		headerValue: undefined,
		getVerifier: () => async () => undefined,
	});
	const malformed = await evaluateAppCheck({
		mode: 'enforce',
		headerValue: 'token com espaços',
		getVerifier: () => async () => undefined,
	});

	assert.equal(missing.allowed, false);
	assert.equal(missing.failureReason, 'missing');
	assert.equal(malformed.allowed, false);
	assert.equal(malformed.failureReason, 'invalid');
});

test('aceita somente token validado pelo Firebase Admin', async () => {
	let receivedToken = '';
	const accepted = await evaluateAppCheck({
		mode: 'enforce',
		headerValue: 'app-check-token',
		getVerifier: () => async token => {
			receivedToken = token;
		},
	});
	const rejected = await evaluateAppCheck({
		mode: 'enforce',
		headerValue: 'invalid-token',
		getVerifier: () => async () => {
			throw new Error('invalid token');
		},
	});

	assert.deepEqual(accepted, { allowed: true, verified: true });
	assert.equal(receivedToken, 'app-check-token');
	assert.equal(rejected.allowed, false);
	assert.equal(rejected.failureReason, 'invalid');
});

test('distingue verificador indisponível de token inválido', async () => {
	const result = await evaluateAppCheck({
		mode: 'enforce',
		headerValue: 'app-check-token',
		getVerifier: () => {
			throw new Error('Firebase Admin indisponível');
		},
	});

	assert.deepEqual(result, {
		allowed: false,
		verified: false,
		failureReason: 'unavailable',
	});
});
