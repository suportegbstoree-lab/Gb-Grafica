import { getCurrentUserIdToken } from '../firebase';
import { createAiSuggestionClient } from './aiSuggestionClient';

const requestSuggestion = createAiSuggestionClient(getCurrentUserIdToken);

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
