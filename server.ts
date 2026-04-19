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
  // Move it inside the routes to avoid startup issues if token is missing
  
  // Checkout Route
  app.post("/api/checkout", async (req, res) => {
    console.log('[API] Checkout Request Started');
    try {
      if (!process.env.MP_ACCESS_TOKEN) {
        console.error('[API] Error: MP_ACCESS_TOKEN not found');
        return res.status(500).json({ error: 'Configuração Incompleta', details: 'O token do Mercado Pago não foi configurado no servidor.' });
      }

      const client = new MercadoPagoConfig({ 
        accessToken: process.env.MP_ACCESS_TOKEN,
        options: { timeout: 15000 }
      });

      const { items, orderId, baseUrl } = req.body;
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

      console.log('[API] Checkout Success:', result.id);
      res.json({ id: result.id, init_point: result.init_point });
    } catch (error: any) {
      console.error('[API] Checkout Fatal Error:', error);
      res.status(500).json({ error: 'Erro no processamento', details: error.message });
    }
  });

  // Health checks
  app.get("/ping", (req, res) => res.send("pong version 2"));
  app.get("/api/status", (req, res) => res.json({ status: "ok", version: "2.1" }));

  // Vite / Static Files
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
