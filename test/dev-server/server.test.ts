import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as netServer, connect } from 'node:net';
import { request } from 'node:http';
import { mkdtemp, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const id = randomUUID().replaceAll('-', '');
const name = `security-probe-${id}`;
const marker = `DUMMY-PRIVATE-MARKER-${id}`;
const files: string[] = [];
const children: ChildProcess[] = [];
const env = { ...process.env, NODE_ENV: '', LOG_LEVEL: 'silent', DEV_SERVER_ALLOW_NETWORK: 'false', VITE_ALLOWED_HOSTS: '',
  VITE_E2E_MODE: '', DISABLE_HMR: '', FIREBASE_SERVICE_ACCOUNT_JSON: '', FIREBASE_PROJECT_ID: '', FIREBASE_CLIENT_EMAIL: '',
  FIREBASE_PRIVATE_KEY: '', PAGBANK_TOKEN: '', CORREIOS_TOKEN: '', APP_URL: 'http://localhost:3000' };
let dev: { child: ChildProcess; port: number };
let production: { child: ChildProcess; port: number };
let temporary = '';

async function availablePort() {
  const server = netServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}
async function start(entry: string, args: string[], changes: Record<string, string> = {}, health = '/api/health', bind = '127.0.0.1') {
  const port = await availablePort();
  const child = spawn(process.execPath, ['--import', 'tsx', entry, ...args, '--host', bind, '--port', String(port)], {
    cwd: root, env: { ...env, ...changes }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let output = ''; child.stdout?.on('data', chunk => { output += chunk; }); child.stderr?.on('data', chunk => { output += chunk; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output.slice(-3000)}`);
    try { if ((await fetch(`http://127.0.0.1:${port}${health}`)).ok) return { child, port }; } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${output.slice(-3000)}`);
}
function raw(port: number, url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: url, headers: { Accept: '*/*', ...headers } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.setTimeout(15_000, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject); req.end();
  });
}
async function put(relative: string, content: string) {
  const target = path.join(root, relative); await writeFile(target, content); files.push(target); return target;
}
before(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'gb-local-server-http-'));
  await writeFile(path.join(temporary, 'outside.txt'), marker);
  await put(`.${name}.json`, JSON.stringify({ marker }));
  await put(`src/server/${name}.ts`, `export default ${JSON.stringify(marker)};`);
  await put(`src/${name}.ts`, 'export const publicMarker = "SAFE-CLIENT-MODULE";');
  dev = await start('server.ts', ['--mode', 'development']);
  production = await start('server.ts', []); // No NODE_ENV and no --mode must be production.
});
after(async () => {
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(children.map(child => child.exitCode === null
    ? Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 2000))]) : undefined));
  await Promise.all(files.map(file => rm(file, { force: true })));
  await rm(temporary, { recursive: true, force: true });
});

