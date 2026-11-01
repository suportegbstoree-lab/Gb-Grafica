import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createOperationsRouter } from './operationsRouter';
import { OperationsError, localToday } from '../lib/operations';
import { memoryFirestore } from '../../test/helpers/memoryFirestore';

test('retired manual production HTTP refuses writes and retains administrator read-only history', async () => {
  const memory = memoryFirestore([['_adminAccess/admin', { schemaVersion: 1, enabled: true, epoch: 'legacy' }], ['_staffProfiles/admin', { name: 'Ana Administradora' }]]);
  let serviceReads = 0; const zip = Buffer.from([80, 75, 3, 4, 1, 2, 3, 4]);
  const services = { db: memory.db, auth: { getUsers: async () => ({ users: [{ uid: 'admin', email: 'admin@example.test', customClaims: { admin: true } }] }) }, bucket: { file: () => ({ getMetadata: async () => [{ generation: '42', size: zip.length, metadata: { uploadedBy: 'admin' } }], async *createReadStream() { yield zip; }, getSignedUrl: async () => ['https://signed.example.test/release'] }) } } as any;
  const app = express(); app.use(express.json()); app.use('/ops', createOperationsRouter({ authorize: async req => { if (req.get('authorization') !== 'Bearer permitted') throw new OperationsError('Acesso negado.', 403); return { uid: 'admin', admin: true }; }, services: () => { serviceReads++; return services; } }));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address() as any;
  const call = (path: string, body?: unknown, permitted = true) => fetch(`http://127.0.0.1:${address.port}/ops${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(permitted ? { Authorization: 'Bearer permitted' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    assert.equal((await call('/production', undefined, false)).status, 403); assert.equal(serviceReads, 0);
    assert.equal((await call('/production?end=garbage')).status, 422);
    const id = '12345678-1234-4234-8234-123456789012';
    memory.docs.set(`_productionEntries/${id}`, { employeeId: 'admin', date: localToday(), service: 'Cadernos antigos', unit: 'pecas', completed: 5, rework: 1, loss: 0, reason: 'Reimpressão', notes: '', reference: 'pedido-antigo', version: 1 });
    assert.equal((await call('/production', { completed: 999 })).status, 410);
    assert.equal((await call(`/production/${id}`, { cancel: true })).status, 410);
    const detail = await (await call(`/production/${id}`)).json(); assert.equal(detail.record.completed, 5);
    const report = await (await call('/production')).json(); assert.equal(report.count, 1);
    assert.match(await (await call('/production?format=csv')).text(), /Cadernos antigos/);
    for (const path of ['/machines', '/releases', '/errors', '/orders']) assert.equal((await call(path)).status, 404);
    const activity = await (await call('/activity')).json(); assert.equal(activity.summary.total, 0);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
