import assert from 'node:assert/strict';
import test, { before, beforeEach, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { initializeTestEnvironment, assertSucceeds as succeeds, assertFails as fails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { DEFAULT_ROLE_PERMISSIONS } from '../../src/lib/staffAccess';

const assertSucceeds = <T>(value: PromiseLike<T>) => succeeds(Promise.resolve(value));
const assertFails = (value: PromiseLike<unknown>) => fails(Promise.resolve(value));
const projectId = 'demo-gb-grafica-rules';
let env: RulesTestEnvironment, admin: App;
const epoch = 'a'.repeat(32);
const claims = { staffRole: 'designer', gbStaffEpoch: epoch, email: 'designer@example.test' };
const access = { schemaVersion: 1, enabled: true, roleId: 'designer', epoch };
const policy = { schemaVersion: 1, enabled: true, revision: 'b'.repeat(32), permissions: DEFAULT_ROLE_PERMISSIONS.designer };
const product = { nome: 'Caderno', desc: 'Produto teste', categoria: 'Cadernos', imagem: '/original.png', preco_base: '20.00', tipoInput: 'arte' };
before(async () => {
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) assert.match(process.env[key] || '', /^(localhost|127\.0\.0\.1):\d+$/);
  env = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile('firestore.rules', 'utf8') }, storage: { rules: await readFile('storage.rules', 'utf8') } });
  admin = initializeApp({ projectId }, 'staff-rule-tests');
});
beforeEach(async () => {
  await env.clearFirestore(); await env.clearStorage();
  await seed([['_staffAccess/designer', access], ['_staffRoles/designer', policy], ['anuncios/product', product],
    ['config/main', { logo_url: '/logo.png', banner_principal: '/banner.png', razao_social: 'Original', contatos: [] }],
    ['orders/order', { userId: 'customer', total: '20.00', status: 'Pago', itens: [] }]]);
});
after(async () => { await env.cleanup(); await deleteApp(admin); });
async function seed(entries: Array<[string, Record<string, unknown>]>) { await env.withSecurityRulesDisabled(async context => { for (const [path, value] of entries) await context.firestore().doc(path).set(value); }); }
const designer = () => env.authenticatedContext('designer', claims);
const path = (scope = 'products/product') => `catalog/${scope}/${randomUUID().replaceAll('-', '')}.png`;
const metadata = (uid = 'designer') => ({ contentType: 'image/png', customMetadata: { uploadedBy: uid } });

