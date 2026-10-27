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

test('remove o conteúdo inteiro de chaves privadas PEM, inclusive blocos truncados', () => {
  for (const kind of ['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY', 'OPENSSH PRIVATE KEY']) {
    const error = new Error(`falha -----BEGIN ${kind}-----\nCONTEUDO_FICTICIO\n-----END ${kind}----- status=400`);
    const sanitized = JSON.stringify(sanitizeLogValue(error));
    assert.doesNotMatch(sanitized, /CONTEUDO_FICTICIO|BEGIN|END/);
    assert.match(sanitized, /PRIVATE_KEY_REDACTED/);
    assert.match(sanitized, /status=400/);
  }
  const truncated = sanitizeLogValue('falha -----BEGIN PRIVATE KEY-----\\nCONTEUDO_TRUNCADO');
  assert.equal(truncated, 'falha [PRIVATE_KEY_REDACTED]');
});

test('oculta assinaturas de URLs e campos com URLs assinadas em logs', () => {
  const url = 'https://storage.googleapis.com/bucket/file?X-Goog-Credential=cred-ficticia&X-Goog-Signature=assinatura-ficticia&token=token-ficticio';
  const sanitized = JSON.stringify(sanitizeLogValue({
    signedUrl: url,
    message: `Falha ao acessar ${url}`,
    signature: 'assinatura-direta',
    status: 403,
  }));
  assert.doesNotMatch(sanitized, /cred-ficticia|assinatura-ficticia|token-ficticio|assinatura-direta/);
  assert.match(sanitized, /REDACTED/);
  assert.match(sanitized, /403/);
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
