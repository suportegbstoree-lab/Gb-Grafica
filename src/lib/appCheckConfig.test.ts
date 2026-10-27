import assert from 'node:assert/strict';
import test from 'node:test';
import { appCheckBuildProblems } from './appCheckConfig.js';

test('não publica debug em build nem aceita enforce com chave ausente', () => {
	assert.equal(appCheckBuildProblems({ VITE_APP_CHECK_DEBUG: 'true' }).length, 1);
	assert.equal(appCheckBuildProblems({ VITE_APP_CHECK_DEBUG: 'segredo-nao-publicavel' }).length, 1);
	assert.doesNotMatch(appCheckBuildProblems({ VITE_APP_CHECK_DEBUG: 'segredo-nao-publicavel' }).join(''), /segredo-nao/);
	assert.equal(appCheckBuildProblems({ FIREBASE_APP_CHECK_MODE: ' ENFORCE ' }).length, 1);
	assert.deepEqual(appCheckBuildProblems({ FIREBASE_APP_CHECK_MODE: 'enforce', VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'chave-publica' }), []);
	assert.deepEqual(appCheckBuildProblems({ VITE_APP_CHECK_DEBUG: 'false' }), []);
	assert.deepEqual(appCheckBuildProblems({}), []);
});
