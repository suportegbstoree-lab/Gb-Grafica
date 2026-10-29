import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import type { IncomingMessage } from 'node:http';
import { ClientFilePolicy, decodedRequestPath, localNetworkPolicy, localRequestAllowed, localServerOptions, validateLocalBind } from './localServerSecurity.js';

const root = mkdtempSync(path.join(tmpdir(), 'gb-server-security-'));
function file(name: string, data = 'fictitious test data') {
  const target = path.join(root, name); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, data); return target;
}
file('index.html'); file('firebase-applet-config.json'); file('src/main.tsx'); file('src/server/firebaseAdmin.ts');
file('src/e2e/E2EHarness.tsx'); file('src/main.test.ts'); file('src/credential.json');
file('public/logo.png'); file('node_modules/pkg/index.js'); file('node_modules/.vite/deps/react.js');
file('dist/index.html'); file('dist/assets/app.js'); file('server.ts'); file('.secret.json');
const policy = new ClientFilePolicy(root);
after(() => rmSync(root, { recursive: true, force: true }));

test('development is explicit; absent environment selects production and invalid values fail', () => {
  assert.equal(localServerOptions([], {}).mode, 'production');
  assert.equal(localServerOptions(['--mode', 'development'], {}).host, '127.0.0.1');
  assert.equal(localServerOptions([], { NODE_ENV: 'staging' }).mode, 'production');
  assert.equal(localServerOptions(['--port', '3100'], { PORT: '3200' }).port, 3100);
  for (const env of [{ NODE_ENV: 'prodution' }, { PORT: 'abc' }, { PORT: '0' }, { PORT: '65536' }]) assert.throws(() => localServerOptions([], env));
  assert.throws(() => localServerOptions(['--mode', 'development'], { NODE_ENV: 'production' }));
  assert.throws(() => localServerOptions(['--host'], {}));
  assert.throws(() => localServerOptions(['--port', '3000', '--port', '4000'], {}));
});

test('network exposure requires opt-in and exact hosts, independently of APP_URL', () => {
  assert.throws(() => localServerOptions(['--mode', 'development', '--host', '0.0.0.0'], {}));
  assert.throws(() => localNetworkPolicy({ DEV_SERVER_ALLOW_NETWORK: 'true' }));
  for (const host of ['.trycloudflare.com', '*', 'https://example.com', 'example.com:3000', '0.0.0.0']) {
    assert.throws(() => localNetworkPolicy({ DEV_SERVER_ALLOW_NETWORK: 'true', VITE_ALLOWED_HOSTS: host }));
  }
  const network = localNetworkPolicy({ DEV_SERVER_ALLOW_NETWORK: 'true', VITE_ALLOWED_HOSTS: 'phone.example.com,192.168.0.10' });
  assert.doesNotThrow(() => validateLocalBind('0.0.0.0', network));
  assert.deepEqual(localNetworkPolicy({ APP_URL: 'https://public.example.com' }).hosts, ['localhost', '127.0.0.1', '[::1]']);
  assert.deepEqual(localNetworkPolicy({ DEV_SERVER_ALLOW_NETWORK: 'true', VITE_ALLOWED_HOSTS: '*' }, true).hosts, ['localhost', '127.0.0.1', '[::1]']);
  assert.ok(localNetworkPolicy({ DEV_SERVER_ALLOW_NETWORK: 'true', VITE_ALLOWED_HOSTS: '2001:db8::1' }).hosts.includes('[2001:db8::1]'));
});

