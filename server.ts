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
    options: { timeout: 10000 }
  });

  console.log('Mercado Pago Access Token status:', process.env.MP_ACCESS_TOKEN ? 'DEFINED (Ends with ' + process.env.MP_ACCESS_TOKEN.slice(-4) + ')' : 'UNDEFINED');
  console.log('APP_URL status:', process.env.APP_URL || 'UNDEFINED (Using fallback)');

  // API Routes
  app.post("/api/checkout", async (req, res) => {
    console.log('--- NEW CHECKOUT ATTEMPT ---');
    try {
      if (!process.env.MP_ACCESS_TOKEN) {
        console.error('SERVER ERROR: MP_ACCESS_TOKEN is missing');
        return res.status(500).json({ error: 'Erro de Configuração', details: 'Token do Mercado Pago não configurado no servidor.' });
      }

      const { items, orderId, baseUrl } = req.body;
      console.log('Request parameters:', { orderId, baseUrl, itemCount: items?.length });

      if (!items || !Array.isArray(items) || items.length === 0) {
        console.error('CLIENT ERROR: Empty or invalid items array');
        return res.status(400).json({ error: 'Carrinho Vazio', details: 'Nenhum item foi enviado para o checkout.' });
      }

      const effectiveBaseUrl = baseUrl || process.env.APP_URL || 'http://localhost:3000';
      
      const preference = new Preference(client);
      
      // Detailed logging of item formatting
      const mpItems = items.map((item: any, index: number) => {
        const cleanedPrice = (item.preco || "0").toString()
          .replace(/[^0-9,.]/g, '')
          .replace(',', '.');
        
        const unitPrice = parseFloat(cleanedPrice);
        console.log(`Item ${index}: "${item.nome}" | Raw: "${item.preco}" | Cleaned: "${cleanedPrice}" | Final: ${unitPrice}`);

        if (isNaN(unitPrice) || unitPrice <= 0) {
          throw new Error(`Preço inválido para o item "${item.nome}" (Entrada: ${item.preco})`);
        }

        return {
          id: item.id,
          title: item.nome,
          unit_price: unitPrice,
          quantity: parseInt(item.quantidade) || 1,
          currency_id: 'BRL'
        };
      });

      console.log('Creating preference on Mercado Pago...');
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

      console.log('SUCCESS: Preference created:', result.id);
      res.json({ id: result.id, init_point: result.init_point });
    } catch (error: any) {
      console.error('FATAL CHECKOUT ERROR:', error);
      res.status(500).json({ 
        error: 'Erro no Mercado Pago',
        details: error.message || 'Erro interno desconhecido no servidor.'
      });
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
