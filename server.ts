import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { MercadoPagoConfig, Preference } from 'mercadopago';
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  console.log('--- SERVER STARTING ---');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('Access Token defined:', !!process.env.MP_ACCESS_TOKEN);

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Global Request Logger
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });

  // Health check at root
  app.get("/ping", (req, res) => res.send("pong"));

  const apiRouter = express.Router();

  apiRouter.get("/status", (req, res) => {
    res.json({ 
      status: "online", 
      env: process.env.NODE_ENV,
      hasToken: !!process.env.MP_ACCESS_TOKEN,
      baseUrl: process.env.APP_URL
    });
  });

  // Mercado Pago Configuration
  const client = new MercadoPagoConfig({ 
    accessToken: process.env.MP_ACCESS_TOKEN || '',
    options: { timeout: 10000 }
  });

  apiRouter.post("/checkout", async (req, res) => {
    console.log('--- API CHECKOUT HIT ---');
    try {
      const { items, orderId, baseUrl } = req.body;
      
      if (!process.env.MP_ACCESS_TOKEN) {
        return res.status(500).json({ error: 'Erro de Configuração', details: 'MP_ACCESS_TOKEN não configurado.' });
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Carrinho Vazio' });
      }

      const effectiveBaseUrl = baseUrl || process.env.APP_URL || `http://${req.headers.host}`;
      console.log(`Order: ${orderId} | Base: ${effectiveBaseUrl}`);

      const preference = new Preference(client);
      
      const mpItems = items.map((item: any) => {
        const unitPrice = parseFloat((item.preco || "0").toString().replace(/[^0-9,.]/g, '').replace(',', '.'));
        return {
          id: item.id,
          title: item.nome,
          unit_price: unitPrice,
          quantity: parseInt(item.quantidade) || 1,
          currency_id: 'BRL'
        };
      });

      const result = await preference.create({
        body: {
          items: mpItems,
          external_reference: orderId,
          back_urls: {
            success: `${effectiveBaseUrl}/?status=success&orderId=${orderId}`,
            failure: `${effectiveBaseUrl}/?status=failure`,
            pending: `${effectiveBaseUrl}/?status=pending`,
          },
          auto_return: 'approved',
          binary_mode: true,
        }
      });

      console.log('Preference Created:', result.id);
      res.json({ id: result.id, init_point: result.init_point });
    } catch (error: any) {
      console.error('Checkout error:', error);
      res.status(500).json({ error: 'Erro no checkout', details: error.message });
    }
  });

  // Mount API Router
  app.use("/api", apiRouter);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    console.log('Starting in DEVELOPMENT mode with Vite...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log('Starting in PRODUCTION mode with static files...');
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`--- SERVER LISTENING ON PORT ${PORT} ---`);
  });
}

startServer().catch(err => {
  console.error('FAILED TO START SERVER:', err);
});
