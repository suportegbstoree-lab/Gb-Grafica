import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PAGBANK_TOKEN = process.env.PAGBANK_TOKEN;
const PAGBANK_ENV = process.env.PAGBANK_ENV || 'production';
const PAGBANK_BASE_URL = PAGBANK_ENV === 'sandbox' 
  ? 'https://sandbox.api.pagseguro.com' 
  : 'https://api.pagseguro.com';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware
  app.use(cors());
  app.use(express.json());

  // --- API ROUTES FIRST ---
  
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      time: new Date().toISOString(),
      pagbank_configured: !!PAGBANK_TOKEN 
    });
  });

  // PagBank Checkout
  app.post("/api/checkout", async (req, res) => {
    console.log('[SERVER] PagBank Checkout Request');
    try {
      const { items, orderId, baseUrl, shippingCost, paymentMethod, userEmail, cpf } = req.body;
      
      if (!PAGBANK_TOKEN) {
        return res.status(500).json({ error: 'Configuração Incompleta', details: 'Token PagBank não definido no servidor.' });
      }

      const effectiveBaseUrl = baseUrl || process.env.APP_URL || `https://${req.headers.host}`;
      const subtotalInCents = items.reduce((acc: number, item: any) => {
        const price = parseFloat((item.preco || "0").toString().replace(/[^0-9,.]/g, '').replace(',', '.'));
        return acc + Math.round(price * 100 * (item.quantidade || 1));
      }, 0);
      const shippingInCents = Math.round((parseFloat(shippingCost) || 0) * 100);
      const totalInCents = subtotalInCents + shippingInCents;

      const customer = {
        name: userEmail?.split('@')[0] || 'Cliente GBL',
        email: userEmail || 'compras@gblgrafica.com.br',
        tax_id: cpf || '00000000000', 
        phones: [{ country: '55', area: '11', number: '99999999', type: 'MOBILE' }]
      };

      // PAGBANK DIRECT PIX FLOW
      if (paymentMethod === 'pix') {
        const orderBody = {
          reference_id: orderId,
          customer: customer,
          items: items.map((i: any) => ({
            name: i.nome,
            quantity: i.quantidade || 1,
            unit_amount: Math.round(parseFloat((i.preco || "0").toString().replace(/[^0-9,.]/g, '').replace(',', '.')) * 100)
          })),
          qr_codes: [
            {
              amount: { value: totalInCents },
              expiration_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24h
            }
          ],
          notification_urls: [`${effectiveBaseUrl}/api/webhook/pagbank`]
        };

        if (shippingInCents > 0) {
          orderBody.items.push({
            name: 'Frete',
            quantity: 1,
            unit_amount: shippingInCents
          });
        }

        const response = await axios.post(`${PAGBANK_BASE_URL}/orders`, orderBody, {
          headers: {
            'Authorization': `Bearer ${PAGBANK_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });

        const pixData = response.data.qr_codes[0];
        const qrCodeImage = pixData.links.find((l: any) => l.rel === 'QRCODE')?.href;

        return res.json({ 
          payment_method: 'pix',
          qr_code: pixData.text,
          qr_code_url: qrCodeImage,
          payment_id: response.data.id,
          status: response.data.status || 'WAITING',
          total: (totalInCents / 100).toFixed(2)
        });
      }

      // PAGBANK REDIRECT CHECKOUT (For Cards)
      const checkoutBody = {
        reference_id: orderId,
        customer: customer,
        items: items.map((i: any) => ({
          name: i.nome,
          quantity: i.quantidade || 1,
          unit_amount: Math.round(parseFloat((i.preco || "0").toString().replace(/[^0-9,.]/g, '').replace(',', '.')) * 100)
        })),
        payment_methods: [
          { type: 'CREDIT_CARD' },
          { type: 'BOLETO' },
          { type: 'PIX' }
        ],
        redirect_url: `${effectiveBaseUrl}/?status=success&orderId=${orderId}`,
        notification_urls: [`${effectiveBaseUrl}/api/webhook/pagbank`]
      };

      if (shippingInCents > 0) {
        checkoutBody.items.push({
          name: 'Frete',
          quantity: 1,
          unit_amount: shippingInCents
        });
      }

      const response = await axios.post(`${PAGBANK_BASE_URL}/checkouts`, checkoutBody, {
        headers: {
          'Authorization': `Bearer ${PAGBANK_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      const payLink = response.data.links.find((l: any) => l.rel === 'PAY')?.href;

      res.json({ payment_method: 'hosted', id: response.data.id, init_point: payLink });
    } catch (error: any) {
      console.error('[SERVER] PagBank Checkout Error:', error.response?.data || error.message);
      res.status(500).json({ 
        error: 'Erro no checkout PagBank', 
        details: error.response?.data?.error_messages?.[0]?.description || error.message 
      });
    }
  });

  // Check Payment Status
  app.get("/api/payment-status/:id", async (req, res) => {
    try {
      if (!PAGBANK_TOKEN) return res.status(500).json({ error: 'Token missing' });
      
      const response = await axios.get(`${PAGBANK_BASE_URL}/orders/${req.params.id}`, {
        headers: { 'Authorization': `Bearer ${PAGBANK_TOKEN}` }
      });
      
      // Map PagBank status to simple terms
      const status = response.data.status === 'PAID' ? 'approved' : 'pending';
      res.json({ status });
    } catch (error) {
      res.status(500).json({ error: 'Error fetching status' });
    }
  });

  // Webhook for PagBank
  app.post("/api/webhook/pagbank", async (req, res) => {
    console.log('[SERVER] PagBank Webhook Received:', JSON.stringify(req.body));
    res.sendStatus(200);
  });

  // --- STATIC FILES / VITE ---
  const isDev = process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "staging";

  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
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
