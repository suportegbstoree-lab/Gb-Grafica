import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test, { after, before } from 'node:test';
import app from './app.js';

type ApiErrorBody = {
  error?: unknown;
  code?: unknown;
  request_id?: unknown;
};

let server: Server;
let baseUrl = '';
const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  APP_URL: process.env.APP_URL,
  APP_ALLOWED_ORIGINS: process.env.APP_ALLOWED_ORIGINS,
  LOG_LEVEL: process.env.LOG_LEVEL,
  PAGBANK_TOKEN: process.env.PAGBANK_TOKEN,
};

function restoreEnvironment(key: keyof typeof originalEnvironment): void {
  const value = originalEnvironment[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function expectApiError(response: Response, status: number, code: string): Promise<ApiErrorBody> {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  const body = await response.json() as ApiErrorBody;
  assert.equal(body.code, code);
  assert.equal(typeof body.error, 'string');
  assert.match(String(body.request_id), /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
  assert.equal(response.headers.get('x-request-id'), body.request_id);
  return body;
}

before(async () => {
  process.env.NODE_ENV = 'production';
  process.env.APP_URL = 'https://loja.example.com';
  process.env.APP_ALLOWED_ORIGINS = 'https://painel.example.com';
  process.env.LOG_LEVEL = 'silent';
  delete process.env.PAGBANK_TOKEN;

  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Servidor HTTP de teste indisponível.');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  restoreEnvironment('NODE_ENV');
  restoreEnvironment('APP_URL');
  restoreEnvironment('APP_ALLOWED_ORIGINS');
  restoreEnvironment('LOG_LEVEL');
  restoreEnvironment('PAGBANK_TOKEN');
});

test('aplica headers de segurança e propaga um request ID válido', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { 'X-Request-Id': 'trace-health-1234' },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-request-id'), 'trace-health-1234');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-permitted-cross-domain-policies'), 'none');
  assert.match(response.headers.get('strict-transport-security') || '', /max-age=31536000/);
  assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
});

test('autoriza somente origens configuradas e expõe o request ID', async () => {
  const allowed = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'https://painel.example.com' },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://painel.example.com');
  assert.match(allowed.headers.get('access-control-expose-headers') || '', /X-Request-Id/i);

  const denied = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'https://origem-invasora.example' },
  });
  await expectApiError(denied, 403, 'ORIGIN_NOT_ALLOWED');
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('responde corretamente ao preflight permitido', async () => {
  const response = await fetch(`${baseUrl}/api/checkout`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://loja.example.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,authorization,x-request-id',
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://loja.example.com');
  assert.match(response.headers.get('access-control-allow-methods') || '', /POST/);
  assert.match(response.headers.get('access-control-allow-headers') || '', /X-Request-Id/i);
});

test('rejeita JSON malformado sem expor o handler padrão do Express', async () => {
  const response = await fetch(`${baseUrl}/api/shipping-quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"cep":',
  });
  const body = await expectApiError(response, 400, 'INVALID_JSON');
  assert.equal(body.error, 'O corpo da requisição contém JSON inválido.');
});

test('rejeita payload acima de 256 KB', async () => {
  const response = await fetch(`${baseUrl}/api/shipping-quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(270 * 1024) }),
  });
  await expectApiError(response, 413, 'PAYLOAD_TOO_LARGE');
});

test('rejeita corpo com mídia diferente de JSON', async () => {
  const response = await fetch(`${baseUrl}/api/shipping-quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'cep=14400000',
  });
  await expectApiError(response, 415, 'UNSUPPORTED_MEDIA_TYPE');
});

test('inclui código e referência em falha operacional conhecida', async () => {
  const response = await fetch(`${baseUrl}/api/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await expectApiError(response, 503, 'SERVICE_UNAVAILABLE');
  assert.equal(body.error, 'O PagBank ainda não está configurado no servidor.');
});

test('rotas desconhecidas da API devolvem JSON 404 em vez do aplicativo React', async () => {
  const response = await fetch(`${baseUrl}/api/rota-inexistente`);
  const body = await expectApiError(response, 404, 'API_ROUTE_NOT_FOUND');
  assert.equal(body.error, 'Rota da API não encontrada.');
});
