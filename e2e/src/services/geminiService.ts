import { auth } from '../firebase';
import { apiErrorMessage, type ApiErrorPayload } from '../lib/apiError';

type AiAction = 'generate' | 'improveTitle' | 'improveDescription' | 'custom';

async function requestSuggestion(
  action: AiAction,
  payload: { title?: string; description?: string; prompt?: string },
): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para usar a IA.');

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);

  try {
    const idToken = await user.getIdToken();
    const response = await fetch('/api/admin/ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({})) as { suggestion?: unknown } & ApiErrorPayload;
    if (!response.ok) {
      throw new Error(apiErrorMessage(data, 'Não foi possível consultar a IA.'));
    }

    if (typeof data.suggestion !== 'string' || !data.suggestion.trim()) {
      throw new Error('A IA não retornou uma sugestão válida.');
    }

    return data.suggestion.trim();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('A consulta à IA demorou demais. Tente novamente.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const generateDescriptionFromTitle = (title: string) => (
  requestSuggestion('generate', { title })
);

export const improveTitle = (title: string) => (
  requestSuggestion('improveTitle', { title })
);

export const improveDescription = (description: string) => (
  requestSuggestion('improveDescription', { description })
);

export const generateDescriptionWithCustomPrompt = (title: string, prompt: string) => (
  requestSuggestion('custom', { title, prompt })
);
