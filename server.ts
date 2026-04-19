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

  // Health checks and status
  app.get("/ping", (req, res) => {
    console.log('PING received');
    res.send("pong");
  });

  app.get("/api/status", (req, res) => {
    console.log('STATUS API hit');
    res.json({ status: "online", time: new Date().toISOString() });
  });

  // Mercado Pago Configuration
  const client = new MercadoPagoConfig({ 
    accessToken: process.env.MP_ACCESS_TOKEN || '',
    options: { timeout: 10000 }
  });

  // Checkout Route
  app.post("/api/checkout", async (req, res) => {
    console.log('CHECKOUT API hit');
    try {
      const { items, orderId, baseUrl } = req.body;
      
      if (!process.env.MP_ACCESS_TOKEN) {
        return res.status(500).json({ error: 'Token MP não configurado' });
      }

      const effectiveBaseUrl = baseUrl || process.env.APP_URL || `https://${req.headers.host}`;
      const preference = new Preference(client);
      
      const mpItems = items.map((item: any) => ({
        id: item.id,
        title: item.nome,
        unit_price: parseFloat((item.preco || "0").toString().replace(/[^0-9,.]/g, '').replace(',', '.')),
        quantity: parseInt(item.quantidade) || 1,
        currency_id: 'BRL'
      }));

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

      res.json({ id: result.id, init_point: result.init_point });
    } catch (error: any) {
      console.error('Checkout error:', error);
      res.status(500).json({ error: 'Erro no checkout', details: error.message });
    }
  });

  // Vite / Static Files (Dynamic)
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
