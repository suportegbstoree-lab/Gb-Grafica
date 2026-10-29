import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('real development server updates the browser through HMR on its own HTTP port', async ({ page }) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const name = `security-hmr-${randomUUID().replaceAll('-', '')}.ts`;
  const target = path.join(root, 'src', name);
  const source = (version: string) => `document.getElementById('root').textContent = ${JSON.stringify(version)}; if (import.meta.hot) import.meta.hot.accept(); export const value = ${JSON.stringify(version)};`;
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('No port available');
  const port = address.port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  let child: ChildProcess | undefined;
  let output = '';
  const socketUrls: string[] = [];
  try {
    await writeFile(target, source('HMR initial'));
    child = spawn(process.execPath, ['--import', 'tsx', 'server.ts', '--mode', 'development', '--port', String(port)], {
      cwd: root, env: { ...process.env, NODE_ENV: 'development', VITE_E2E_MODE: '', DISABLE_HMR: '', DEV_SERVER_ALLOW_NETWORK: 'false', VITE_ALLOWED_HOSTS: '', LOG_LEVEL: 'silent' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr?.on('data', chunk => { output += chunk; });
    child.stdout?.on('data', chunk => { output += chunk; });
    const base = `http://127.0.0.1:${port}`;
    await expect.poll(async () => {
      if (child!.exitCode !== null) throw new Error(output.slice(-2000));
      return fetch(`${base}/api/health`).then(r => r.status).catch(() => 0);
    }, { timeout: 30_000 }).toBe(200);
    // Mount a harmless module: this test does not initialize the real Firebase app.
    await page.route('**/src/main.tsx', route => route.fulfill({ contentType: 'application/javascript', body: `import '/src/${name}';` }));
    page.on('websocket', socket => socketUrls.push(socket.url()));
    await page.goto(base);
    await expect(page.locator('#root')).toHaveText('HMR initial');
    await expect.poll(() => socketUrls.length).toBeGreaterThan(0);
    await writeFile(target, source('HMR updated'));
    await expect(page.locator('#root')).toHaveText('HMR updated', { timeout: 15_000 });
    for (const url of socketUrls) expect(new URL(url).port).toBe(String(port));
  } finally {
    child?.kill('SIGTERM');
    await rm(target, { force: true });
  }
});
