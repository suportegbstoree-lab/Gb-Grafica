export function appCheckBuildProblems(env: Record<string, string | undefined>): string[] {
	const problems: string[] = [];
	if (env.VITE_APP_CHECK_DEBUG?.trim() && env.VITE_APP_CHECK_DEBUG.trim() !== 'false') {
		problems.push('VITE_APP_CHECK_DEBUG deve ficar ausente ou false em builds publicados.');
	}
	if (env.FIREBASE_APP_CHECK_MODE?.trim().toLowerCase() === 'enforce'
		&& !env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?.trim()) {
		problems.push('A API está em enforce, mas a site key pública do App Check está ausente no build.');
	}
	return problems;
}