test('embedded development server serves the application/client modules and preserves API health', async () => {
  const entry = await raw(dev.port, '/src/main.tsx');
  assert.equal(entry.status, 200);
  for (const url of new Set(entry.body.match(/\/node_modules\/\.vite\/development\/deps\/[^"'\s]+/g) || [])) {
    assert.equal((await raw(dev.port, url)).status, 200, `optimizer module: ${url}`);
  }
  for (const url of ['/', '/admin', '/src/main.tsx', `/src/${name}.ts`, `/@fs${root}src/${name}.ts`, '/@vite/client', '/@react-refresh', '/firebase-applet-config.json', '/logo.png']) {
    const response = await raw(dev.port, url); assert.equal(response.status, 200, `${url}: ${response.body.slice(0, 150)}`);
  }
  assert.equal((await raw(dev.port, '/api/health')).status, 200);
});

test('real HTTP: raw/import/url queries cannot expose root, backend, scripts or credentials', async () => {
  for (const file of ['/server.ts', '/vite.config.ts', '/package.json', '/package-lock.json', '/src/server/firebaseAdmin.ts',
    `/src/server/${name}.ts`, `/src/${name}.test.ts`, '/scripts/e2e-server.ts', '/api/index.ts', '/.git/config',
    `/.${name}.json`, `/@fs/${root}/.${name}.json`, `/@fs${root}.${name}.json`, `/@fs/${temporary}/outside.txt`, `/@fs${temporary}/outside.txt`]) {
    for (const query of ['', '?raw', '?url', '?import&raw', '?inline=1&import', '?raw??']) {
      const response = await raw(dev.port, file + query);
      assert.ok([403, 404].includes(response.status), `${file + query}: ${response.status}`);
      assert.ok(!response.body.includes(marker));
    }
  }
});

test('real HTTP: encoded separators, traversal and NUL variants remain blocked', async () => {
  for (const url of ['/src/%73erver/firebaseAdmin.ts?raw', '/src/%2e%2e/server.ts?raw', '/src/%252e%252e/server.ts?raw',
    '/src%5cserver%5cfirebaseAdmin.ts?raw', '/%00', '/%zz', '/@fs/%2fetc/passwd?raw', '/__open-in-editor?file=server.ts']) {
    const response = await raw(dev.port, url);
    assert.equal(response.status, 403, url);
    assert.ok(!response.body.includes(marker));
  }
});

test('real HTTP: symlinks added after startup cannot bypass client or production boundaries', async () => {
  for (const relative of [`src/${name}-alias.ts`, `public/${name}-alias.png`, `dist/${name}-alias.txt`]) {
    const target = path.join(root, relative); await symlink(path.join(temporary, 'outside.txt'), target); files.push(target);
  }
  for (const url of [`/src/${name}-alias.ts?raw`, `/${name}-alias.png`, `/@fs/${root}/src/${name}-alias.ts?raw`]) {
    const response = await raw(dev.port, url); assert.equal(response.status, 403, url); assert.ok(!response.body.includes(marker));
  }
  assert.equal((await raw(production.port, `/${name}-alias.txt`)).status, 403);
  await rm(path.join(root, `public/${name}-alias.png`));
});

test('Host and Origin checks reject DNS rebinding, forwarded-host spoofing and cross-origin reads', async () => {
  for (const headers of [{ Host: 'attacker.example' }, { Host: '192.168.0.99' },
    { Host: `localhost:${dev.port}`, Origin: 'https://attacker.example' },
    { Host: `localhost:${dev.port}`, Origin: 'null' },
    { Host: 'attacker.example', 'X-Forwarded-Host': `localhost:${dev.port}` }]) {
    assert.equal((await raw(dev.port, '/src/main.tsx', headers)).status, 403);
  }
  assert.equal((await raw(dev.port, '/src/main.tsx', { Host: `localhost:${dev.port}`, Origin: `http://localhost:${dev.port}` })).status, 200);
});

test('WebSocket upgrade rejects untrusted Origin before the Vite ping exception', async () => {
  const response = await new Promise<string>((resolve, reject) => {
    const socket = connect(dev.port, '127.0.0.1', () => socket.write([
      'GET / HTTP/1.1', `Host: localhost:${dev.port}`, 'Origin: https://attacker.example', 'Connection: Upgrade',
      'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Protocol: vite-ping', '', '',
    ].join('\r\n')));
    let text = ''; socket.on('data', chunk => { text += chunk; }); socket.on('end', () => resolve(text)); socket.on('error', reject);
    socket.setTimeout(5000, () => socket.destroy(new Error('Upgrade timed out')));
  });
  assert.match(response, /^HTTP\/1.1 403/);
});

test('production with unset NODE_ENV serves dist/ and never mounts Vite', async () => {
  for (const url of ['/', '/sobre-nos', '/termos-de-uso', '/logo.png']) assert.equal((await raw(production.port, url)).status, 200, url);
  const home = await raw(production.port, '/'); assert.match(home.body, /\/assets\//); assert.doesNotMatch(home.body, /\/@vite\/client/);
  for (const url of ['/server.ts?raw', '/@vite/client', '/src/main.tsx', '/firebase-applet-config.json', `/.${name}.json`]) {
    const response = await raw(production.port, url); assert.equal(response.status, 403, url); assert.ok(!response.body.includes(marker));
  }
});

test('standalone Vite and preview use the same boundary', async () => {
  const standalone = await start('node_modules/vite/bin/vite.js', [], {}, '/');
  assert.equal((await raw(standalone.port, '/src/main.tsx')).status, 200);
  assert.equal((await raw(standalone.port, '/server.ts?raw')).status, 403);
  const preview = await start('node_modules/vite/bin/vite.js', ['preview'], {}, '/');
  assert.equal((await raw(preview.port, '/')).status, 200);
  assert.equal((await raw(preview.port, '/src/main.tsx?raw')).status, 403);
  assert.equal((await raw(preview.port, `/${name}-alias.txt`)).status, 403);
});

async function failsToStart(entry: string, args: string[], changes: Record<string, string>, expected: RegExp) {
  const child = spawn(process.execPath, ['--import', 'tsx', entry, ...args], { cwd: root, env: { ...env, LOG_LEVEL: 'error', ...changes }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child); let output = '';
  child.stdout?.on('data', chunk => { output += chunk; }); child.stderr?.on('data', chunk => { output += chunk; });
  let timer: ReturnType<typeof setTimeout>;
  const code = await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise((_resolve, reject) => {
    timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Unexpected listener/process survived')); }, 20_000);
  })]).finally(() => clearTimeout(timer!));
  assert.notEqual(code, 0); assert.match(output, expected);
}
test('typos, conflicting mode, invalid ports and implicit public binds fail closed', async () => {
  await failsToStart('server.ts', [], { NODE_ENV: 'prodution' }, /Unsupported NODE_ENV/);
  await failsToStart('server.ts', ['--mode', 'development'], { NODE_ENV: 'production' }, /conflicts/);
  await failsToStart('server.ts', ['--port', 'nope'], {}, /integer/);
  await failsToStart('server.ts', ['--mode', 'development', '--host', '0.0.0.0'], {}, /loopback/);
  await failsToStart('node_modules/vite/bin/vite.js', ['--host', '0.0.0.0'], {}, /loopback/);
});

test('network opt-in accepts only the configured exact host and preserves file restrictions', async () => {
  const network = await start('server.ts', ['--mode', 'development'], { DEV_SERVER_ALLOW_NETWORK: 'true', VITE_ALLOWED_HOSTS: 'tunnel.example.test', APP_URL: 'https://tunnel.example.test' }, '/api/health', '0.0.0.0');
  assert.equal((await raw(network.port, '/', { Host: 'tunnel.example.test', Origin: 'https://tunnel.example.test' })).status, 200);
  assert.equal((await raw(network.port, '/', { Host: 'other.example.test' })).status, 403);
  assert.equal((await raw(network.port, '/server.ts?raw', { Host: 'tunnel.example.test' })).status, 403);
});

test('disabled HMR leaves no usable WebSocket upgrade on the HTTP listener', async () => {
  const disabled = await start('server.ts', ['--mode', 'development'], { DISABLE_HMR: 'true' });
  try {
    assert.equal((await raw(disabled.port, '/src/main.tsx')).status, 200);
    const response = await new Promise<string>((resolve, reject) => {
      const socket = connect(disabled.port, '127.0.0.1', () => socket.write([
        'GET / HTTP/1.1', `Host: localhost:${disabled.port}`, `Origin: http://localhost:${disabled.port}`, 'Connection: Upgrade',
        'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Protocol: vite-ping', '', '',
      ].join('\r\n')));
      let data = ''; socket.on('data', chunk => { data += chunk; }); socket.on('end', () => resolve(data)); socket.on('error', reject);
      socket.setTimeout(5000, () => socket.destroy(new Error('Unexpected WebSocket listener')));
    });
    assert.match(response, /^HTTP\/1.1 403/);
  } finally { disabled.child.kill('SIGTERM'); }
});

test('E2E server ignores network opt-in and rejects external hosts on simulated endpoints', async () => {
  const port = await availablePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/e2e-server.ts'], {
    cwd: root, env: { ...env, E2E_PORT: String(port), DEV_SERVER_ALLOW_NETWORK: 'true', VITE_ALLOWED_HOSTS: 'external.example.test' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  try {
    const until = Date.now() + 30_000;
    while (true) {
      const status = await raw(port, '/__e2e/health').then(r => r.status).catch(() => 0);
      if (status === 200) break;
      if (Date.now() > until || child.exitCode !== null) throw new Error('E2E server failed to initialize');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal((await raw(port, '/__e2e/health', { Host: 'external.example.test' })).status, 403);
    assert.equal((await raw(port, '/src/server/firebaseAdmin.ts?raw')).status, 403);
  } finally { child.kill('SIGTERM'); }
});

test('build rejects E2E publishing and private server imports', async () => {
  await failsToStart('node_modules/vite/bin/vite.js', ['build'], { VITE_E2E_MODE: 'true' }, /VITE_E2E_MODE cannot/);
  const probe = await put(`src/${name}-import.ts`, `import value from '../server.ts?raw'; export default value;`);
  const { build } = await import('vite');
  await assert.rejects(build({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'silent',
    build: { write: false, rollupOptions: { input: probe } },
  }), /Private or unsupported file/);
  const bundle = await readFile(path.join(root, 'dist/index.html'), 'utf8');
  assert.ok(!bundle.includes('E2EHarness'));
});