function request(host: string, origin?: string, remoteAddress = '127.0.0.1') {
  return { headers: { host, ...(origin === undefined ? {} : { origin }), 'x-forwarded-host': 'localhost:3000' },
    rawHeaders: ['Host', host], socket: { remoteAddress } } as unknown as IncomingMessage;
}
test('HTTP and WebSocket share strict Host/Origin rules and ignore forwarded hosts', () => {
  const network = localNetworkPolicy({});
  assert.equal(localRequestAllowed(request('localhost:3000', 'http://localhost:3000'), network), true);
  assert.equal(localRequestAllowed(request('[::1]:3000', undefined, '::1'), network), true);
  for (const req of [request('evil.example:3000'), request('192.168.0.10:3000'), request('localhost:3000', 'https://evil.example'),
    request('localhost:3000', 'http://localhost:4000'), request('localhost:3000', 'null'), request('localhost:3000', undefined, '192.168.0.10')]) {
    assert.equal(localRequestAllowed(req, network), false);
  }
  const duplicate = request('localhost:3000'); duplicate.rawHeaders.push('Host', 'evil.example');
  assert.equal(localRequestAllowed(duplicate, network), false);
});

test('only client source, runtime dependencies and public Firebase config may be loaded', () => {
  for (const name of ['src/main.tsx', 'node_modules/pkg/index.js', 'node_modules/.vite/deps/react.js', 'firebase-applet-config.json', 'index.html', 'public/logo.png']) {
    assert.equal(policy.allowedFile(path.join(root, name)), true, name);
  }
  for (const name of ['src/server/firebaseAdmin.ts', 'src/e2e/E2EHarness.tsx', 'src/main.test.ts', 'src/credential.json', 'server.ts', '.secret.json']) {
    assert.equal(policy.allowedFile(path.join(root, name)), false, name);
  }
  assert.equal(new ClientFilePolicy(root, true).allowedFile(path.join(root, 'src/e2e/E2EHarness.tsx')), true);
});

test('queries and encodings never convert private paths into client paths', () => {
  for (const suffix of ['', '?raw', '?url', '?import&raw', '?raw??', '?inline=1&import']) {
    for (const file of ['/server.ts', '/.secret.json', '/src/server/firebaseAdmin.ts', `/@fs/${root}/.secret.json`]) {
      assert.equal(policy.allowedRequest(file + suffix), false, file + suffix);
    }
  }
  for (const value of ['/src/%2e%2e/server.ts', '/src/%252e%252e/server.ts', '/src%5cserver%5cfirebaseAdmin.ts', '/%00', '/%zz', '//server.ts']) assert.equal(decodedRequestPath(value), null, value);
  assert.equal(policy.allowedRequest('/src/%73erver/firebaseAdmin.ts?raw'), false);
  assert.equal(policy.allowedRequest('/src/main.tsx?import'), true);
  assert.equal(policy.allowedRequest('/'), true);
  assert.equal(policy.allowedRequest('/sobre-nos'), true);
  assert.equal(policy.allowedRequest('/__open-in-editor?file=server.ts'), false);
});

test('symlink aliases cannot serve server files or escape the client/dependency roots', () => {
  symlinkSync(path.join(root, 'src/server/firebaseAdmin.ts'), path.join(root, 'src/alias.ts'));
  symlinkSync(path.join(root, '.secret.json'), path.join(root, 'node_modules/pkg/alias.js'));
  symlinkSync(path.join(root, '.secret.json'), path.join(root, 'public/alias.png'));
  for (const file of ['src/alias.ts', 'node_modules/pkg/alias.js', 'public/alias.png']) assert.equal(policy.allowedFile(path.join(root, file)), false);
  assert.throws(() => policy.assertPublicTree(), /Unsafe/);
  rmSync(path.join(root, 'public/alias.png'));
  const aliases = mkdtempSync(path.join(tmpdir(), 'gb-directory-aliases-'));
  try {
    symlinkSync(root, path.join(aliases, 'src'), 'dir');
    symlinkSync(path.join(root, 'public'), path.join(aliases, 'public'), 'dir');
    symlinkSync(path.join(root, 'dist'), path.join(aliases, 'dist'), 'dir');
    const linked = new ClientFilePolicy(aliases);
    assert.equal(linked.allowedRequest('/src/server.ts?raw'), false);
    assert.equal(linked.allowedRequest('/logo.png'), false);
    assert.throws(() => linked.assertPublicTree(), /Unsafe/);
    assert.equal(linked.allowedRequest('/', true), false);
    assert.equal(linked.allowedRequest('/assets/app.js', true), false);
  } finally { rmSync(aliases, { recursive: true, force: true }); }
});

