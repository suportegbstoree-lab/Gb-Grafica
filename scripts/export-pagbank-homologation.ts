import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { getAdminServices } from '../src/server/firebaseAdmin.js';
import {
  formatPagBankHomologationReport,
  PAGBANK_HOMOLOGATION_COLLECTION,
} from '../src/server/pagbankHomologation.js';

dotenv.config();

interface Arguments {
  orderIds: string[];
  output?: string;
  environment: 'sandbox' | 'production';
}

function parseArguments(argv: string[]): Arguments {
  const orderIds: string[] = [];
  let output: string | undefined;
  let environment: Arguments['environment'] = 'sandbox';

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--environment') {
      const value = argv[index + 1];
      if (value !== 'sandbox' && value !== 'production') throw new Error('Use --environment sandbox ou production.');
      environment = value;
      index += 1;
      continue;
    }
    if (argument === '--order') {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error('Informe o pedido depois de --order.');
      orderIds.push(value);
      index += 1;
      continue;
    }
    if (argument === '--orders') {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error('Informe os pedidos depois de --orders.');
      orderIds.push(...value.split(',').map(item => item.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (argument === '--output') {
      output = argv[index + 1]?.trim();
      if (!output) throw new Error('Informe o caminho depois de --output.');
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Argumento desconhecido: ${argument}`);
  }

  const uniqueOrderIds = [...new Set(orderIds)];
  if (!uniqueOrderIds.length) {
    throw new Error('Informe ao menos um pedido com --order.');
  }
  for (const orderId of uniqueOrderIds) {
    if (!/^GB-[A-Z0-9]{8,64}$/.test(orderId)) throw new Error(`Pedido inválido: ${orderId}`);
  }
  return { orderIds: uniqueOrderIds, output, environment };
}

function printUsage(): void {
  console.log([
    'Uso:',
    '  npm run pagbank:homologation:export -- --order GB-AAAA --order GB-BBBB',
    '  npm run pagbank:homologation:export -- --orders GB-AAAA,GB-BBBB --output anexo.txt',
    '  npm run pagbank:homologation:export -- --environment production --order GB-AAAA',
  ].join('\n'));
}

function defaultOutputName(environment: Arguments['environment']): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `pagbank-homologacao-${environment}-${timestamp}.txt`;
}

async function main(): Promise<void> {
  const { orderIds, output, environment } = parseArguments(process.argv.slice(2));
  const { db } = getAdminServices();
  const captures = [];

  for (const orderId of orderIds) {
    const snapshot = await db.collection(PAGBANK_HOMOLOGATION_COLLECTION).doc(orderId).get();
    if (!snapshot.exists) {
      throw new Error(
        `Não há evidência para ${orderId}. Confirme a configuração de captura do ambiente ${environment} e gere um checkout novo.`,
      );
    }
    captures.push(snapshot.data());
  }

  const report = formatPagBankHomologationReport(captures, new Date().toISOString(), environment);
  const outputPath = path.resolve(process.cwd(), output || defaultOutputName(environment));
  await writeFile(outputPath, report, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  console.log(`Anexo criado em ${outputPath}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
