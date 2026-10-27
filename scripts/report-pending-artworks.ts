import dotenv from 'dotenv';
import { getAdminServices } from '../src/server/firebaseAdmin.js';
import { collectPendingArtworkInventory } from '../src/server/pendingArtworkInventory.js';

dotenv.config({ quiet: true });

const DEFAULT_SCAN_LIMIT = 50_000;
const MAX_SCAN_LIMIT = 200_000;

function scanLimit(args: string[]): number {
  if (args.length === 0) return DEFAULT_SCAN_LIMIT;
  if (args.length !== 1) throw new Error('Use --max-objects=N com um número entre 1 e 200000.');
  const match = /^--max-objects=(\d+)$/.exec(args[0]);
  const value = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SCAN_LIMIT) {
    throw new Error('Use --max-objects=N com um número entre 1 e 200000.');
  }
  return value;
}

function mebibytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Uso: npm run security:storage-report -- [--max-objects=N]');
    console.log('Lista até 50000 objetos por padrão; o teto configurável é 200000.');
    return;
  }
  const maxObjects = scanLimit(args);
  const { bucket } = getAdminServices();
  const result = await collectPendingArtworkInventory(async options => {
    const [files, nextQuery] = await bucket.getFiles({ ...options, autoPaginate: false });
    if (nextQuery != null && (typeof nextQuery.pageToken !== 'string' || !nextQuery.pageToken)) {
      throw new Error('A listagem retornou uma paginação inválida.');
    }
    return {
      objects: files.map(file => ({ name: file.name, metadata: file.metadata })),
      nextPageToken: nextQuery?.pageToken ?? null,
    };
  }, { maxObjects });

  console.log(`Relatório ${result.complete ? 'completo' : 'PARCIAL'} de artes pendentes`);
  console.log('Considera objetos ativos; versões não atuais, objetos em exclusão reversível e uploads incompletos ficam fora da listagem.');
  console.log(`Objetos examinados no prefixo artworks/: ${result.objectsScanned}`);
  console.log(`Artes pendentes: ${result.pendingObjects}; contas com pendências: ${result.owners}`);
  console.log(`Volume conhecido: ${mebibytes(result.knownBytes)}; tamanhos ausentes ou inválidos: ${result.unknownSizes}`);
  console.log(`Idade: <1 dia ${result.age.underDay}; 1–<7 dias ${result.age.underWeek}; 7–<30 dias ${result.age.underMonth}; ≥30 dias ${result.age.older}; desconhecida ${result.age.unknown}`);
  console.log(`Arquivos por conta: p50 ${result.objectsPerOwner.p50}; p90 ${result.objectsPerOwner.p90}; p99 ${result.objectsPerOwner.p99}; máximo ${result.objectsPerOwner.maximum}`);
  console.log(`Volume conhecido por conta: p50 ${mebibytes(result.bytesPerOwner.p50)}; p90 ${mebibytes(result.bytesPerOwner.p90)}; p99 ${mebibytes(result.bytesPerOwner.p99)}; máximo ${mebibytes(result.bytesPerOwner.maximum)}`);
  if (result.unknownSizes) console.log('Volumes conhecidos são valores mínimos porque alguns tamanhos não estavam disponíveis.');
  if (!result.complete) {
    console.log('O limite de leitura foi atingido; as estatísticas representam apenas a parte examinada.');
    process.exitCode = 2;
  }
}

main().catch(error => {
  const message = error instanceof Error && error.message.startsWith('Use --max-objects=')
    ? error.message
    : 'Não foi possível concluir a leitura. Confira a configuração e a permissão de listagem do bucket.';
  console.error(message);
  process.exitCode = 1;
});
