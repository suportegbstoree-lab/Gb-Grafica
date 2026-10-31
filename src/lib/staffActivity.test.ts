import test from 'node:test';
import assert from 'node:assert/strict';
import { activitySummary } from './staffActivity';
test('activity reports group unique employees and São Paulo calendar days', () => {
  const result = activitySummary([
    { actor: 'a', actorName: 'Ana', actorRole: 'Designer', action: 'product.images', entityId: 'p', at: '2026-10-31T02:30:00.000Z' },
    { actor: 'a', actorName: 'Ana', actorRole: 'Designer', action: 'artwork.accessed', entityId: 'o', at: '2026-10-31T04:30:00.000Z' },
    { actor: 'b', actorName: 'Bruno', actorRole: 'Gestor', action: 'promotion.created', entityId: 'x', at: '2026-10-31T04:31:00.000Z' },
  ]);
  assert.equal(result.total, 3); assert.equal(result.employees.length, 2); assert.equal(result.employees[0].count, 2);
  assert.deepEqual(result.days, [{ date: '2026-10-30', count: 1 }, { date: '2026-10-31', count: 2 }]);
  assert.equal(activitySummary([]).total, 0);
});
