import assert from 'node:assert/strict';
import test, { before, beforeEach, after, mock } from 'node:test';
import { createServer, type Server } from 'node:http';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken, type UserRecord } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import app from './app';
import { DEFAULT_ROLE_PERMISSIONS } from '../lib/staffAccess';

const env = { NODE_ENV: 'production', APP_URL: 'https://loja.example.test', LOG_LEVEL: 'silent', FIREBASE_APP_CHECK_MODE: 'off', FIREBASE_FIRESTORE_DATABASE_ID: '(default)', FIREBASE_STORAGE_BUCKET: 'demo-staff.firebasestorage.app', RESEND_API_KEY: '', STAFF_EMAIL_FROM: '' };
const old = new Map(Object.keys(env).map(key => [key, process.env[key]]));
const request = globalThis.fetch;
const docs = new Map<string, Record<string, unknown>>(), accounts = new Map<string, { uid: string; email: string; disabled: boolean; customClaims: Record<string, unknown> }>();
const tokens = new Map<string, Record<string, unknown>>();
let firebase: App, server: Server, origin = '', count = 0, actor = '', employee = '';
let transactionTail = Promise.resolve<unknown>(undefined);
function reference(path: string) {
  return { path, id: path.split('/').at(-1)!, async get() { const data = docs.get(path); return { exists: Boolean(data), data: () => data }; },
    async set(value: Record<string, unknown>, options?: { merge?: boolean }) { docs.set(path, options?.merge ? { ...docs.get(path), ...value } : { ...value }); },
    async create(value: Record<string, unknown>) { if (docs.has(path)) throw new Error('exists'); docs.set(path, { ...value }); },
    async delete() { docs.delete(path); },
  };
}
type Ref = ReturnType<typeof reference>;
const transaction = {
  get: (ref: Ref) => ref.get(), set(ref: Ref, data: Record<string, unknown>) { docs.set(ref.path, data); },
  update(ref: Ref, data: Record<string, unknown>) { docs.set(ref.path, { ...docs.get(ref.path), ...data }); }, delete(ref: Ref) { docs.delete(ref.path); },
};
function collection(name: string) {
  let limit = 1000, statusFilter: unknown = undefined;
  const query = { doc: (id: string) => reference(`${name}/${id}`), limit(value: number) { limit = value; return query; }, where(_field: string, _operator: string, value: unknown) { statusFilter = value; return query; },
    async get() { const entries = [...docs].filter(([path]) => path.startsWith(`${name}/`) && path.split('/').length === 2 && (statusFilter === undefined || docs.get(path)?.status === statusFilter)).slice(0, limit); return { size: entries.length, docs: entries.map(([path, data]) => ({ id: path.split('/')[1], data: () => data })) }; },
  };
  return query;
}
before(async () => {
  Object.assign(process.env, env); firebase = initializeApp({ projectId: 'demo-staff' }, 'staff-http');
  const auth = getAuth(firebase), db = getFirestore(firebase);
  mock.method(auth, 'verifyIdToken', async (token: string, revoked?: boolean) => { assert.equal(revoked, true); const claims = tokens.get(token); if (!claims) throw Object.assign(new Error('bad token'), { code: 'auth/invalid-id-token' }); return claims as DecodedIdToken; });
  mock.method(auth, 'getUser', async (uid: string) => { const value = accounts.get(uid); if (!value) throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' }); return structuredClone(value) as unknown as UserRecord; });
  mock.method(auth, 'getUserByEmail', async (email: string) => { const value = [...accounts.values()].find(account => account.email === email); if (!value) throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' }); return structuredClone(value) as unknown as UserRecord; });
  mock.method(auth, 'getUsers', async (ids: Array<{ uid: string }>) => { assert.ok(ids.length <= 100); return { users: ids.map(id => accounts.get(id.uid)).filter(Boolean) as unknown as UserRecord[], notFound: [] }; });
  mock.method(auth, 'setCustomUserClaims', async (uid: string, claims: Record<string, unknown>) => { accounts.get(uid)!.customClaims = { ...claims }; });
  mock.method(auth, 'revokeRefreshTokens', async () => {});
  mock.method(db, 'collection', collection as unknown as typeof db.collection);
  mock.method(db, 'runTransaction', ((fn: (tx: typeof transaction) => Promise<unknown>) => {
    const next = transactionTail.then(() => fn(transaction)); transactionTail = next.catch(() => undefined); return next;
  }) as unknown as typeof db.runTransaction);
  mock.method(getStorage(firebase), 'bucket', (() => ({ file: () => ({ exists: async () => [true], getSignedUrl: async () => ['https://storage.example.test/model.png'] }) })) as unknown as ReturnType<typeof getStorage>['bucket']);
  server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address'); origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  count++; actor = `administrator${count}`; employee = `employee${count}`; docs.clear(); accounts.clear(); tokens.clear();
  accounts.set(actor, { uid: actor, email: `${actor}@example.test`, disabled: false, customClaims: { admin: true } });
  accounts.set(employee, { uid: employee, email: `${employee}@example.test`, disabled: false, customClaims: { unrelated: 'preserved' } });
  tokens.set('admin', { uid: actor, admin: true }); tokens.set('buyer', { uid: employee });
  docs.set(`_adminAccess/${actor}`, { schemaVersion: 1, enabled: true, epoch: 'legacy' });
  docs.set(`users/${actor}`, { uid: actor, email: `${actor}@example.test`, role: 'admin' });
  docs.set(`users/${employee}`, { uid: employee, email: `${employee}@example.test`, role: 'user' });
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); mock.restoreAll(); await deleteApp(firebase);
  for (const [key, value] of old) value === undefined ? delete process.env[key] : process.env[key] = value;
});
async function call(path: string, token = 'admin', body?: unknown) { return request(`${origin}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
async function assign(role = 'designer') { return call('/admin/staff/assign', 'admin', { email: `${employee}@example.test`, role }); }

test('only full administrators can enumerate or assign staff access', async () => {
  assert.equal((await call('/admin/staff', 'buyer')).status, 403);
  assert.equal((await call('/admin/staff/assign', 'buyer', { email: `${employee}@example.test`, role: 'administrator' })).status, 403);
  assert.equal(docs.has(`_staffAccess/${employee}`), false);
  assert.equal((await call('/admin/staff', 'bad')).status, 401);
});
test('assignment resolves a registered email, persists staff authorization and truthfully queues the email', async () => {
  const response = await assign(); assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const data = await response.json() as { notification: { status: string } }; assert.equal(data.notification.status, 'not_configured');
  assert.equal(accounts.get(employee)!.customClaims.unrelated, 'preserved');
  assert.equal(accounts.get(employee)!.customClaims.admin, false);
  assert.equal(docs.get(`_staffAccess/${employee}`)?.enabled, true);
  assert.equal(docs.get(`_adminAccess/${employee}`)?.enabled, false);
  assert.ok([...docs.keys()].some(path => path.startsWith('_staffNotifications/')));
  const overview = await call('/admin/staff'); assert.equal(overview.status, 200);
  const payload = await overview.json() as { members: Array<{ uid: string; role: string }> };
  assert.ok(payload.members.some(member => member.uid === employee && member.role === 'designer'));
});
test('unknown emails and arbitrary role identifiers cannot create accounts or permissions', async () => {
  assert.equal((await call('/admin/staff/assign', 'admin', { email: 'missing@example.test', role: 'designer' })).status, 404);
  // Avoid rate throttling a second mutation by using another full administrator.
  const second = `${actor}-second`; accounts.set(second, { ...accounts.get(actor)!, uid: second }); tokens.set('second', { uid: second, admin: true }); docs.set(`_adminAccess/${second}`, { schemaVersion: 1, enabled: true, epoch: 'legacy' });
  assert.equal((await call('/admin/staff/assign', 'second', { email: `${employee}@example.test`, role: 'owner' })).status, 422);
  assert.equal(accounts.size, 3); assert.equal(docs.has(`_staffAccess/${employee}`), false);
});
test('an administrator cannot remove their own function through the management endpoint', async () => {
  const response = await call('/admin/staff/assign', 'admin', { email: `${actor}@example.test`, role: 'none' });
  assert.equal(response.status, 403); assert.equal(accounts.get(actor)!.customClaims.admin, true);
});
test('another administrator also cannot demote an existing administrator', async () => {
  const second = `${actor}-protected-peer`;
  accounts.set(second, { ...accounts.get(actor)!, uid: second });
  tokens.set('protected-peer', { uid: second, admin: true });
  docs.set(`_adminAccess/${second}`, { schemaVersion: 1, enabled: true, epoch: 'legacy' });
  for (const role of ['none', 'designer', 'product-manager']) {
    const response = await call('/admin/staff/assign', 'protected-peer', { email: `${actor}@example.test`, role });
    assert.equal(response.status, 403);
    assert.equal(accounts.get(actor)!.customClaims.admin, true);
    assert.equal(docs.get(`_adminAccess/${actor}`)?.enabled, true);
    assert.equal(docs.has(`_staffAccess/${actor}`), false);
  }
});
test('a customer cannot obtain original order artwork even when the order is theirs', async () => {
  docs.set('orders/GB-PRIVATEPDF', { userId: employee, itens: [{ id: 'item', arquivoPath: `artworks/${employee}/orders/GB-PRIVATEPDF/item/${'a'.repeat(32)}.pdf` }] });
  assert.equal((await call('/orders/GB-PRIVATEPDF/artwork/item', 'buyer')).status, 403);
  assert.equal((await call('/admin/orders/GB-PRIVATEPDF/back-pdf/item', 'buyer')).status, 403);
  assert.equal((await call('/admin/operations/production', 'buyer')).status, 403);
});
test('a designer can access order artwork but cannot use admin endpoints or production transitions', async () => {
  const response = await assign(); assert.equal(response.status, 200);
  tokens.set('designer', { uid: employee, ...accounts.get(employee)!.customClaims });
  const order = `GB-ORDER${count}`, item = 'item'; docs.set(`orders/${order}`, { userId: 'customer', itens: [{ id: item, modeloPath: `artworks/customer/orders/${order}/item/${'a'.repeat(32)}.png` }] });
  assert.equal((await call(`/orders/${order}/model/${item}`, 'designer')).status, 200);
  assert.equal((await call('/admin/staff', 'designer')).status, 403);
  assert.equal((await call(`/admin/orders/${order}/fulfillment`, 'designer', { fulfillmentStatus: 'em_producao' })).status, 403);
  assert.equal((await call(`/admin/orders/${order}/production-label`, 'designer', { requestId: '1'.repeat(32) })).status, 403);
  assert.equal((await call(`/admin/orders/${order}/tracking/refresh`, 'designer', {})).status, 403);
  assert.equal((await call('/admin/ai/suggestions', 'designer', { action: 'generate', title: 'Arte' })).status, 403);
});
test('permission edits revoke artwork access for an already issued staff token', async () => {
  assert.equal((await assign()).status, 200); tokens.set('designer', { uid: employee, ...accounts.get(employee)!.customClaims });
  const before = docs.get('_staffRoles/designer')!;
  const response = await call('/admin/staff/roles/designer', 'admin', { permissions: ['products.images'], expectedRevision: before.revision });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const order = `GB-ORDER${count}`, item = 'item'; docs.set(`orders/${order}`, { userId: 'customer', itens: [{ id: item, modeloPath: `artworks/customer/orders/${order}/item/${'a'.repeat(32)}.png` }] });
  assert.equal((await call(`/orders/${order}/model/${item}`, 'designer')).status, 403);
});
test('revoking through the existing admin CLI backend also closes staff authorization', async () => {
  assert.equal((await assign()).status, 200);
  const stale = { uid: employee, ...accounts.get(employee)!.customClaims }; tokens.set('stale', stale);
  // The public endpoint deliberately uses the same revokeAdminAccess backend as admin:set --revoke.
  const second = `${actor}-second`; accounts.set(second, { ...accounts.get(actor)!, uid: second }); tokens.set('second', { uid: second, admin: true }); docs.set(`_adminAccess/${second}`, { schemaVersion: 1, enabled: true, epoch: 'legacy' });
  const result = await call('/admin/staff/assign', 'second', { email: `${employee}@example.test`, role: 'none' });
  assert.equal(result.status, 200); assert.equal(docs.get(`_staffAccess/${employee}`)?.enabled, false);
  assert.equal(accounts.get(employee)!.customClaims.gbStaffEpoch, undefined);
});
test('role updates reject stale versions and unsupported full administrator policies', async () => {
  assert.equal((await call('/admin/staff/roles/administrator', 'admin', { permissions: [], expectedRevision: null })).status, 422);
  assert.equal((await call('/admin/staff/roles/designer', 'admin', { permissions: DEFAULT_ROLE_PERMISSIONS.designer, expectedRevision: 'wrong' })).status, 409);
});

test('product management permission cannot open another customer artwork or call order operations', async () => {
  assert.equal((await assign('product-manager')).status, 200); tokens.set('manager', { uid: employee, ...accounts.get(employee)!.customClaims });
  const order = `GB-MANAGER${count}`, item = 'item'; docs.set(`orders/${order}`, { userId: 'customer', itens: [{ id: item, modeloPath: `artworks/customer/orders/${order}/item/${'a'.repeat(32)}.png` }] });
  assert.equal((await call(`/orders/${order}/model/${item}`, 'manager')).status, 403);
  assert.equal((await call(`/admin/orders/${order}/fulfillment`, 'manager', { fulfillmentStatus: 'em_producao' })).status, 403);
  assert.equal((await call(`/admin/orders/${order}/production-label`, 'manager', { requestId: '1'.repeat(32) })).status, 403);
});

test('administrators create named custom roles, assign a name, and employees only reach their permitted modules', async () => {
  const id = 'custom-production';
  const created = await call(`/admin/staff/roles/${id}`, 'admin', { name: 'Coordenação', permissions: ['operations.manage'], expectedRevision: null });
  assert.equal(created.status, 200, JSON.stringify(await created.clone().json()));
  const assigned = await call('/admin/staff/assign', 'admin', { email: `${employee}@example.test`, name: 'Ana de Teste', role: id });
  assert.equal(assigned.status, 200, JSON.stringify(await assigned.clone().json()));
  assert.equal(docs.get(`_staffProfiles/${employee}`)?.name, 'Ana de Teste');
  assert.equal(accounts.get(employee)!.customClaims.admin, false);
  tokens.set('custom', { uid: employee, ...accounts.get(employee)!.customClaims });
  assert.equal((await call('/admin/operations/people', 'custom')).status, 200);
  assert.equal((await call('/admin/staff', 'custom')).status, 403);
  assert.equal((await call('/admin/activity/orders', 'custom', {})).status, 403);
  const overview = await (await call('/admin/staff')).json();
  assert.equal(overview.members.find((member: any) => member.uid === employee).name, 'Ana de Teste');
  assert.equal(overview.roles.find((role: any) => role.id === id).name, 'Coordenação');
});

test('custom roles cannot alter administrator authority and permission edits immediately revoke operational access', async () => {
  const id = 'custom-reports';
  const created = await call(`/admin/staff/roles/${id}`, 'admin', { name: 'Relatórios', permissions: ['operations.manage'], expectedRevision: null });
  const policy = await created.json(); assert.equal(created.status, 200);
  assert.equal((await assign(id)).status, 200); tokens.set('custom', { uid: employee, ...accounts.get(employee)!.customClaims });
  assert.equal((await call('/admin/operations/people', 'custom')).status, 200);
  assert.equal((await call(`/admin/staff/roles/${id}`, 'admin', { name: 'Consulta', permissions: ['orders.read'], expectedRevision: policy.revision })).status, 200);
  assert.equal((await call('/admin/operations/people', 'custom')).status, 403);
  assert.equal((await call('/admin/staff/roles/administrator', 'admin', { name: 'Administrador', permissions: [], expectedRevision: null })).status, 422);
});

test('employee names are admin-owned profile metadata and do not change claims', async () => {
  assert.equal((await assign()).status, 200); const claims = structuredClone(accounts.get(employee)!.customClaims);
  assert.equal((await call(`/admin/staff/profiles/${employee}`, 'buyer', { name: 'Nome Forjado' })).status, 403);
  assert.equal((await call(`/admin/staff/profiles/${employee}`, 'admin', { name: 'Bruno de Teste', admin: true, role: 'administrator' })).status, 200);
  assert.deepEqual(accounts.get(employee)!.customClaims, claims); assert.equal(docs.get(`_staffProfiles/${employee}`)?.name, 'Bruno de Teste'); assert.equal(docs.get(`_staffProfiles/${employee}`)?.admin, undefined);
});

test('staff order consultations and artwork exports feed activity; unpermitted or nonexistent exports do not', async () => {
  assert.equal((await assign()).status, 200); tokens.set('designer', { uid: employee, ...accounts.get(employee)!.customClaims });
  docs.set(`_staffProfiles/${employee}`, { name: 'Designer da Equipe' });
  const orderId = 'GB-ACTIVITY', itemId = 'item';
  docs.set(`orders/${orderId}`, { userId: 'customer', itens: [{ id: itemId, modeloPath: `artworks/customer/orders/${orderId}/${itemId}/${'a'.repeat(32)}.png` }] });
  assert.equal((await call('/admin/activity/orders', 'designer', { orderId, actor: 'forged' })).status, 200);
  assert.equal((await call('/admin/activity/artwork', 'designer', { orderId, itemId, format: 'pdf', actor: 'forged' })).status, 200);
  assert.equal((await call('/admin/activity/artwork', 'buyer', { orderId, itemId, format: 'pdf' })).status, 403);
  assert.equal((await call('/admin/activity/artwork', 'designer', { orderId, itemId: 'missing', format: 'pdf' })).status, 404);
  const events = [...docs].filter(([key]) => key.startsWith('_operationsActivity/')).map(([, value]) => value);
  assert.equal(events.length, 2); assert.ok(events.every(event => event.actor === employee && event.actorName === 'Designer da Equipe'));
  assert.deepEqual(events.map(event => event.action), ['order.viewed', 'artwork.exported']);
});
