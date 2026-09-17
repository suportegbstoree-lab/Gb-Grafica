import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const allowedHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', 'terminal.local']);

  // Hosts extras são úteis para túneis locais. Ex.: VITE_ALLOWED_HOSTS=.trycloudflare.com
  for (const host of (env.VITE_ALLOWED_HOSTS || '').split(',')) {
    if (host.trim()) allowedHosts.add(host.trim());
  }

  if (env.APP_URL) {
    try {
      allowedHosts.add(new URL(env.APP_URL).hostname);
    } catch {
      // A API apresentará um erro explícito caso APP_URL seja necessária e esteja inválida.
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // File watching can be disabled to prevent flickering during automated edits.
      hmr: env.DISABLE_HMR !== 'true',
      allowedHosts: [...allowedHosts],
    },
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