test('designer edits only image and personalization fields, never commercial fields or creation/deletion', async () => {
  const db = designer().firestore(), ref = db.doc('anuncios/product');
  await assertSucceeds(ref.update({ imagem: '/changed.png', imagens: ['/gallery.png'] }));
  await assertSucceeds(ref.update({ tipoInput: 'texto_arte', labelTexto: 'Nome', printProfile: { widthMm: 100, heightMm: 150, bleedMm: 2, safeMarginMm: 5, targetDpi: 300 } }));
  for (const fields of [{ nome: 'Changed' }, { desc: 'Changed' }, { categoria: 'Changed' }, { preco_base: '0.01' }, { combinacoes: {} }, { destaque: true }, { shipping: {} }, { unknown: true }]) await assertFails(ref.update(fields));
  await assertFails(db.doc('anuncios/new').set(product)); await assertFails(ref.delete());
});
test('product manager creates and edits products/categories/promotions without private orders or settings access', async () => {
  await seed([['_staffAccess/manager', { ...access, roleId: 'product-manager' }], ['_staffRoles/product-manager', { ...policy, permissions: DEFAULT_ROLE_PERMISSIONS['product-manager'] }]]);
  const context = env.authenticatedContext('manager', { ...claims, staffRole: 'product-manager', email: 'manager@example.test' }), db = context.firestore();
  await assertSucceeds(db.doc('anuncios/new').set(product)); await assertSucceeds(db.doc('anuncios/new').update({ preco_base: '30.00' }));
  await assertSucceeds(db.doc('categories/category').set({ nome: 'Nova' }));
  await assertSucceeds(db.doc('promocoes/promotion').set({ titulo: 'Oferta', ativa: true, alvoTipo: 'produto', alvoId: 'product', alvoNome: 'Caderno', descontoTipo: 'percentual', descontoPercentual: 10 }));
  await assertFails(db.doc('config/main').update({ logo_url: '/changed.png' }));
  await assertFails(db.doc('orders/order').get());
  await assertFails(db.collection('orders').get());
  await assertSucceeds(context.storage().ref(path()).put(new Uint8Array([1]), metadata('manager')));
  await assertFails(context.storage().ref(path('site/main')).put(new Uint8Array([1]), metadata('manager')));
});
test('branding and font permissions cannot overwrite business settings through a full document write', async () => {
  const db = designer().firestore();
  await assertSucceeds(db.doc('config/main').update({ logo_url: '/new.png', banner_titulo: 'Novo' }));
  await assertSucceeds(db.doc('config/main').update({ fontes_personalizacao: [] }));
  await assertFails(db.doc('config/main').update({ razao_social: 'Changed' }));
  await assertFails(db.doc('config/main').set({ logo_url: '/new.png', banner_principal: '/banner.png' }));
  await assertFails(db.doc('config/main').delete());
});
test('employees cannot forge registries, edit policies, read other registries or send arbitrary mail', async () => {
  const db = designer().firestore();
  await assertSucceeds(db.doc('_staffAccess/designer').get()); await assertSucceeds(db.doc('_staffRoles/designer').get());
  await assertFails(db.doc('_staffAccess/designer').set({ ...access, roleId: 'administrator' }));
  await assertFails(db.doc('_staffRoles/designer').set({ ...policy, permissions: ['products.manage'] }));
  await assertFails(db.collection('_staffAccess').get()); await assertFails(db.doc('_staffAccess/other').get());
  await assertFails(db.doc('_staffNotifications/mail').set({ email: 'someone@example.test' }));
  await assertFails(db.doc('users/designer').set({ uid: 'designer', email: claims.email, role: 'admin' }));
});
test('order read is independent from production updates and permissions are live for a frozen token', async () => {
  const db = designer().firestore();
  await assertSucceeds(db.doc('orders/order').get());
  await assertFails(db.doc('orders/order').update({ status: 'Enviado' }));
  await seed([['_staffRoles/designer', { ...policy, permissions: ['products.images'] }]]);
  await assertFails(db.doc('orders/order').get());
  await assertFails(db.collection('orders').get());
  await assertSucceeds(db.doc('anuncios/product').update({ imagem: '/still-allowed.png' }));
});
test('Storage uses at most the two staff authorization documents and revokes uploads/list/delete live', async () => {
  const storage = designer().storage(), name = path(), ref = storage.ref(name);
  await assertSucceeds(ref.put(new Uint8Array([1, 2]), metadata()));
  await assertSucceeds(storage.ref('catalog/products/product').listAll());
  await assertSucceeds(storage.ref(path('site/main')).put(new Uint8Array([1]), metadata()));
  await assertFails(storage.ref(path('categories/main')).put(new Uint8Array([1]), metadata()));
  await seed([['_staffRoles/designer', { ...policy, permissions: ['orders.read'] }]]);
  await assertFails(ref.delete()); await assertFails(storage.ref(path()).put(new Uint8Array([1]), metadata()));
  await assertFails(storage.ref('catalog/products/product').listAll());
  await assertSucceeds(ref.getMetadata()); // Published catalog images remain public.
});
test('Storage refuses a forged uploader, stale epoch, disabled policy or absent mirror', async () => {
  const storage = designer().storage();
  await assertFails(storage.ref(path()).put(new Uint8Array([1]), metadata('other')));
  await seed([['_staffAccess/designer', { ...access, epoch: 'c'.repeat(32) }]]);
  await assertFails(storage.ref(path()).put(new Uint8Array([1]), metadata()));
  await seed([['_staffAccess/designer', access], ['_staffRoles/designer', { ...policy, enabled: false }]]);
  await assertFails(storage.ref(path()).put(new Uint8Array([1]), metadata()));
  await env.withSecurityRulesDisabled(context => context.firestore().doc('_staffRoles/designer').delete());
  await assertFails(storage.ref(path()).put(new Uint8Array([1]), metadata()));
});
test('named database records alone cannot authorize Storage; the default mirror is required', async () => {
  const uid = `named-${randomUUID().slice(0, 8)}`;
  await getFirestore(admin, 'staff-primary-tests').doc(`_staffAccess/${uid}`).set(access);
  await getFirestore(admin, 'staff-primary-tests').doc('_staffRoles/designer').set(policy);
  const storage = env.authenticatedContext(uid, claims).storage();
  await assertFails(storage.ref(path()).put(new Uint8Array([1]), metadata(uid)));
  await seed([[`_staffAccess/${uid}`, access]]);
  await assertSucceeds(storage.ref(path()).put(new Uint8Array([1]), metadata(uid)));
});
test('revocation and later regrant do not resurrect an old staff token', async () => {
  const context = designer();
  await seed([['_staffAccess/designer', { ...access, enabled: false }]]);
  await assertFails(context.firestore().doc('anuncios/product').set(product));
  const config = (await context.firestore().doc('config/main').get()).data()!;
  await assertFails(context.firestore().doc('config/main').set(config));
  await assertFails(context.firestore().doc('orders/order').get());
  await assertFails(context.storage().ref(path()).put(new Uint8Array([1]), metadata()));
  await seed([['_staffAccess/designer', { ...access, epoch: 'c'.repeat(32) }]]);
  await assertFails(context.firestore().doc('orders/order').get());
  const fresh = env.authenticatedContext('designer', { ...claims, gbStaffEpoch: 'c'.repeat(32) });
  await assertSucceeds(fresh.firestore().doc('orders/order').get());
});

test('flash schedules require integer start/end and private tracking jobs/labels stay server-only', async () => {
  await seed([['_staffRoles/designer', { ...policy, permissions: ['promotions.manage'] }]]);
  const db = designer().firestore(), promo = db.doc('promocoes/flash');
  const value = { titulo: 'Oferta', ativa: true, alvoTipo: 'produto', alvoId: 'product', alvoNome: 'Caderno', descontoTipo: 'percentual', descontoPercentual: 10, relampago: true, startsAt: 1000, endsAt: 2000 };
  await assertSucceeds(promo.set(value));
  await assertFails(promo.update({ endsAt: 999 })); await assertFails(promo.update({ endsAt: 'tomorrow' }));
  const { startsAt: _, ...missingStart } = value; await assertFails(promo.set(missingStart));
  await assertFails(db.doc('_trackingJobs/order').get()); await assertFails(db.doc('_trackingJobs/order').set({ code: 'AA123456789BR' }));
  await assertFails(db.doc('orders/order/productionLabels/label').get()); await assertFails(db.doc('orders/order/productionLabels/label').set({ createdAt: 'fake' }));
});
