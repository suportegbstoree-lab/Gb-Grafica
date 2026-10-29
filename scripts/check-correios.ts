import { loadEnv } from 'vite';
import { CorreiosClient, CorreiosError, correiosConfig } from '../src/server/correios.js';
import { validShippingParcel } from '../src/lib/shipping.js';

Object.assign(process.env, loadEnv('production', process.cwd(), ''));

const usage = `Usage: npm run shipping:check -- [options]

Checks local Correios configuration without printing credentials.
  --quote             Request a real price/deadline quote (no label or postage purchase).
  --destination CEP   Destination postal code (8 digits).
  --weight GRAMS      Total packed parcel weight, integer grams.
  --length CM         External parcel length in centimetres.
  --width CM          External parcel width in centimetres.
  --height CM         External parcel height in centimetres.
  --help, -h          Show this help.

Example: npm run shipping:check -- --quote --destination 01001000 --weight 750 --length 25 --width 20 --height 15`;

try {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
  } else {
    const values = new Map<string, string>();
    let quote = false;
    for (let i = 0; i < args.length; i += 1) {
      const flag = args[i];
      if (flag === '--quote' && !quote) { quote = true; continue; }
      if (!['--destination', '--weight', '--length', '--width', '--height'].includes(flag)
        || values.has(flag) || !args[i + 1] || args[i + 1].startsWith('-')) throw new Error('Invalid or duplicate option. Use --help.');
      values.set(flag, args[++i]);
    }
    const config = correiosConfig();
    console.log(`Configuração local dos Correios: válida. Ambiente: ${config.environment}.`);
    console.log(`Autenticação: ${config.token ? 'token temporário; exige substituição ao expirar' : 'credenciais CWS; renovação automática'}.`);
    console.log(`Serviços configurados: ${config.services.map(service => `${service.name} (${service.code})`).join(', ')}.`);
    if (quote) {
      const destination = values.get('--destination')?.replace(/\D/g, '') || '';
      const number = (flag: string) => {
        const value = values.get(flag) || '';
        return /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
      };
      const parcel = { weightGrams: number('--weight'), lengthCm: number('--length'), widthCm: number('--width'), heightCm: number('--height') };
      if (!/^\d{8}$/.test(destination) || !validShippingParcel(parcel)) throw new Error('Provide a valid destination and all packed parcel measurements. Use --help.');
      const options = await new CorreiosClient(config).quote(destination, [parcel]);
      for (const option of options) console.log(`${option.service_name}: R$ ${(option.amount_cents / 100).toFixed(2)}; ${option.delivery_days} dia(s) útil(eis) após postagem; entrega domiciliar: ${option.home_delivery ? 'sim' : 'não'}.`);
      console.log('Cotação real concluída. Nenhuma etiqueta, postagem, pedido ou pagamento foi criado.');
    } else {
      if (values.size) throw new Error('Use --quote with parcel options. Use --help.');
      console.log('Nenhuma API foi chamada. Use --quote com CEP e medidas para validar o acesso real.');
    }
  }
} catch (error) {
  console.error(error instanceof CorreiosError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : 'Falha ao verificar os Correios.');
  process.exitCode = 1;
}
