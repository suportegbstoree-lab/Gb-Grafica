import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ROLE_PERMISSIONS, parseStaffPermissions, staffPermissions, validStaffAccess, validStaffRole, permittedProductPatch } from './staffAccess';

const access = { schemaVersion: 1, enabled: true, epoch: 'a'.repeat(32), roleId: 'designer', updatedAt: '', updatedBy: 'admin' };
const claims = { staffRole: 'designer', gbStaffEpoch: access.epoch };
const policy = { schemaVersion: 1, enabled: true, revision: 'b'.repeat(32), permissions: DEFAULT_ROLE_PERMISSIONS.designer, updatedAt: '', updatedBy: 'admin' };
test('default roles follow separate designer and product manager scopes', () => {
  assert.ok(DEFAULT_ROLE_PERMISSIONS.designer.includes('products.images'));
  assert.ok(!DEFAULT_ROLE_PERMISSIONS.designer.includes('products.manage'));
  assert.ok(!DEFAULT_ROLE_PERMISSIONS.designer.includes('settings.manage'));
  assert.ok(DEFAULT_ROLE_PERMISSIONS['product-manager'].includes('products.manage'));
  assert.ok(!DEFAULT_ROLE_PERMISSIONS['product-manager'].includes('orders.read'));
});
test('staff permissions require a live role, registry and matching non-admin token', () => {
  assert.ok(validStaffAccess(access)); assert.ok(validStaffRole(policy));
  assert.deepEqual(staffPermissions(access, policy, claims), policy.permissions);
  for (const record of [null, {}, { ...access, enabled: false }, { ...access, epoch: 'legacy' }, { ...access, roleId: 'administrator' }]) assert.deepEqual(staffPermissions(record, policy, claims), []);
  for (const token of [{}, { ...claims, admin: true }, { ...claims, gbStaffEpoch: 'c'.repeat(32) }, { ...claims, staffRole: 'product-manager' }]) assert.deepEqual(staffPermissions(access, policy, token), []);
  assert.deepEqual(staffPermissions(access, { ...policy, enabled: false }, claims), []);
  assert.deepEqual(staffPermissions(access, undefined, claims), []);
});
test('permission input cannot add unknown privileges, duplicate entries or inconsistent order access', () => {
  for (const value of [null, {}, ['staff.manage'], ['orders.artwork'], ['orders.fulfillment'], ['products.manage', 'products.manage']]) assert.equal(parseStaffPermissions(value), null);
  assert.deepEqual(parseStaffPermissions([]), []);
  assert.deepEqual(parseStaffPermissions(['orders.artwork', 'orders.read']), ['orders.read', 'orders.artwork']);
});
test('restricted product patches discard commercial fields and unrelated extensions', () => {
  const data = { nome: 'Changed', preco_base: '0.01', imagem: '/new.png', imagens: [], tipoInput: 'texto', labelTexto: 'Nome', destaque: true, shipping: {} };
  assert.deepEqual(permittedProductPatch(data, ['products.images']), { imagem: '/new.png', imagens: [] });
  assert.deepEqual(permittedProductPatch(data, ['products.personalization']), { tipoInput: 'texto', labelTexto: 'Nome' });
  assert.deepEqual(permittedProductPatch(data, []), {});
});
