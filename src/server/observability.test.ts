import assert from 'node:assert/strict';
import test from 'node:test';
import { logEvent, resolveRequestId, sanitizeLogValue } from './observability.js';

test('preserva request ID seguro e substitui valores inválidos', () => {
  assert.equal(resolveRequestId('trace-test_1234'), 'trace-test_1234');

  const generated = resolveRequestId('quebra\nde-header');
  assert.match(generated, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('remove credenciais e dados pessoais de estruturas aninhadas', () => {
  const original = {
    authorization: 'Bearer token-super-secreto',
    customer: {
      email: 'cliente@example.com',
      cpf: '199.912.380-85',
      phone: '(16) 99999-9999',
    },
    provider: {
      status: 400,
      message: 'Falha para cliente@example.com usando Bearer abcdefghijklmnopqrstuvwxyz',
    },
  };

  const serialized = JSON.stringify(sanitizeLogValue(original));
  assert.doesNotMatch(serialized, /token-super-secreto/);
  assert.doesNotMatch(serialized, /cliente@example\.com/);
  assert.doesNotMatch(serialized, /199\.912\.380-85/);
  assert.doesNotMatch(serialized, /99999-9999/);
  assert.match(serialized, /REDACTED/);
  assert.match(serialized, /status/);
});

test('limita estruturas circulares e não permite sobrescrever os campos-base do log', () => {
  const circular: Record<string, unknown> = { safe: 'ok' };
  circular.self = circular;
  assert.match(JSON.stringify(sanitizeLogValue(circular)), /CIRCULAR/);

  const previousLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (line?: unknown) => { lines.push(String(line)); };
  try {
    logEvent('info', 'security check', {
      level: 'forged',
      event: 'forged',
      email: 'cliente@example.com',
    });
  } finally {
    console.log = originalLog;
    if (previousLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previousLevel;
  }

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.event, 'security_check');
  assert.equal(parsed.email, '[REDACTED]');
});
