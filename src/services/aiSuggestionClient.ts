import { apiErrorMessage, type ApiErrorPayload } from '../lib/apiError';
import { apiFetch } from './apiClient';

type AiAction = 'generate' | 'improveTitle' | 'improveDescription' | 'custom';
type AiPayload = { title?: string; description?: string; prompt?: string };

export function createAiSuggestionClient(
	getIdToken: () => Promise<string | null>,
	request: typeof fetch = apiFetch,
) {
	return async (action: AiAction, payload: AiPayload): Promise<string> => {
		const idToken = await getIdToken();
		if (!idToken) throw new Error('Faça login novamente para usar a IA.');
		const response = await request('/api/admin/ai/suggestions', {
			method: 'POST',
			headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, ...payload }),
		});
		const raw = await response.json().catch(() => null) as unknown;
		const data = raw && typeof raw === 'object' ? raw as ApiErrorPayload & { text?: unknown } : {};
		if (!response.ok) throw new Error(apiErrorMessage(data, 'Não foi possível obter uma sugestão da IA.'));
		if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('A IA retornou uma resposta vazia.');
		return data.text.trim();
	};
}
