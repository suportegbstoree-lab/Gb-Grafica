import type { FirebaseApp } from 'firebase/app';
import {
	getToken,
	initializeAppCheck,
	ReCaptchaEnterpriseProvider,
	type AppCheck,
} from 'firebase/app-check';

export interface BrowserAppCheckOptions {
	siteKey?: string;
	development: boolean;
	debug?: boolean;
}

export function initializeBrowserAppCheck(app: FirebaseApp, options: BrowserAppCheckOptions): AppCheck | null {
	if (typeof window === 'undefined' || !options.siteKey?.trim()) return null;

	if (options.debug) {
		if (!options.development || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname)) {
			throw new Error('A depuração do App Check só é permitida no desenvolvimento em localhost.');
		}
		// O SDK gera o segredo no navegador. Nenhum token de depuração entra no bundle.
		(self as typeof self & { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
	}

	return initializeAppCheck(app, {
		provider: new ReCaptchaEnterpriseProvider(options.siteKey.trim()),
		isTokenAutoRefreshEnabled: true,
	});
}

export function createAppCheckTokenProvider(
	appCheck: AppCheck | null,
	requestToken: typeof getToken = getToken,
	warn: (message: string) => void = console.warn,
	timeoutMs = 10_000,
): (forceRefresh?: boolean) => Promise<string | null> {
	let failureReported = false;
	return async (forceRefresh = false) => {
		if (!appCheck) return null;
		let deadline: ReturnType<typeof setTimeout> | undefined;
		try {
			// O SDK mantém o cache, a validade e a renovação. Não duplicamos tokens em outro armazenamento.
			const result = await Promise.race([
				requestToken(appCheck, forceRefresh),
				new Promise<never>((_resolve, reject) => {
					deadline = setTimeout(() => reject(new Error('App Check indisponível.')), timeoutMs);
				}),
			]);
			if (!result.token) throw new Error('Token ausente.');
			failureReported = false;
			return result.token;
		} catch {
			if (!failureReported) warn('[App Check] Não foi possível validar esta sessão do navegador.');
			failureReported = true;
			return null;
		} finally {
			if (deadline !== undefined) clearTimeout(deadline);
		}
	};
}

export async function checkAppCheckConnection(
	request: (input: string) => Promise<Response>,
): Promise<boolean> {
	const response = await request('/api/app-check/status');
	if (!response.ok) return false;
	const result = await response.json() as { verified?: unknown };
	return result.verified === true;
}
