import dotenv from 'dotenv';
import firebaseConfig from '../firebase-applet-config.json';
import { checkUploadCors, parsePreflightOrigin } from '../src/server/uploadCorsPreflight.js';

dotenv.config({ quiet: true });

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Uso: node --import tsx scripts/check-upload-cors.ts --origin=https://seu-dominio.com');
    return;
  }
  if (args.length !== 1 || !args[0].startsWith('--origin=')) {
    throw new Error('Informe --origin=https://seu-dominio.com (sem caminho).');
  }
  const origin = parsePreflightOrigin(args[0].slice('--origin='.length));
  const bucket = process.env.FIREBASE_STORAGE_BUCKET?.trim() || firebaseConfig.storageBucket?.trim() || '';
  const result = await checkUploadCors(bucket, origin);
  console.log('Teste somente de leitura: nenhuma alteração ou upload foi realizado.');
  console.log(`Resposta HTTP bem-sucedida: ${result.httpOk ? 'sim' : 'não'}`);
  console.log(`Origem autorizada: ${result.originAllowed ? 'sim' : 'não'}`);
  console.log(`Método PUT autorizado: ${result.methodAllowed ? 'sim' : 'não'}`);
  console.log(`Cabeçalhos do protótipo: ${result.missingHeaders.length ? 'não confirmados' : 'autorizados'}`);
  if (result.missingHeaders.length) console.log(`Cabeçalhos não confirmados: ${result.missingHeaders.join(', ')}`);
  console.log('Um resultado positivo não testa assinatura, envio, cotas nem o CORS atual do Firebase SDK.');
  if (!result.httpOk || !result.originAllowed || !result.methodAllowed || result.missingHeaders.length) {
    process.exitCode = 2;
  }
}

main().catch(error => {
  const message = error instanceof Error && (
    error.message.startsWith('Informe ') || error.message === 'Origem inválida.' ||
    error.message === 'Nome de bucket inválido.'
  ) ? error.message : 'Não foi possível concluir o teste OPTIONS. Confira conexão e configuração do bucket.';
  console.error(message);
  process.exitCode = 1;
});
