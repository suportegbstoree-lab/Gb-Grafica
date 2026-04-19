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
    try {
      const { items, orderId, baseUrl } = req.body;
      
      if (!process.env.MP_ACCESS_TOKEN) {
        return res.status(500).json({ error: 'Configuração Incompleta', details: 'MP_ACCESS_TOKEN não encontrado no servidor.' });
      }

      const effectiveBaseUrl = baseUrl || process.env.APP_URL || 'http://localhost:3000';
      console.log(`Processing checkout for order ${orderId}. Base URL: ${effectiveBaseUrl}`);

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Carrinho Vazio', details: 'Nenhum item enviado.' });
      }

      const preference = new Preference(client);
      
      const result = await preference.create({
        body: {
          items: items.map((item: any) => {
            // Clean price string: remove anything that's not a digit, dot or comma
            // Then replace comma with dot
            const cleanedPrice = (item.preco || "0").toString()
              .replace(/[^0-9,.]/g, '')
              .replace(',', '.');
            
            const unitPrice = parseFloat(cleanedPrice);

            if (isNaN(unitPrice) || unitPrice <= 0) {
              console.error(`Invalid price for item ${item.nome}: ${item.preco}`);
              throw new Error(`Preço inválido para o item ${item.nome}`);
            }

            return {
              id: item.id,
              title: item.nome,
              unit_price: unitPrice,
              quantity: parseInt(item.quantidade) || 1,
              currency_id: 'BRL'
            };
          }),
          external_reference: orderId,
          back_urls: {
            success: `${effectiveBaseUrl}/?status=success&orderId=${orderId}`,
            failure: `${effectiveBaseUrl}/?status=failure`,
            pending: `${effectiveBaseUrl}/?status=pending`,
          },
          auto_return: 'approved',
          // Set binary mode to true to receive success immediately after payment
          binary_mode: true,
        }
      });

      console.log('MP Preference created successfully:', result.id);
      res.json({ id: result.id, init_point: result.init_point });
    } catch (error: any) {
      console.error('Error creating MP preference:', error);
      res.status(500).json({ 
        error: 'Failed to create payment preference',
        details: error.message || 'Unknown error'
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
