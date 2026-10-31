import express from 'express';
import { createOperationsRouter } from '../src/server/operationsRouter.js';
import { memoryFirestore } from '../test/helpers/memoryFirestore.js';
import { OperationsError } from '../src/lib/operations.js';
import type { getAdminServices } from '../src/server/firebaseAdmin.js';
/** Mounted only by the localhost E2E runner; production imports no fixtures. */
export function mountE2EOperations(app: express.Express) {
  const memory = memoryFirestore([['_adminAccess/e2e-user', { schemaVersion: 1, enabled: true, epoch: 'legacy' }]]), uploads = new Map<string, Buffer>();
  const services = { db: memory.db, auth: { getUsers: async () => ({ users: [{ uid: 'e2e-user', email: 'cliente@example.com', displayName: 'Cliente Teste', customClaims: { admin: true } }] }) }, bucket: { file: (path: string) => ({ getMetadata: async () => [{ size: uploads.get(path)?.length || 0, generation: '1', metadata: { uploadedBy: 'e2e-user' } }], async *createReadStream() { yield uploads.get(path) || Buffer.alloc(0); }, getSignedUrl: async () => [`http://127.0.0.1:4173/__e2e/release-file?path=${encodeURIComponent(path)}`] }) } } as unknown as ReturnType<typeof getAdminServices>;
  app.use('/api/admin/operations', createOperationsRouter({ authorize: async req => { if (req.get('authorization') !== 'Bearer e2e-operations') throw new OperationsError('Acesso negado.', 403); return { uid: 'e2e-user' }; }, services: () => services }));
  app.post('/__e2e/releases', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => { const path = `operations/releases/${crypto.randomUUID()}/${crypto.randomUUID().replaceAll('-', '')}.zip`; uploads.set(path, req.body); res.json({ path }); });
  app.get('/__e2e/release-file', (req, res) => { const bytes = uploads.get(String(req.query.path)); if (!bytes) { res.sendStatus(404); return; } res.type('application/zip').send(bytes); });
}
