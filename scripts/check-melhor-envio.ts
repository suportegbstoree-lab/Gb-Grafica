import { loadEnv } from 'vite';
import { melhorEnvioConfig, quoteMelhorEnvio } from '../src/server/melhorEnvio.js';
import { ShippingError } from '../src/server/shippingError.js';
import { shippingOptionLabel, validShippingParcel } from '../src/lib/shipping.js';

Object.assign(process.env, loadEnv('production', process.cwd(), ''));

const usage = `Usage: npm run shipping:check -- [options]

Checks local Melhor Envio configuration without printing credentials.
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
    const config = melhorEnvioConfig();
    console.log(`Configuração local do Melhor Envio válida. Ambiente: ${config.environment}.`);
    console.log(`Serviços: ${config.services.length ? config.services.join(', ') : 'serviços disponíveis na conta'}.`);
    if (quote) {
      const destination = values.get('--destination')?.replace(/\D/g, '') || '';
      const number = (flag: string) => {
        const value = values.get(flag) || '';
        return /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
      };
      const parcel = { weightGrams: number('--weight'), lengthCm: number('--length'), widthCm: number('--width'), heightCm: number('--height') };
      if (!/^\d{8}$/.test(destination) || !validShippingParcel(parcel)) throw new Error('Provide a valid destination and all packed parcel measurements. Use --help.');
      const options = await quoteMelhorEnvio(config, destination, [parcel]);
      for (const option of options) console.log(`${shippingOptionLabel(option)} (${option.service_code.slice(3)}): R$ ${(option.amount_cents / 100).toFixed(2)} · ${option.delivery_days} dia(s) útil(eis) após postagem.`);
      console.log('Consulta de cotação concluída.');
    } else {
      if (values.size) throw new Error('Use --quote with parcel options. Use --help.');
      console.log('Nenhuma API foi chamada. Use --quote com CEP e medidas para validar o acesso real.');
    }
  }
} catch (error) {
  console.error(error instanceof ShippingError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : 'Falha ao verificar o Melhor Envio.');
  process.exitCode = 1;
}
