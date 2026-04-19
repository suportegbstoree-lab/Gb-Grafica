import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();

// Middleware
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Log incoming requests for debugging 405/routing
app.use((req, res, next) => {
  console.log(`[SERVER] ${req.method} ${req.url}`);
  next();
});

const PAGBANK_TOKEN = process.env.PAGBANK_TOKEN;
const PAGBANK_ENV = process.env.PAGBANK_ENV || 'production';
const PAGBANK_BASE_URL = PAGBANK_ENV === 'sandbox' 
  ? 'https://sandbox.api.pagseguro.com' 
  : 'https://api.pagseguro.com';

console.log(`[SERVER] Initializing PagBank in ${PAGBANK_ENV} mode.`);
if (!PAGBANK_TOKEN) {
  console.warn('[SERVER] WARNING: PAGBANK_TOKEN is not defined.');
}

// --- API ROUTES ---

// Health check (multi-path for robustness)
const healthHandler = (req: express.Request, res: express.Response) => {
  res.json({ 
    status: "ok", 
    time: new Date().toISOString(),
    pagbank_configured: !!PAGBANK_TOKEN,
    env: PAGBANK_ENV
  });
};

app.get("/api/health", healthHandler);
app.get("/health", healthHandler);

// Checkout Handler
const checkoutHandler = async (req: express.Request, res: express.Response) => {
  console.log('[SERVER] Checkout Request Received - Path:', req.path);
  try {
    const { items, orderId, baseUrl, shippingCost, paymentMethod, userEmail, cpf } = req.body;
    
    if (!PAGBANK_TOKEN) {
      return res.status(500).json({ error: 'Configuração Incompleta', details: 'Token PagBank não definido no servidor.' });
    }

    const effectiveBaseUrl = baseUrl || process.env.APP_URL || `https://${req.headers.host}`;
    
    // Total in cents
    const subtotalInCents = items.reduce((acc: number, item: any) => {
      const price = parseFloat((item.preco || "0").toString().replace(/[^0-9,.]/g, '').replace(',', '.'));
      return acc + Math.round(price * 100 * (item.quantidade || 1));
    }, 0);
    const shippingInCents = Math.round((parseFloat(shippingCost) || 0) * 100);
    const totalInCents = subtotalInCents + shippingInCents;

    const customer = {
      name: userEmail?.split('@')[0] || 'Cliente GBL',
      email: userEmail || 'compras@gblgrafica.com.br',
      tax_id: cpf || '52317132029', 
      phones: [{ country: '55', area: '11', number: '999999999', type: 'MOBILE' }]
    };

    if (paymentMethod === 'pix') {
      const orderBody: any = {
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
            expiration_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
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
    res.status(error.response?.status || 500).json({ 
      error: 'Erro no checkout PagBank', 
      details: error.response?.data?.error_messages?.[0]?.description || error.message 
    });
  }
};

app.post("/api/checkout", checkoutHandler);
app.post("/checkout", checkoutHandler);

// Status and Webhook
app.get("/api/payment-status/:id", async (req, res) => {
  try {
    if (!PAGBANK_TOKEN) return res.status(500).json({ error: 'Token missing' });
    const response = await axios.get(`${PAGBANK_BASE_URL}/orders/${req.params.id}`, {
      headers: { 'Authorization': `Bearer ${PAGBANK_TOKEN}` }
    });
    const status = response.data.status === 'PAID' ? 'approved' : 'pending';
    res.json({ status });
  } catch (error) {
    res.status(500).json({ status: 'error' });
  }
});

app.post("/api/webhook/pagbank", (req, res) => {
  console.log('[SERVER] Webhook PagBank:', JSON.stringify(req.body));
  res.sendStatus(200);
});

export default app;
