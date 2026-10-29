import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { ClientFilePolicy, guardLocalWebSocket, localNetworkMiddleware, type LocalServerOptions } from './localServerSecurity.js';
import { logEvent } from './observability.js';

export async function startLocalServer(root: string, options: LocalServerOptions) {
  const app = express();
  app.disable('x-powered-by');
  const server = createServer(app);
  const files = new ClientFilePolicy(root);
  let vite: import('vite').ViteDevServer | undefined;
  try {
    if (options.mode === 'development') {
      app.use(localNetworkMiddleware(options.network));
      guardLocalWebSocket(server, options.network, process.env.DISABLE_HMR === 'true');
    } else {
      files.assertDist();
      // Production never has a Vite/HMR listener or a fallback to source files.
      server.on('upgrade', (_req, socket) => socket.destroy());
    }
    // Import after runtime mode has been selected, before the request handlers run.
    const { default: api } = await import('./app.js');
    app.use(api);
    if (options.mode === 'development') {
      const { createServer: createViteServer } = await import('vite');
      const disabled = process.env.DISABLE_HMR === 'true';
      vite = await createViteServer({
        root, mode: 'development', appType: 'spa',
        server: { port: options.port, middlewareMode: true, hmr: disabled ? false : { server }, ...(disabled ? { ws: false } : {}) },
      });
      app.use(vite.middlewares);
    } else {
      app.use(files.middleware(true));
      app.use(express.static(files.dist, {
        index: false, dotfiles: 'deny', maxAge: 0,
        setHeaders(res, file) {
          res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`)
            ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      }));
      app.get('*', (_req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(files.dist, 'index.html'));
      });
    }
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port, options.host, resolve);
    });
    logEvent('info', 'server_started', { host: options.host, port: options.port, environment: options.mode });
  } catch (error) {
    await vite?.close();
    server.close();
    throw error;
  }
  const close = async () => {
    server.closeAllConnections();
    await Promise.all([vite?.close(), new Promise<void>(resolve => server.close(() => resolve()))]);
  };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  return { server, vite, close };
}
