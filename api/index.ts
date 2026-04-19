import express from "express";
import { MercadoPagoConfig, Preference } from 'mercadopago';
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    time: new Date().toISOString(),
    mp_token: !!process.env.MP_ACCESS_TOKEN 
  });
});

app.get("/ping", (req, res) => res.send("pong-v4"));

app.post("/api/checkout", async (req, res) => {
  try {
    const { items, orderId, baseUrl } = req.body;
    const token = process.env.MP_ACCESS_TOKEN;
    
    if (!token) {
      return res.status(500).json({ error: 'Token MP não configurado' });
    }

    const client = new MercadoPagoConfig({ accessToken: token });
    const preference = new Preference(client);

    const effectiveBaseUrl = baseUrl || `https://${req.headers.host}`;
    
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
    res.status(500).json({ error: 'Erro no checkout', details: error.message });
  }
});

export default app;
