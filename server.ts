import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { MercadoPagoConfig, Preference } from 'mercadopago';
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Mercado Pago Configuration
  const client = new MercadoPagoConfig({ 
    accessToken: process.env.MP_ACCESS_TOKEN || '',
    options: { timeout: 5000 }
  });

  // API Routes
  app.post("/api/checkout", async (req, res) => {
    try {
      const { items, orderId } = req.body;

      const preference = new Preference(client);
      const result = await preference.create({
        body: {
          items: items.map((item: any) => ({
            id: item.id,
            title: item.nome,
            unit_price: parseFloat(item.preco),
            quantity: item.quantidade,
            currency_id: 'BRL'
          })),
          external_reference: orderId,
          back_urls: {
            success: `${process.env.APP_URL || 'http://localhost:3000'}/?status=success&orderId=${orderId}`,
            failure: `${process.env.APP_URL || 'http://localhost:3000'}/?status=failure`,
            pending: `${process.env.APP_URL || 'http://localhost:3000'}/?status=pending`,
          },
          auto_return: 'approved',
        }
      });

      res.json({ id: result.id, init_point: result.init_point });
    } catch (error) {
      console.error('Error creating MP preference:', error);
      res.status(500).json({ error: 'Failed to create payment preference' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
