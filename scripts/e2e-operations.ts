import { createWorkRouter } from '../src/server/workRouter.js';
import { workRequestContext } from '../src/server/workTracking.js';
import { mountE2EDocuments } from './e2e-documents.js';
import { createCatalogManagementRouter } from '../src/server/catalogManagement.js';
import { ALL_STAFF_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '../src/lib/staffAccess.js';
import express from 'express';
import { createOperationsRouter } from '../src/server/operationsRouter.js';
import { recordStaffActivity } from '../src/server/staffActivity.js';
import { memoryFirestore } from '../test/helpers/memoryFirestore.js';
import { OperationsError } from '../src/lib/operations.js';
import type { getAdminServices } from '../src/server/firebaseAdmin.js';
/** Mounted only by the localhost E2E runner; production imports no fixtures. */
export function mountE2EOperations(app: express.Express) {
  app.use(workRequestContext);
  const memory = memoryFirestore([['_adminAccess/e2e-user', { schemaVersion: 1, enabled: true, epoch: 'legacy' }]]);
  const services = { db: memory.db, auth: { getUsers: async () => ({ users: [{ uid: 'e2e-user', email: 'cliente@example.com', displayName: 'Cliente Teste', customClaims: { admin: true } }] }) } } as unknown as ReturnType<typeof getAdminServices>;
  app.use('/__e2e/catalog', (req, _res, next) => {
    const seed = req.body?.seed;
    if (seed) {
      for (const key of [...memory.docs.keys()]) if (/^(anuncios|categories|promocoes|config)\//.test(key)) memory.docs.delete(key);
      for (const [collection, rows] of [['anuncios', seed.products], ['categories', seed.categories], ['promocoes', seed.promotions]] as const) for (const row of rows || []) memory.docs.set(`${collection}/${row.id}`, row);
      memory.docs.set('config/main', seed.config);
    }
    next();
  }, createCatalogManagementRouter({ services: () => services, authorize: async req => {
    const role = String(req.get('x-e2e-role') || 'administrator'), admin = role === 'administrator';
    memory.docs.set('_staffProfiles/e2e-user', { name: admin ? 'Administrador Teste' : role === 'designer' ? 'Designer Teste' : 'Gestor Teste' });
    if (!admin) { memory.docs.set('_staffAccess/e2e-user', { schemaVersion: 1, enabled: true, epoch: 'a'.repeat(32), roleId: role }); memory.docs.set(`_staffRoles/${role}`, { schemaVersion: 1, enabled: true, revision: 'a'.repeat(32), name: role === 'designer' ? 'Designer' : 'Gestor de Produtos', permissions: DEFAULT_ROLE_PERMISSIONS[role] }); }
    return { uid: 'e2e-user', admin, permissions: admin ? ALL_STAFF_PERMISSIONS : DEFAULT_ROLE_PERMISSIONS[role] || [] };
  } }));
  app.post('/api/admin/activity/:kind', async (req, res) => { if (!['orders', 'artwork'].includes(req.params.kind)) { res.sendStatus(404); return; } await recordStaffActivity(memory.db, { uid: 'e2e-user', admin: true, name: 'Cliente Teste' }, req.params.kind === 'orders' ? 'orders.consulted' : 'artwork.exported', String(req.body.orderId || 'orders')); res.json({ recorded: true }); });
  app.use('/api/admin/operations', createOperationsRouter({ authorize: async req => { if (req.get('authorization') !== 'Bearer e2e-operations') throw new OperationsError('Acesso negado.', 403); return { uid: 'e2e-user', admin: true }; }, services: () => services }));
  app.use('/api/admin/work', createWorkRouter({ db: () => memory.db, authorize: async req => { if (req.get('authorization') !== 'Bearer e2e-work') throw new OperationsError('Acesso negado',403); return { uid:'e2e-user', admin:req.get('x-e2e-role')==='administrator',permissions:['operations.self','products.manage','categories.manage','promotions.manage','settings.manage','documents.generate'] }; } }));
  mountE2EDocuments(app,memory.db);

}
