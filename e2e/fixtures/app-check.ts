import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { doc, getFirestore, runTransaction } from 'firebase/firestore';
import { getBytes, getStorage, ref } from 'firebase/storage';
import { createFirebaseTextModel } from '../../src/services/firebaseAiClient';
import { createAppCheckTokenProvider, initializeBrowserAppCheck } from '../../src/services/appCheckClient';
import { createApiFetch } from '../../src/services/apiClient';

// Somente o servidor E2E entrega este arquivo. Nada desta configuração entra no build.
const app = initializeApp({ apiKey: 'test-api-key', projectId: 'demo-appcheck-browser', appId: '1:123:web:abc123', storageBucket: 'demo-appcheck-browser.invalid' });
const warnings: string[] = [];
const options = new URLSearchParams(location.search);
const appCheck = initializeBrowserAppCheck(app, {
	siteKey: options.has('no-key') ? '' : 'test-public-site-key',
	development: options.has('development'), debug: options.has('debug'),
});
const provider = createAppCheckTokenProvider(appCheck, undefined, warning => warnings.push(warning), options.has('short-timeout') ? 50 : undefined);
const request = createApiFetch(fetch, provider);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const model = createFirebaseTextModel(app, 'test-model');

Object.assign(window, { appCheckFixture: {
	provider, warnings,
	request: async () => { const response = await request('/api/app-check/status'); return { status: response.status, body: await response.json() }; },
	generate: async () => (await model.generateContent('Teste sem IA real')).response.text(),
	readDocument: async () => runTransaction(db, async transaction => (await transaction.get(doc(db, 'test', 'document'))).exists()),
	readFile: async () => (await getBytes(ref(storage, 'test.bin'))).byteLength,
	login: async () => { await signInWithCustomToken(auth, 'custom-token-ficticio'); return auth.currentUser?.uid; },
} });
