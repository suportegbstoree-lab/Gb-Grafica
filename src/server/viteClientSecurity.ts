import path from 'node:path';
import { existsSync } from 'node:fs';
import type { Plugin, ResolvedConfig } from 'vite';
import { ClientFilePolicy, guardLocalWebSocket, localNetworkMiddleware, localNetworkPolicy, validateLocalBind } from './localServerSecurity.js';

/** The same file boundary is used by embedded Vite, the Vite CLI and preview. */
export function viteClientSecurity(root: string, allowE2E: boolean, env: Record<string, string | undefined>): Plugin {
  const files = new ClientFilePolicy(root, allowE2E);
  let config: ResolvedConfig;
  return {
    name: 'gb-client-file-boundary', enforce: 'pre',
    configResolved(value) { config = value; },
    buildStart() { files.assertPublicTree(); },
    load(id) {
      if (id.startsWith('\0') || id === '/@react-refresh') return null;
      const file = id.split(/[?#]/, 1)[0];
      // Vite also calls load() with virtual HTML-route IDs and pending optimizer
      // outputs. The HTTP middleware checks URLs; this hook checks real files.
      if (path.isAbsolute(file) && existsSync(file) && !files.allowedFile(file)) {
        this.error('Private or unsupported file cannot be loaded by the browser build/server.');
      }
      return null;
    },
    configureServer(server) {
      const policy = localNetworkPolicy(env, allowE2E);
      validateLocalBind(config.server.host, policy);
      files.assertPublicTree();
      server.middlewares.use(localNetworkMiddleware(policy));
      server.middlewares.use(files.middleware());
      const hmr = config.server.hmr;
      const parent = typeof hmr === 'object' && hmr.server ? hmr.server : server.httpServer;
      if (parent) guardLocalWebSocket(parent, policy, config.server.ws === false);
      else if (config.server.ws !== false) throw new Error('Middleware HMR must share the parent HTTP server.');
    },
    configurePreviewServer(server) {
      const policy = localNetworkPolicy(env);
      validateLocalBind(config.preview.host, policy);
      files.assertDist();
      server.middlewares.use(localNetworkMiddleware(policy));
      server.middlewares.use(files.middleware(true));
      guardLocalWebSocket(server.httpServer, policy, true);
    },
  };
}
