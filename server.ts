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
      const effectiveBaseUrl = baseUrl || process.env.APP_URL || `https://${req.headers.host}`;

      // DIRECT PIX FLOW
      if (paymentMethod === 'pix') {
        try {
          const payment = new Payment(client);
          
          const subtotal = items.reduce((acc: number, item: any) => {
            const price = parseFloat((item.preco || "0").toString().replace(/[^0-9,.]/g, '').replace(',', '.'));
            return acc + (price * (item.quantidade || 1));
          }, 0);
          
          const total = subtotal + (parseFloat(shippingCost) || 0);
          const email = userEmail || 'compras@gblgrafica.com.br';
          const firstName = email.split('@')[0].substring(0, 20) || 'Cliente';

          const result = await payment.create({
            body: {
              transaction_amount: parseFloat(total.toFixed(2)),
              description: `Pedido ${orderId} - GBL Gráfica`,
              payment_method_id: 'pix',
              external_reference: orderId,
              payer: {
                email: email,
                first_name: firstName,
                last_name: 'GBL',
              }
            },
            requestOptions: {
              idempotencyKey: `${orderId}-${Date.now()}`
            }
          });

          console.log('[SERVER] Direct PIX Created:', result.id, 'Status:', result.status);

          if (result.status === 'rejected') {
            return res.status(400).json({ 
              error: 'PIX Rejeitado', 
              details: `O Mercado Pago não permitiu gerar este PIX. Motivo: ${result.status_detail}. Verifique sua conta.`,
              payment_method: 'error'
            });
          }

          return res.json({ 
            payment_method: 'pix',
            qr_code: result.point_of_interaction?.transaction_data?.qr_code,
            qr_code_base64: result.point_of_interaction?.transaction_data?.qr_code_base64,
            payment_id: result.id,
            status: result.status,
            total: total.toFixed(2)
          });
        } catch (pixError: any) {
          console.error('[SERVER] PIX Direct API Error:', pixError.message);
          return res.status(400).json({ 
            error: 'Erro na API de PIX', 
            details: `Não foi possível gerar o QR Code. Erro: ${pixError.message}. Verifique se sua chave PIX está ativa no Mercado Pago.`,
            payment_method: 'error'
          });
        }
      }

      // HOSTED CHECKOUT FLOW (Pro)
      const preference = new Preference(client);
      
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
          // Adding a name helps avoid risk filters that hide PIX
          first_name: 'Cliente',
          last_name: 'GBL'
        },
        payment_methods: {
          installments: 12,
        }
      };

      const result = await preference.create({
        body: preferenceBody
      });

      res.json({ payment_method: 'hosted', id: result.id, init_point: result.init_point });
    } catch (error: any) {
      console.error('[SERVER] Checkout Error:', error);
      res.status(500).json({ error: 'Erro no checkout', details: error.message });
    }
  });

  // Check Payment Status (Polling endpoint)
  app.get("/api/payment-status/:id", async (req, res) => {
    try {
      const token = process.env.MP_ACCESS_TOKEN;
      if (!token) return res.status(500).json({ error: 'Token missing' });
      
      const client = new MercadoPagoConfig({ accessToken: token });
      const payment = new Payment(client);
      const result = await payment.get({ id: req.params.id });
      
      res.json({ status: result.status });
    } catch (error) {
      res.status(500).json({ error: 'Error fetching status' });
    }
  });

  // Webhook for Mercado Pago (to automate updates)
  app.post("/api/webhook/mp", async (req, res) => {
    console.log('[SERVER] MP Webhook Received:', JSON.stringify(req.body));
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
