import express from 'express';
import { createServer as createViteServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { guardLocalWebSocket, localNetworkMiddleware, localNetworkPolicy } from '../src/server/localServerSecurity.js';

process.env.VITE_E2E_MODE = 'true';
process.env.DISABLE_HMR = 'true';

const PORT = Number(process.env.E2E_PORT || 4173);
const HOST = '127.0.0.1';

async function startE2EServer() {
  const app = express();
  const server = createServer(app);
  const policy = localNetworkPolicy({}, true);
  app.use(localNetworkMiddleware(policy));
  guardLocalWebSocket(server, policy, true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/__e2e/health', (_request, response) => {
    response.json({ status: 'ok', mode: 'e2e' });
  });

  app.get('/__e2e/app-check', async (_request, response, next) => {
    try {
      const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
      const headers = config.headers.find((rule: { source: string }) => rule.source === '/(.*)').headers;
      const policy = headers.find((header: { key: string }) => header.key === 'Content-Security-Policy').value;
      response.setHeader('Content-Security-Policy', policy);
      response.type('html').send(await readFile(new URL('../e2e/fixtures/app-check.html', import.meta.url), 'utf8'));
    } catch (error) { next(error); }
  });

  app.post('/api/shipping-quote', (request, response) => {
    if (!/^\d{8}$/.test(String(request.body?.cep || ''))) {
      response.status(400).json({ error: 'Informe um CEP válido.' });
      return;
    }
    response.json({
      cep: String(request.body.cep),
      address: 'Rua dos Testes, Centro, Franca/SP',
      amount_cents: 1290,
      street: 'Rua dos Testes',
      neighborhood: 'Centro',
      city: 'Franca',
      state: 'SP',
      options: [
        { service_code: '03298', service_name: 'PAC', amount_cents: 1290, delivery_days: 5, home_delivery: true, saturday_delivery: false },
        { service_code: '03220', service_name: 'SEDEX', amount_cents: 2590, delivery_days: 2, home_delivery: true, saturday_delivery: false },
      ],
      parcel_count: 1,
      quoted_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
  });

  app.post('/api/checkout', (request, response) => {
    if (request.get('authorization') !== 'Bearer e2e-id-token') {
      response.status(401).json({ error: 'Sessão de teste inválida.' });
      return;
    }
    if (!Array.isArray(request.body?.items) || request.body.items.length === 0) {
      response.status(400).json({ error: 'Carrinho vazio.' });
      return;
    }
    response.status(201).json({
      payment_method: 'hosted',
      order_id: 'GB-E2E-CHECKOUT',
      checkout_id: 'CHEC_E2E',
      init_point: 'https://pagamento.sandbox.pagbank.com.br/pagamento?code=e2e',
    });
  });

  const vite = await createViteServer({
    mode: 'e2e',
    appType: 'spa',
    server: { port: PORT, middlewareMode: true, hmr: false, ws: false,
      warmup: { clientFiles: ['./src/main.tsx', './src/e2e/E2EHarness.tsx'] } },
  });
  app.use(vite.middlewares);

  server.listen(PORT, HOST, () => {
    console.log(`E2E server listening on http://127.0.0.1:${PORT}`);
  });

  const shutdown = async () => {
    server.close();
    await vite.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

startE2EServer().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
