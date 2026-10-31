import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createOperationsRouter } from './operationsRouter';
import { OperationsError, localToday } from '../lib/operations';
import { memoryFirestore } from '../../test/helpers/memoryFirestore';

test('operations HTTP denies access before reading data, validates production, and protects revisions and release ownership', async () => {
  const memory = memoryFirestore([['_adminAccess/admin', { schemaVersion: 1, enabled: true, epoch: 'legacy' }]]);
  let serviceReads = 0; const zip = Buffer.from([80, 75, 3, 4, 1, 2, 3, 4]);
  const services = { db: memory.db, auth: { getUsers: async () => ({ users: [{ uid: 'admin', email: 'admin@example.test', customClaims: { admin: true } }] }) }, bucket: { file: () => ({ getMetadata: async () => [{ generation: '42', size: zip.length, metadata: { uploadedBy: 'admin' } }], async *createReadStream() { yield zip; }, getSignedUrl: async () => ['https://signed.example.test/release'] }) } } as any;
  const app = express(); app.use(express.json()); app.use('/ops', createOperationsRouter({ authorize: async req => { if (req.get('authorization') !== 'Bearer permitted') throw new OperationsError('Acesso negado.', 403); return { uid: 'admin' }; }, services: () => { serviceReads++; return services; } }));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address() as any;
  const call = (path: string, body?: unknown, permitted = true) => fetch(`http://127.0.0.1:${address.port}/ops${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(permitted ? { Authorization: 'Bearer permitted' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    assert.equal((await call('/production', undefined, false)).status, 403); assert.equal(serviceReads, 0);
    assert.equal((await call('/production?end=garbage')).status, 422);
    const id = '12345678-1234-4234-8234-123456789012', entry = { employeeId: 'admin', date: localToday(), service: 'Cadernos', unit: 'pecas', completed: 5, rework: 1, loss: 0, reason: 'Reimpressão', notes: '', reference: '', requestId: id };
    assert.equal((await call('/production', { ...entry, employeeId: 'outsider' })).status, 422);
    assert.equal((await call('/production', entry)).status, 200);
    assert.equal((await call(`/production/${id}`, { ...entry, version: 0 })).status, 409);
    assert.equal((await call(`/production/${id}`, { ...entry, completed: 8, version: 1 })).status, 200);
    const detail = await (await call(`/production/${id}`)).json(); assert.equal(detail.history.length, 2);
    assert.equal((await call(`/production/${id}`, { cancel: true, reason: '', version: 2 })).status, 422);
    assert.equal((await call(`/production/${id}`, { cancel: true, reason: 'Duplicado', version: 2 })).status, 200);
    const report = await (await call('/production')).json(); assert.equal(report.count, 0); assert.equal(report.totals[0].completed, 0);
    const csv = await (await call('/production?cancelled=true&format=csv')).text(); assert.ok(csv.includes('Duplicado') || csv.includes('Cadernos'));
    const machine = { name: 'Estação', machineId: 'machine-a', installedVersion: '1.0', authorized: true, version: 0 };
    assert.equal((await call(`/machines/${id}`, machine)).status, 200);
    assert.equal((await call('/machines/22345678-1234-4234-8234-123456789012', machine)).status, 409);
    const release = { version: '1.0.0', path: `operations/releases/${id}/${'a'.repeat(32)}.zip`, description: 'Versão de teste', mandatory: false };
    const saved = await call('/releases', release); assert.equal(saved.status, 200); assert.equal((await saved.json()).sha256, createHash('sha256').update(zip).digest('hex'));
    assert.equal((await call('/releases', { ...release, description: 'Modified' })).status, 409);
    assert.equal((await call('/releases', { ...release, version: '2', path: 'other/private.zip' })).status, 422);
    assert.equal((await call('/orders')).status, 404);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
