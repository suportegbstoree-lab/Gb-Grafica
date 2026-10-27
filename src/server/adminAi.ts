export type AiAction = 'generate' | 'improveTitle' | 'improveDescription' | 'custom';

export class AdminAiError extends Error {
	constructor(public readonly status: number, public readonly code: string, message: string) {
		super(message);
		this.name = 'AdminAiError';
	}
}

export interface VertexAiConfig {
	projectId: string;
	location: string;
	model: string;
	endpoint: string;
}

export function vertexAiConfig(projectId: string | undefined, env: Record<string, string | undefined> = process.env): VertexAiConfig {
	const project = projectId?.trim() ?? '';
	const location = env.FIREBASE_AI_LOCATION?.trim() || 'global';
	const model = env.FIREBASE_AI_MODEL?.trim() || env.VITE_GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
	if (!/^[a-z][a-z0-9-]{4,62}[a-z0-9]$/.test(project)
		|| !/^(global|[a-z]+(?:-[a-z]+)+[0-9])$/.test(location)
		|| !/^gemini-[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(model)) {
		throw new AdminAiError(503, 'AI_CONFIGURATION_ERROR', 'A IA do servidor está configurada incorretamente.');
	}
	const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
	return {
		projectId: project, location, model,
		endpoint: `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`,
	};
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function adminAiInstruction(value: unknown): string {
	if (!record(value) || Object.keys(value).some(key => !['action', 'title', 'description', 'prompt'].includes(key))) {
		throw new AdminAiError(422, 'AI_INVALID_INPUT', 'A solicitação de IA contém campos inválidos.');
	}
	const field = (name: string, max: number, required = true): string => {
		const raw = value[name];
		if ((raw === undefined || raw === '') && !required) return '';
		if (typeof raw !== 'string' || !raw.trim() || raw.length > max || /\u0000/.test(raw)) {
			throw new AdminAiError(422, 'AI_INVALID_INPUT', 'Revise os textos enviados para a IA.');
		}
		return raw.trim();
	};
	// O cliente escolhe uma função do painel, nunca projeto, modelo, URL ou credencial.
	switch (value.action) {
		case 'generate': {
			const title = field('title', 200);
			return `Gere uma descrição clara e persuasiva para o produto "${title}". Foque nos benefícios e casos de uso para uma gráfica e loja de personalizados. Retorne somente a descrição, sem título ou introdução.`;
		}
		case 'improveTitle': {
			const title = field('title', 200);
			return `Melhore o título de produto "${title}" para torná-lo claro, atraente e amigável para busca. Retorne somente o título, sem aspas ou explicações.`;
		}
		case 'improveDescription': {
			const description = field('description', 4000);
			return `Melhore a descrição de produto a seguir para deixá-la clara, profissional e persuasiva, sem inventar especificações: "${description}". Retorne somente a descrição.`;
		}
		case 'custom': {
			const title = field('title', 200);
			const prompt = field('prompt', 4000);
			return `Escreva uma descrição para o produto "${title}" seguindo estas orientações: "${prompt}". Não invente dados técnicos que não estejam nas orientações. Retorne somente a descrição.`;
		}
		default:
			throw new AdminAiError(422, 'AI_INVALID_ACTION', 'A função de IA solicitada não é válida.');
	}
}

async function deadline<T>(operation: (signal: AbortSignal) => Promise<T>, milliseconds: number, error: AdminAiError): Promise<T> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout>;
	try {
		return await Promise.race([
			operation(controller.signal),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => { reject(error); controller.abort(); }, milliseconds);
			}),
		]);
	} finally {
		clearTimeout(timer);
		controller.abort();
	}
}

async function boundedJson(response: Response): Promise<unknown> {
	if (!response.body) throw new Error('Resposta ausente.');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 256 * 1024) throw new Error('Resposta excessiva.');
			chunks.push(value);
		}
		const data = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
		return JSON.parse(new TextDecoder().decode(data));
	} finally {
		await reader.cancel().catch(() => undefined);
	}
}

export async function serverAiAccessToken(getAccessToken: () => Promise<string>, timeoutMs = 10_000): Promise<string> {
	try {
		const accessToken = await deadline(() => getAccessToken(), timeoutMs,
			new AdminAiError(503, 'AI_CREDENTIAL_UNAVAILABLE', 'Não foi possível autenticar a IA do servidor.'));
		if (!accessToken || /[\r\n]/.test(accessToken)) throw new Error('Credencial ausente.');
		return accessToken;
	} catch {
		throw new AdminAiError(503, 'AI_CREDENTIAL_UNAVAILABLE', 'Não foi possível autenticar a IA do servidor.');
	}
}

export async function generateAdminAiText(
	config: VertexAiConfig,
	instruction: string,
	getAccessToken: () => Promise<string>,
	options: { fetch?: typeof fetch; timeoutMs?: number; credentialTimeoutMs?: number } = {},
): Promise<string> {
	const accessToken = await serverAiAccessToken(getAccessToken, options.credentialTimeoutMs);
	try {
		return await deadline(async signal => {
			const response = await (options.fetch ?? fetch)(config.endpoint, {
				method: 'POST', redirect: 'error', signal,
				headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contents: [{ role: 'user', parts: [{ text: instruction }] }],
					generationConfig: { maxOutputTokens: 2048 },
				}),
			});
			if (!response.ok) {
				void response.body?.cancel().catch(() => undefined);
				if (response.status === 429) throw new AdminAiError(429, 'AI_PROVIDER_RATE_LIMIT', 'A IA atingiu o limite de uso. Aguarde antes de tentar novamente.');
				if ([400, 401, 403, 404].includes(response.status)) throw new AdminAiError(503, 'AI_PROVIDER_CONFIGURATION', 'Confira a API, o modelo e a permissão da conta de serviço para a IA.');
				throw new AdminAiError(502, 'AI_PROVIDER_UNAVAILABLE', 'A IA está temporariamente indisponível. Tente novamente.');
			}
			const result = await boundedJson(response);
			const candidate = record(result) && Array.isArray(result.candidates) ? result.candidates[0] : null;
			const content = record(candidate) && record(candidate.content) ? candidate.content : null;
			const parts = content && Array.isArray(content.parts) ? content.parts : [];
			const text = parts.filter(part => record(part) && part.thought !== true && typeof part.text === 'string')
				.map(part => part.text).join('').trim();
			if (!text || text.length > 12_000) throw new AdminAiError(502, 'AI_EMPTY_RESPONSE', 'A IA não retornou um texto utilizável.');
			return text;
		}, options.timeoutMs ?? 25_000, new AdminAiError(504, 'AI_TIMEOUT', 'A IA demorou para responder. Tente novamente.'));
	} catch (error) {
		if (error instanceof AdminAiError) throw error;
		throw new AdminAiError(502, 'AI_PROVIDER_UNAVAILABLE', 'A IA está temporariamente indisponível. Tente novamente.');
	}
}
