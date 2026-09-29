export const APP_CHECK_HEADER = 'X-Firebase-AppCheck';

export type AppCheckMode = 'off' | 'monitor' | 'enforce';
export type AppCheckFailureReason = 'missing' | 'invalid' | 'unavailable';

export interface AppCheckEvaluation {
	allowed: boolean;
	verified: boolean;
	failureReason?: AppCheckFailureReason;
}

interface EvaluateAppCheckOptions {
	mode: AppCheckMode;
	headerValue: string | undefined;
	getVerifier: () => (token: string) => Promise<unknown>;
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
	if (token.length > 8_192 || /\s/.test(token)) return '';
	return token;
}

export async function evaluateAppCheck({
	mode,
	headerValue,
	getVerifier,
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
		await verifyToken(token);
		return { allowed: true, verified: true };
	} catch {
		return {
			allowed: mode === 'monitor',
			verified: false,
			failureReason: 'invalid',
		};
	}
}
