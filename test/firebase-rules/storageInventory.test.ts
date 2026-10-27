import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { collectPendingArtworkInventory } from '../../src/server/pendingArtworkInventory.js';

test('relatório lê artes pendentes no emulador sem alterar objetos', async () => {
  const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  assert.ok(emulatorHost && /^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost), 'Use somente o emulador local de Storage.');
  const previousHost = process.env.STORAGE_EMULATOR_HOST;
  process.env.STORAGE_EMULATOR_HOST = `http://${emulatorHost}`;
  const id = randomUUID();
  const app = initializeApp({ projectId: 'demo-gb-grafica-rules', storageBucket: `inventory-${id}.appspot.com` }, `inventory-${id}`);
  const bucket = getStorage(app).bucket();
  const names = [
    'artworks/inventory-alice/pending/first.pdf',
    'artworks/inventory-bob/pending/second.png',
    'artworks/inventory-alice/orders/order/item/final.pdf',
  ];

  try {
    await Promise.all(names.map((name, index) => bucket.file(name).save(Buffer.alloc(index + 1, 1))));
    const report = await collectPendingArtworkInventory(async options => {
      const [files, nextQuery] = await bucket.getFiles({ ...options, autoPaginate: false });
      return { objects: files.map(file => ({ name: file.name, metadata: file.metadata })), nextPageToken: nextQuery?.pageToken ?? null };
    }, { maxObjects: 10, pageSize: 1 });

    assert.equal(report.complete, true);
    assert.equal(report.objectsScanned, 3);
    assert.equal(report.pendingObjects, 2);
    assert.equal(report.owners, 2);
    assert.equal(report.knownBytes, 3);
    assert.equal(report.unknownSizes, 0);
    const [remaining] = await bucket.getFiles({ prefix: 'artworks/' });
    assert.deepEqual(remaining.map(file => file.name).sort(), [...names].sort());
    assert.doesNotMatch(JSON.stringify(report), /inventory-alice|inventory-bob|first\.pdf/);

    // A credencial é gerada somente para o emulador; nenhum serviço real é acessado.
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const fakeAccount = JSON.stringify({
      project_id: 'demo-gb-grafica-rules',
      client_email: 'fake@demo-gb-grafica-rules.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    const runCli = (maxObjects: number) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/report-pending-artworks.ts', `--max-objects=${maxObjects}`], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          FIREBASE_SERVICE_ACCOUNT_JSON: fakeAccount,
          FIREBASE_STORAGE_BUCKET: bucket.name,
          FIREBASE_STORAGE_EMULATOR_HOST: emulatorHost,
          STORAGE_EMULATOR_HOST: `http://${emulatorHost}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', data => { output += String(data); });
      child.stderr.on('data', data => { output += String(data); });
      child.once('error', reject);
      child.once('close', code => resolve({ code, output }));
    });
    const complete = await runCli(10);
    assert.equal(complete.code, 0);
    assert.match(complete.output, /Relatório completo/);
    assert.match(complete.output, /Artes pendentes: 2; contas com pendências: 2/);
    assert.doesNotMatch(complete.output, /inventory-alice|inventory-bob|first\.pdf/);
    const partial = await runCli(1);
    assert.equal(partial.code, 2);
    assert.match(partial.output, /Relatório PARCIAL/);
    const [afterCli] = await bucket.getFiles({ prefix: 'artworks/' });
    assert.deepEqual(afterCli.map(file => file.name).sort(), [...names].sort());
  } finally {
    await Promise.allSettled(names.map(name => bucket.file(name).delete({ ignoreNotFound: true })));
    await deleteApp(app);
    if (previousHost === undefined) delete process.env.STORAGE_EMULATOR_HOST;
    else process.env.STORAGE_EMULATOR_HOST = previousHost;
  }
});
