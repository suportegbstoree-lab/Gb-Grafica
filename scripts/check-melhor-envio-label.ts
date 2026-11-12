import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { melhorEnvioConfig, quoteMelhorEnvio } from '../src/server/melhorEnvio.js';
import { shipmentCartBody, shipmentProvider } from '../src/server/melhorEnvioShipment.js';
import { ShippingError } from '../src/server/shippingError.js';

const [action, id, extra] = process.argv.slice(2);
const usage = 'npm run shipping:label:sandbox -- prepare | buy ID | emit ID | print ID';
try {
  if (!action || action === '--help') {
    console.log(usage);
  } else {
    if (extra || !['prepare', 'buy', 'emit', 'print'].includes(action) || (action === 'prepare' ? id : !id)) throw new Error(usage);
    Object.assign(process.env, loadEnv('sandbox', process.cwd(), ''));
    const config = melhorEnvioConfig();
    if (config.environment !== 'sandbox') throw new Error('Use MELHOR_ENVIO_ENV=sandbox e um token da conta de testes.');
    const provider = shipmentProvider(config);
    if (action === 'prepare') {
      const orderId = `GB-SANDBOX-${randomUUID().slice(0, 8)}`;
      const parcels = [{ weightGrams: 750, lengthCm: 25, widthCm: 20, heightCm: 15 }];
      const options = await quoteMelhorEnvio({ ...config, services: ['3'] }, '01001000', parcels);
      const option = options.find(item => item.service_code === 'me:3');
      if (!option) throw new Error('A Jadlog .Package não retornou uma cotação de teste para esta origem.');
      const order = {
        shipping: { ...option, origin_cep: config.originCep, destination_cep: '01001000', parcels },
        clienteNome: 'Destinatário de Teste', clienteEmail: 'teste@example.com', clienteTelefone: '11999999999',
        enderecoEntrega: { cep: '01001000', rua: 'Praça da Sé', numero: '1', bairro: 'Sé', cidade: 'São Paulo', estado: 'SP' },
        itens: [{ nome: 'Caderno de teste', preco: '20.00', quantidade: 1 }],
      };
      const result = await provider.create(shipmentCartBody(orderId, order, { recipientDocument: '52998224725' }, config, true));
      console.log(`Envio de teste criado. ID: ${result.id}`);
      if (result.amountCents !== null) console.log(`Custo fictício: R$ ${(result.amountCents / 100).toFixed(2)}`);
    } else {
      const details = await provider.details(id);
      if (details.unavailable) throw new Error('O envio de teste está indisponível.');
      if (action === 'buy') {
        if (!details.paid) {
          if (!details.pending) throw new Error('O envio de teste ainda não pode ser comprado.');
          await provider.checkout(id);
          console.log('Compra solicitada com o saldo fictício do sandbox. Aguarde a liberação antes de emitir.');
        } else console.log('O envio de teste já está pago.');
      } else if (action === 'emit') {
        if (!details.paid) throw new Error('O sandbox ainda não confirmou a compra da etiqueta.');
        if (!details.issued) {
          await provider.generate(id);
          console.log('Emissão solicitada. Aguarde antes de baixar o PDF.');
        } else console.log('A etiqueta de teste já está emitida.');
      } else {
        if (!details.issued) throw new Error('O sandbox ainda não concluiu a emissão.');
        const output = `etiqueta-sandbox-${id}.pdf`;
        await writeFile(output, await provider.pdf(id), { flag: 'wx', mode: 0o600 });
        console.log(`PDF de teste salvo em ${output}.`);
      }
    }
  }
} catch (error) {
  console.error(error instanceof ShippingError || error instanceof Error && !(error as NodeJS.ErrnoException).code
    ? error.message : 'Não foi possível concluir a etapa de teste.');
  process.exitCode = 1;
}
