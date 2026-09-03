import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const publicRoutes = [
  '/',
  '/sobre-nos',
  '/politica-de-privacidade',
  '/termos-de-uso',
  '/trocas-cancelamentos-e-reembolsos',
  '/prazos-de-producao',
  '/artes-personalizadas',
  '/lgpd',
];

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Não foi possível reservar uma porta para o smoke test.'));
        return;
      }
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForServer(baseUrl: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // O processo ainda está inicializando.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('O servidor de produção não ficou disponível a tempo.');
}

const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
let serverOutput = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts', '--port', String(port), '--host', '127.0.0.1'], {
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
child.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

try {
  await waitForServer(baseUrl);

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.match(health.headers.get('content-type') || '', /application\/json/);
  assert.match(health.headers.get('cache-control') || '', /no-store/);
  const healthBody = await health.json() as { status?: unknown };
  assert.equal(healthBody.status, 'ok');

  let homeHtml = '';
  for (const route of publicRoutes) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 200, `${route} deve responder 200`);
    assert.match(response.headers.get('content-type') || '', /text\/html/, `${route} deve entregar HTML`);
    const html = await response.text();
    assert.match(html, /<div id="root"><\/div>/, `${route} deve entregar o shell React`);
    if (route === '/') homeHtml = html;
  }

  const entryAsset = homeHtml.match(/<script[^>]+src="(\/assets\/index-[^"]+\.js)"/)?.[1];
  assert.ok(entryAsset, 'o HTML deve referenciar o bundle principal versionado');
  assert.match(homeHtml, /<link rel="canonical" href="https:\/\/www\.gblgrafica\.com\.br\/"/);
  assert.match(homeHtml, /<meta property="og:image"/);
  assert.doesNotMatch(homeHtml, /<link[^>]+rel="stylesheet"/, 'o CSS deve continuar incorporado ao bundle principal');
  const asset = await fetch(`${baseUrl}${entryAsset}`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control') || '', /max-age=31536000/);
  assert.match(asset.headers.get('cache-control') || '', /immutable/);
  assert.match(await asset.text(), /gb-app-styles/, 'o bundle principal deve montar a folha de estilos da aplicação');

  const robots = await fetch(`${baseUrl}/robots.txt`);
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /Sitemap: https:\/\/www\.gblgrafica\.com\.br\/sitemap\.xml/);

  const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
  assert.equal(sitemap.status, 200);
  assert.match(await sitemap.text(), /<loc>https:\/\/www\.gblgrafica\.com\.br\/politica-de-privacidade<\/loc>/);

  console.log(`Smoke test aprovado: saúde, ${publicRoutes.length} rotas públicas, robots.txt e sitemap.xml.`);
} catch (error) {
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 2_000)),
  ]);
}
