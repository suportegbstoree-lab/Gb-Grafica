export const APP_CHECK_HEADER = 'X-Firebase-AppCheck';

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type AppCheckTokenProvider = (forceRefresh?: boolean) => Promise<string | null>;

let configuredAppCheckTokenProvider: AppCheckTokenProvider = async () => null;

export function setApiAppCheckTokenProvider(provider: AppCheckTokenProvider): void {
	configuredAppCheckTokenProvider = provider;
}

export function createApiFetch(
	fetchImplementation: FetchImplementation = fetch,
	appCheckTokenProvider: AppCheckTokenProvider = forceRefresh => configuredAppCheckTokenProvider(forceRefresh),
	options: { origin?: string } = {},
): FetchImplementation {
	return async (input, init = {}) => {
		const origin = options.origin ?? (typeof location === 'undefined' ? undefined : location.origin);
		const target = input instanceof Request ? input.url : String(input);
		let trusted = false;
		try {
			const url = new URL(target, origin ?? 'http://relative-api.invalid');
			trusted = url.origin === (origin ?? 'http://relative-api.invalid')
				&& url.pathname.startsWith('/api/') && !url.username && !url.password;
		} catch { /* Um destino inválido será tratado pelo fetch. */ }
		if (!trusted) return fetchImplementation(input, init);

		const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
		const token = await appCheckTokenProvider(false);
		if (token) headers.set(APP_CHECK_HEADER, token);
		const send = () => fetchImplementation(input instanceof Request ? input.clone() : input, {
			...init,
			headers,
			// A API devolve JSON, inclusive o link de pagamento. Não seguimos redirects
			// que poderiam encaminhar este header personalizado a outra origem.
			redirect: 'error',
		});
		const response = await send();
		const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
		if (!token || response.status !== 401 || signal?.aborted
			|| (typeof ReadableStream !== 'undefined' && init.body instanceof ReadableStream)) return response;

		const error = await response.clone().json().catch(() => null) as { code?: unknown } | null;
		if (!['APP_CHECK_REQUIRED', 'APP_CHECK_INVALID'].includes(String(error?.code))) return response;

		// Esses códigos são emitidos pelo middleware antes do handler. Nunca repetimos
		// um pagamento por erro de rede, erro de autenticação ou resposta do PagBank.
		const freshToken = await appCheckTokenProvider(true);
		if (!freshToken) return response;
		headers.set(APP_CHECK_HEADER, freshToken);
		return send();
	};
}

export const apiFetch = createApiFetch();
