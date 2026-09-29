export const APP_CHECK_HEADER = 'X-Firebase-AppCheck';

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type AppCheckTokenProvider = () => Promise<string | null>;

let configuredAppCheckTokenProvider: AppCheckTokenProvider = async () => null;

export function setApiAppCheckTokenProvider(provider: AppCheckTokenProvider): void {
	configuredAppCheckTokenProvider = provider;
}

export function createApiFetch(
	fetchImplementation: FetchImplementation = fetch,
	appCheckTokenProvider: AppCheckTokenProvider = () => configuredAppCheckTokenProvider(),
): FetchImplementation {
	return async (input, init = {}) => {
		const headers = new Headers(init.headers);
		const token = await appCheckTokenProvider();
		if (token) headers.set(APP_CHECK_HEADER, token);

		return fetchImplementation(input, {
			...init,
			headers,
		});
	};
}

export const apiFetch = createApiFetch();
