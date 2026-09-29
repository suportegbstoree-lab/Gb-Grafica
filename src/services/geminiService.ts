import { auth, generateGeminiText } from '../firebase';


type AiAction = 'generate' | 'improveTitle' | 'improveDescription' | 'custom';

async function requestSuggestion(
	action: AiAction,
	payload: { title?: string; description?: string; prompt?: string },
): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Faça login novamente para usar a IA.');

	const { title = '', description = '', prompt = '' } = payload;
	let instruction = '';
	switch (action) {
		case 'generate':
			instruction = `Gere uma descrição clara e persuasiva para o produto "${title}". Foque nos benefícios e casos de uso para uma gráfica e loja de personalizados. Retorne somente a descrição, sem título ou introdução.`;
			break;
		case 'improveTitle':
			instruction = `Melhore o título de produto "${title}" para torná-lo claro, atraente e amigável para busca. Retorne somente o título, sem aspas ou explicações.`;
			break;
		case 'improveDescription':
			instruction = `Melhore a descrição de produto a seguir para deixá-la clara, profissional e persuasiva, sem inventar especificações: "${description}". Retorne somente a descrição.`;
			break;
		case 'custom':
			instruction = `Escreva uma descrição para o produto "${title}" seguindo estas orientações: "${prompt}". Não invente dados técnicos que não estejam nas orientações. Retorne somente a descrição.`;
			break;
	}
	return generateGeminiText(instruction);
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
