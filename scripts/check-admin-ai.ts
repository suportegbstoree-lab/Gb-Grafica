import { loadEnv } from 'vite';
import { getAdminServices } from '../src/server/firebaseAdmin.js';
import { AdminAiError, serverAiAccessToken, vertexAiConfig } from '../src/server/adminAi.js';
import clientConfig from '../firebase-applet-config.json' with { type: 'json' };

Object.assign(process.env, loadEnv('production', process.cwd(), ''));

try {
	const { app } = getAdminServices();
	const config = vertexAiConfig(app.options.projectId);
	if (config.projectId !== clientConfig.projectId) throw new AdminAiError(503, 'AI_PROJECT_MISMATCH', 'O projeto da conta de serviço difere do app web.');
	console.log('Configuração local de IA: válida; projeto da conta e app web compatíveis.');
	console.log(`Modelo: ${config.model}; localização: ${config.location}.`);
	if (process.argv.includes('--permissions')) {
		const token = await serverAiAccessToken(async () => (await app.options.credential.getAccessToken()).access_token);
		const response = await fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${config.projectId}:testIamPermissions`, {
			method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ permissions: ['aiplatform.endpoints.predict'] }),
		});
		if (!response.ok) throw new AdminAiError(503, 'AI_PERMISSION_CHECK_UNAVAILABLE', 'Não foi possível consultar a permissão. Confira no IAM da conta de serviço.');
		const body = await response.json() as { permissions?: unknown };
		const permitted = Array.isArray(body.permissions) && body.permissions.includes('aiplatform.endpoints.predict');
		console.log(`Permissão de geração na conta de serviço: ${permitted ? 'presente' : 'ausente'}.`);
		if (!permitted) process.exitCode = 1;
	} else {
		console.log('IAM não consultado. Use --permissions para uma verificação remota somente de leitura.');
	}
	console.log('Nenhuma geração, alteração de conta, concessão de papel ou pagamento foi realizado.');
	console.log('A configuração não confirma API ativa, disponibilidade do modelo ou fechamento do endpoint antigo.');
} catch (error) {
	console.error(error instanceof AdminAiError ? `${error.code}: ${error.message}` : 'Não foi possível verificar a IA. Confira a configuração e a conexão da conta de serviço.');
	process.exitCode = 1;
}
