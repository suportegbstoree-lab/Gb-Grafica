import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedPanelSections, mayEnterPanel, type PanelSection } from './panelAccess';
import { ALL_STAFF_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, type StaffPermission } from './staffAccess';
test('each permission exposes only its own administrative section; order artwork/fulfillment alone do not grant order reads', () => {
  const expected: Record<StaffPermission, PanelSection[]> = {
    'documents.templates.manage':['documents'],
    'documents.generate':['documents'],
    'operations.self':['operations'],
    'bundles.manage': ['bundles'],
    'emails.manage': ['email'],
    'operations.manage': ['operations'],
    'products.manage': ['products', 'variation-types'], 'products.images': ['products'], 'products.personalization': ['products'],
    'categories.manage': ['categories'], 'promotions.manage': ['coupons', 'promotions'], 'branding.manage': ['branding'],
    'fonts.manage': ['fonts'], 'settings.manage': ['config'], 'orders.read': ['orders'],
    'orders.artwork': [], 'orders.fulfillment': [], 'ai.generate': [],
  };
  for (const permission of ALL_STAFF_PERMISSIONS) assert.deepEqual(allowedPanelSections(false, [permission]), expected[permission], permission);
  assert.equal(mayEnterPanel(false, []), false); assert.equal(mayEnterPanel(false, ['ai.generate']), false);
});
test('employee roles use the current permission set; staff management cannot be delegated', () => {
  assert.deepEqual(allowedPanelSections(false, DEFAULT_ROLE_PERMISSIONS['product-manager']), ['products', 'variation-types', 'coupons', 'categories', 'promotions']);
  assert.ok(allowedPanelSections(false, DEFAULT_ROLE_PERMISSIONS.designer).includes('orders'));
  assert.deepEqual(allowedPanelSections(false, ['fonts.manage']), ['fonts']);
  assert.ok(!allowedPanelSections(false, ALL_STAFF_PERMISSIONS).includes('staff'));
  assert.ok(allowedPanelSections(true, []).includes('staff'));
});
