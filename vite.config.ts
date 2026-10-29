import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { realpathSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import { appCheckBuildProblems } from './src/lib/appCheckConfig';
import { localNetworkPolicy } from './src/server/localServerSecurity';
import { viteClientSecurity } from './src/server/viteClientSecurity';

export default defineConfig(({ mode, command }) => {
	const env = loadEnv(mode, __dirname, '');
	const e2e = command === 'serve' && mode === 'e2e' && env.VITE_E2E_MODE === 'true';
	if (command === 'build') {
		if (env.VITE_E2E_MODE === 'true') throw new Error('VITE_E2E_MODE cannot be enabled in a published build.');
		const problems = appCheckBuildProblems(env);
		if (problems.length) throw new Error(problems.join(' '));
	}
	const network = command === 'serve' ? localNetworkPolicy(env, e2e) : { hosts: ['localhost', '127.0.0.1', '[::1]'] };
	const disabledHmr = e2e || env.DISABLE_HMR === 'true';

	return {
		cacheDir: path.resolve(__dirname, 'node_modules/.vite', mode),
		plugins: [viteClientSecurity(__dirname, e2e, env), react(), tailwindcss()],
		resolve: {
			alias: {
				'@': path.resolve(__dirname, '.'),
			},
		},
		server: {
			host: '127.0.0.1', strictPort: true,
			hmr: !disabledHmr,
			...(disabledHmr ? { ws: false as const } : {}),
			allowedHosts: network.hosts,
			cors: false,
			fs: {
				strict: true,
				allow: [
					path.resolve(__dirname, 'src'),
					path.resolve(__dirname, 'node_modules'),
					realpathSync(path.resolve(__dirname, 'node_modules')),
					path.resolve(__dirname, 'index.html'),
					path.resolve(__dirname, 'firebase-applet-config.json'),
					...(e2e ? [path.resolve(__dirname, 'e2e/fixtures/app-check.ts')] : []),
				],
				deny: ['**/.env*', '**/*.{pem,key,crt,p12,pfx}', '**/.git/**', '**/.secret*', '**/src/server/**', '**/*.{test,spec}.{ts,tsx,js,jsx}'],
			},
		},
		preview: { host: '127.0.0.1', strictPort: true, allowedHosts: network.hosts, cors: false },
		build: {
			rollupOptions: {
				output: {
					manualChunks(id) {
						if (!id.includes('node_modules')) return undefined;
						if (id.includes('/firebase/')) return 'firebase';
						if (id.includes('/motion/')) return 'motion';
						if (id.includes('/lucide-react/')) return 'icons';
						if (id.includes('/react')) return 'react-vendor';
						return undefined;
					},
				},
			},
		},
	};
});
