import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware
  app.use(cors());
  app.use(express.json());

  // --- API ROUTES FIRST ---
  
  // Health checks
  app.get("/ping", (req, res) => {
    res.send("pong-v3");
  });

  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      time: new Date().toISOString(),
      node_env: process.env.NODE_ENV,
      mp_token: !!process.env.MP_ACCESS_TOKEN 
    });
  });

  // Mercado Pago Checkout
  app.post("/api/checkout", async (req, res) => {
    console.log('[SERVER] Checkout Request');
    try {
      const { items, orderId, baseUrl, shippingCost, paymentMethod, userEmail } = req.body;
      
      const token = process.env.MP_ACCESS_TOKEN;
      if (!token) {
        return res.status(500).json({ error: 'Configuração Incompleta', details: 'Token MP não definido no servidor.' });
      }

      const client = new MercadoPagoConfig({ accessToken: token });
      const preference = new Preference(client);
      const effectiveBaseUrl = baseUrl || process.env.APP_URL || `https://${req.headers.host}`;
      
      const mpItems = items.map((item: any) => ({
        id: item.id,
        title: item.nome,
        unit_price: parseFloat((item.preco || "0").toString().replace(/[^0-9,.]/g, '').replace(',', '.')),
        quantity: parseInt(item.quantidade) || 1,
        currency_id: 'BRL'
      }));

      if (shippingCost && parseFloat(shippingCost) > 0) {
        mpItems.push({
          id: 'shipping',
          title: 'Frete / Entrega',
          unit_price: parseFloat(shippingCost),
          quantity: 1,
          currency_id: 'BRL'
        });
      }

      const preferenceBody: any = {
        items: mpItems,
        external_reference: orderId,
        back_urls: {
          success: `${effectiveBaseUrl}/?status=success&orderId=${orderId}`,
          failure: `${effectiveBaseUrl}/?status=failure`,
          pending: `${effectiveBaseUrl}/?status=pending`,
        },
        auto_return: 'approved',
        binary_mode: true,
        payer: {
          email: userEmail || 'compras@gblgrafica.com.br',
        }
      };

      // Configuration to enable PIX and Cards without exclusions
      // We set default_payment_method_id to suggest PIX if chosen in store
      preferenceBody.payment_methods = {
        excluded_payment_types: [
          { id: 'ticket' } // Excluding standard Boleto if you want to focus on PIX/Cards
        ],
        installments: 12
      };

      if (paymentMethod === 'pix') {
        preferenceBody.payment_methods.default_payment_method_id = 'pix';
      }

      const result = await preference.create({
        body: preferenceBody
      });

      res.json({ payment_method: 'hosted', id: result.id, init_point: result.init_point });
    } catch (error: any) {
      console.error('[SERVER] Checkout Error:', error);
      res.status(500).json({ error: 'Erro no checkout', details: error.message });
    }
  });

  // Webhook for Mercado Pago (to automate updates)
  app.post("/api/webhook/mp", async (req, res) => {
    // This would ideally update Firestore directly
    console.log('[SERVER] MP Webhook Received:', req.body);
    res.sendStatus(200);
  });

  // --- STATIC FILES / VITE ---
  
  const isDev = process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "staging";

  if (isDev) {
    console.log('Running in DEVELOPMENT mode');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log('Running in PRODUCTION mode');
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on 0.0.0.0:${PORT}`);
  });
}

startServer().catch(console.error);
