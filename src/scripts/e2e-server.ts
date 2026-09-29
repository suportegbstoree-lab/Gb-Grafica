import express from 'express';
import { createServer as createViteServer } from 'vite';

process.env.VITE_E2E_MODE = 'true';
process.env.DISABLE_HMR = 'true';

const PORT = Number(process.env.E2E_PORT || 4173);
const HOST = '0.0.0.0';

async function startE2EServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/__e2e/health', (_request, response) => {
    response.json({ status: 'ok', mode: 'e2e' });
  });

  app.post('/api/shipping-quote', (request, response) => {
    if (!/^\d{8}$/.test(String(request.body?.cep || ''))) {
      response.status(400).json({ error: 'Informe um CEP válido.' });
      return;
    }
    response.json({
      address: 'Rua dos Testes, Centro, Franca/SP',
      amount_cents: 1290,
      street: 'Rua dos Testes',
      neighborhood: 'Centro',
      city: 'Franca',
      state: 'SP',
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
    appType: 'spa',
    server: { middlewareMode: true, hmr: false },
  });
  app.use(vite.middlewares);

  const server = app.listen(PORT, HOST, () => {
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
