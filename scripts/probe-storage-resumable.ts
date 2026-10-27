import dotenv from 'dotenv';
import { getStorage } from 'firebase-admin/storage';
import firebaseConfig from '../firebase-applet-config.json';
import { getAdminServices } from '../src/server/firebaseAdmin.js';
import { probeStorageResumable, storageProbePath } from '../src/server/storageResumableProbe.js';

dotenv.config({ quiet: true });

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    console.log('Teste de Cloud Storage: cria um objeto temporário de aproximadamente 256 KiB, verifica e tenta removê-lo.');
    console.log('Não altera regras nem CORS. Pode gerar custos de operação e retenção temporária.');
    console.log('Para executar: node --import tsx scripts/probe-storage-resumable.ts --execute');
    return;
  }
  if (args.length !== 1 || args[0] !== '--execute') throw new Error('Argumentos inválidos.');
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET?.trim() || firebaseConfig.storageBucket?.trim();
  if (!bucketName) throw new Error('Bucket não configurado.');
  const { app } = getAdminServices();
  const bucket = getStorage(app).bucket(bucketName);
  const path = storageProbePath();
  console.log(`Caminho temporário do teste: ${path}`);
  const result = await probeStorageResumable(bucket, path);
  console.log(`Etapa alcançada: ${result.phase}`);
  console.log(`Objeto temporário: ${result.cleanup === 'removed' ? 'removido' : result.cleanup === 'absent' ? 'não encontrado' : 'limpeza não confirmada'}`);
  if (result.sessionCancellation !== 'not_needed') {
    console.log(`Cancelamento de sessão incompleta: ${result.sessionCancellation === 'confirmed' ? 'confirmado' : 'não confirmado'}`);
  }
  console.log(`Teste: ${result.ok ? 'aprovado' : 'não concluído'}`);
  if (!result.ok) process.exitCode = 1;
}

main().catch(() => {
  console.error('Não foi possível iniciar o teste. Confira os argumentos e a configuração do Firebase Admin.');
  process.exitCode = 1;
});
