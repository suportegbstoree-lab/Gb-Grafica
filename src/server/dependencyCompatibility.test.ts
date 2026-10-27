import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, doc, getDocFromServer, getFirestore, terminate } from 'firebase/firestore';

const rootRequire = createRequire(import.meta.url);
const adminRequire = createRequire(rootRequire.resolve('firebase-admin'));

test('Storage: a dependência HTTP cria uma requisição multipart utilizável', async () => {
  const storageRequire = createRequire(adminRequire.resolve('@google-cloud/storage'));
  const { request } = storageRequire('gaxios') as { request: (options: unknown) => Promise<unknown> };
  let receivedBody = '';
  let receivedContentType = '';
  const server = createServer((req, res) => {
    receivedContentType = req.headers['content-type'] || '';
    req.setEncoding('utf8');
    req.on('data', chunk => { receivedBody += chunk; });
    req.on('end', () => { res.writeHead(200); res.end('ok'); });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await request({
      url: `http://127.0.0.1:${address.port}/upload`,
      method: 'POST',
      noProxy: ['127.0.0.1'],
      multipart: [
        { headers: { 'Content-Type': 'application/json' }, content: '{"name":"teste"}' },
        { headers: { 'Content-Type': 'text/plain' }, content: 'arquivo-teste' },
      ],
    });
    const boundary = receivedContentType.match(/^multipart\/related; boundary=(.+)$/)?.[1];
    assert.match(boundary || '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.match(receivedBody, /\{"name":"teste"\}/);
    assert.match(receivedBody, /arquivo-teste/);
    assert.ok(receivedBody.includes(`--${boundary}--`));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('Firestore: o cliente lê um documento através de gRPC local', { timeout: 10_000 }, async () => {
  const firebaseRequire = createRequire(rootRequire.resolve('firebase/firestore'));
  const firestoreRequire = createRequire(firebaseRequire.resolve('@firebase/firestore'));
  const grpc = firestoreRequire('@grpc/grpc-js');
  const loader = firestoreRequire('@grpc/proto-loader');
  const protoRoot = path.join(path.dirname(adminRequire.resolve('@google-cloud/firestore/package.json')), 'build/protos');
  const definition = loader.loadSync(path.join(protoRoot, 'google/firestore/v1/firestore.proto'), {
    includeDirs: [protoRoot], longs: String, enums: String, defaults: true, oneofs: true,
  });
  const service = (grpc.loadPackageDefinition(definition) as any).google.firestore.v1.Firestore.service;
  const server = new grpc.Server();
  let documentName = '';
  server.addService(service, {
    listen(call: any) {
      call.on('data', (message: any) => {
        if (!message.addTarget) return;
        documentName = message.addTarget.documents.documents[0];
        const targetId = message.addTarget.targetId;
        const timestamp = { seconds: 1_720_000_000, nanos: 0 };
        call.write({ targetChange: { targetChangeType: 'ADD', targetIds: [targetId] } });
        call.write({ documentChange: {
          document: { name: documentName, fields: { result: { stringValue: 'ok' } }, createTime: timestamp, updateTime: timestamp },
          targetIds: [targetId],
        } });
        call.write({ targetChange: { targetChangeType: 'CURRENT', targetIds: [targetId] } });
        call.write({ targetChange: { targetChangeType: 'NO_CHANGE', readTime: timestamp } });
      });
    },
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, boundPort) => error ? reject(error) : resolve(boundPort));
  });
  const app = initializeApp({ projectId: 'demo-dependency-test' }, 'dependency-compatibility-test');
  const db = getFirestore(app);
  try {
    connectFirestoreEmulator(db, '127.0.0.1', port);
    const snapshot = await getDocFromServer(doc(db, 'checks/one'));
    assert.equal(documentName, 'projects/demo-dependency-test/databases/(default)/documents/checks/one');
    assert.equal(snapshot.exists(), true);
    assert.deepEqual(snapshot.data(), { result: 'ok' });
  } finally {
    await terminate(db);
    await deleteApp(app);
    server.forceShutdown();
  }
});
