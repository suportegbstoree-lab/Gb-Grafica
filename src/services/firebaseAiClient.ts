import type { FirebaseApp } from 'firebase/app';
import { AgentPlatformBackend, getAI, getGenerativeModel } from 'firebase/ai';

export function createFirebaseTextModel(app: FirebaseApp, modelName: string) {
	const ai = getAI(app, {
		backend: new AgentPlatformBackend(),
		useLimitedUseAppCheckTokens: true,
	});
	return getGenerativeModel(ai, { model: modelName });
}