test('a declared node_modules symlink permits dependency modules without permitting the parent project', () => {
  const linkedRoot = mkdtempSync(path.join(tmpdir(), 'gb-linked-dependencies-'));
  try {
    symlinkSync(path.join(root, 'node_modules'), path.join(linkedRoot, 'node_modules'), 'dir');
    const linked = new ClientFilePolicy(linkedRoot);
    assert.equal(linked.allowedFile(path.join(root, 'node_modules/pkg/index.js')), true);
    assert.equal(linked.allowedRequest(`/@fs${root}/node_modules/pkg/index.js`), true);
    assert.equal(linked.allowedRequest(`/@fs${root}/src/server/firebaseAdmin.ts?raw`), false);
    assert.equal(linked.allowedRequest(`/@fs${root}/.secret.json?raw`), false);
    assert.equal(linked.allowedFile(path.join(root, 'src/server/firebaseAdmin.ts')), false);
    assert.equal(linked.allowedFile(path.join(root, '.secret.json')), false);
  } finally { rmSync(linkedRoot, { recursive: true, force: true }); }
});

test('cold optimizer requests wait for Vite only inside its declared cache, never through external links', () => {
  const pending = '/node_modules/.vite/development/deps/pending_react.js';
  assert.equal(policy.allowedRequest(pending), true);
  assert.equal(policy.allowedRequest(`/@fs${root}${pending}`), true);
  assert.equal(policy.allowedRequest('/node_modules/pkg/missing.js'), false);
  assert.equal(policy.allowedRequest('/node_modules/.vite/development/deps/private-key.js'), false);
  assert.equal(policy.allowedRequest('/node_modules/.vite/development/deps/pending.json'), false);
  const outside = mkdtempSync(path.join(tmpdir(), 'gb-outside-cache-'));
  try {
    symlinkSync(outside, path.join(root, 'node_modules/.vite/e2e'), 'dir');
    assert.equal(policy.allowedRequest('/node_modules/.vite/e2e/deps/pending_react.js'), false);
  } finally {
    rmSync(path.join(root, 'node_modules/.vite/e2e'));
    rmSync(outside, { recursive: true, force: true });
  }
});

test('public assets are checked before serve/build; credentials and archives fail closed', () => {
  assert.doesNotThrow(() => policy.assertPublicTree());
  for (const name of ['private-key.txt', 'account.json', 'backup.tar.gz']) {
    const target = file(`public/${name}`);
    assert.throws(() => policy.assertPublicTree());
    rmSync(target);
  }
});

test('production serves only built files and SPA routes, without source or Vite endpoints', () => {
  assert.doesNotThrow(() => policy.assertDist());
  assert.equal(policy.allowedRequest('/assets/app.js', true), true);
  assert.equal(policy.allowedRequest('/termos-de-uso', true), true);
  for (const url of ['/server.ts?raw', '/src/main.tsx', '/@vite/client', '/node_modules/pkg/index.js', '/firebase-applet-config.json', '/.secret.json', '/assets/missing.js']) assert.equal(policy.allowedRequest(url, true), false, url);
  symlinkSync(path.join(root, '.secret.json'), path.join(root, 'dist/alias.txt'));
  assert.equal(policy.allowedRequest('/alias.txt', true), false);
});

test('missing build fails before any production listener or Vite initialization', async () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'gb-no-build-'));
  try {
    const { startLocalServer } = await import('./localServer.js');
    await assert.rejects(startLocalServer(empty, { mode: 'production', host: '127.0.0.1', port: 0, network: { allowNetwork: true, hosts: [] } }), /Production build missing/);
  } finally { rmSync(empty, { recursive: true, force: true }); }
});
