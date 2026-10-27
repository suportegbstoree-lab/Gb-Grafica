import assert from 'node:assert/strict';
import test from 'node:test';
import { checkUploadCors, parsePreflightOrigin, SIGNED_UPLOAD_HEADERS } from './uploadCorsPreflight.js';

test('faz somente OPTIONS sem credenciais e confere origem, método e todos os cabeçalhos', async () => {
  let called = false;
  const fakeFetch: typeof fetch = async (url, init) => {
    called = true;
    assert.equal(String(url), 'https://storage.googleapis.com/demo.firebasestorage.app/__gb_grafica_cors_preflight__');
    assert.equal(init?.method, 'OPTIONS');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('origin'), 'https://loja.example.com');
    assert.equal(headers.get('access-control-request-method'), 'PUT');
    assert.equal(headers.get('access-control-request-headers'), SIGNED_UPLOAD_HEADERS.join(','));
    assert.equal(headers.has('authorization'), false);
    return new Response(null, { status: 200, headers: {
      'Access-Control-Allow-Origin': 'https://loja.example.com',
      'Access-Control-Allow-Methods': 'GET, PUT',
      'Access-Control-Allow-Headers': SIGNED_UPLOAD_HEADERS.join(', '),
    } });
  };
  const result = await checkUploadCors('demo.firebasestorage.app', 'https://loja.example.com', fakeFetch);
  assert.equal(called, true);
  assert.deepEqual(result, { httpOk: true, originAllowed: true, methodAllowed: true, missingHeaders: [] });
});

test('não interpreta HTTP 200 sem cabeçalhos CORS como permissão', async () => {
  const fakeFetch: typeof fetch = async () => new Response(null, { status: 200 });
  const result = await checkUploadCors('demo.firebasestorage.app', 'https://loja.example.com', fakeFetch);
  assert.equal(result.httpOk, true);
  assert.equal(result.originAllowed, false);
  assert.equal(result.methodAllowed, false);
  assert.deepEqual(result.missingHeaders, [...SIGNED_UPLOAD_HEADERS]);
});

test('identifica cabeçalho faltante e origem errada', async () => {
  const fakeFetch: typeof fetch = async () => new Response(null, { status: 200, headers: {
    'Access-Control-Allow-Origin': 'https://outro.example.com',
    'Access-Control-Allow-Methods': 'PUT',
    'Access-Control-Allow-Headers': SIGNED_UPLOAD_HEADERS.slice(1).join(','),
  } });
  const result = await checkUploadCors('demo.firebasestorage.app', 'https://loja.example.com', fakeFetch);
  assert.equal(result.originAllowed, false);
  assert.deepEqual(result.missingHeaders, ['content-type']);
});

test('recusa origens e buckets inválidos antes de acessar a rede', async () => {
  for (const origin of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?x=1']) {
    assert.throws(() => parsePreflightOrigin(origin));
  }
  const neverFetch: typeof fetch = async () => { throw new Error('Não deveria acessar a rede'); };
  await assert.rejects(checkUploadCors('other/path', 'https://loja.example.com', neverFetch), /bucket inválido/);
  assert.equal(parsePreflightOrigin('http://localhost:5173'), 'http://localhost:5173');
});
