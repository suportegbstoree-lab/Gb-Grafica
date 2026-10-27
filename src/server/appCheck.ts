export const APP_CHECK_HEADER = 'X-Firebase-AppCheck';

export type AppCheckMode = 'off' | 'monitor' | 'enforce';
export type AppCheckFailureReason = 'missing' | 'invalid' | 'app_mismatch' | 'unavailable';

export interface AppCheckEvaluation {
	allowed: boolean;
	verified: boolean;
	failureReason?: AppCheckFailureReason;
}

interface EvaluateAppCheckOptions {
	mode: AppCheckMode;
	headerValue: string | undefined;
	getVerifier: () => (token: string) => Promise<unknown>;
	allowedAppIds?: readonly string[];
}

export function configuredAppCheckAppIds(value: string | undefined, defaultAppId: string): string[] | null {
	const ids = value?.trim() ? value.split(',').map(id => id.trim()) : [defaultAppId];
	return ids.length > 0 && ids.length <= 20 && ids.every(id => /^1:\d+:(web|android|ios):[a-f\d]+$/i.test(id))
		? [...new Set(ids)] : null;
}

export function configuredAppCheckMode(value: unknown): AppCheckMode | null {
	if (value === undefined || value === null || String(value).trim() === '') return 'off';
	const normalized = String(value).trim().toLowerCase();
	return normalized === 'off' || normalized === 'monitor' || normalized === 'enforce'
		? normalized
		: null;
}

function normalizedAppCheckToken(value: string | undefined): string | null {
	if (typeof value !== 'string') return null;
	const token = value.trim();
	if (!token) return null;
	if (token.length > 8_192 || /[\s,]/.test(token)) return '';
	return token;
}

export async function evaluateAppCheck({
	mode,
	headerValue,
	getVerifier,
	allowedAppIds,
}: EvaluateAppCheckOptions): Promise<AppCheckEvaluation> {
	if (mode === 'off') return { allowed: true, verified: false };

	const token = normalizedAppCheckToken(headerValue);
	if (token === null) {
		return {
			allowed: mode === 'monitor',
			verified: false,
			failureReason: 'missing',
		};
	}
	if (!token) {
		return {
			allowed: mode === 'monitor',
			verified: false,
			failureReason: 'invalid',
		};
	}

	let verifyToken: (token: string) => Promise<unknown>;
	try {
		verifyToken = getVerifier();
	} catch {
		return {
			allowed: mode === 'monitor',
			verified: false,
			failureReason: 'unavailable',
		};
	}

	try {
		const result = await verifyToken(token);
		if (allowedAppIds) {
			const appId = result && typeof result === 'object' && 'appId' in result ? result.appId : undefined;
			if (typeof appId !== 'string' || !allowedAppIds.includes(appId)) {
				return { allowed: mode === 'monitor', verified: false, failureReason: 'app_mismatch' };
			}
		}
		return { allowed: true, verified: true };
	} catch (error) {
		const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
		return {
			allowed: mode === 'monitor',
			verified: false,
			failureReason: ['app-check/internal-error', 'app-check/invalid-credential', 'app/invalid-credential'].includes(String(code))
				? 'unavailable' : 'invalid',
		};
	}
}
