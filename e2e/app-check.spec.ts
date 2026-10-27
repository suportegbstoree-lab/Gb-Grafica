import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    appCheckFixture: {
      provider(force?: boolean): Promise<string | null>;
      warnings: string[];
      request(): Promise<{ status: number; body: { verified?: boolean } }>;
      generate(): Promise<string>;
      readDocument(): Promise<boolean>;
      readFile(): Promise<number>;
      login(): Promise<string>;
    };
  }
}

function jwt(sequence: number, now: number, claims: Record<string, unknown> = {}): string {
  return [
    Buffer.from('{"alg":"RS256","typ":"JWT"}').toString('base64url'),
    Buffer.from(JSON.stringify({ iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600, sub: '1:123:web:abc123', seq: sequence, ...claims })).toString('base64url'),
    'fake-signature-for-browser-test',
  ].join('.');
}

async function prepare(page: Page, failExchange = false) {
  const exchanges: { limited?: boolean; token: string }[] = [];
  const requests: string[] = [];
  const violations: string[] = [];
  page.on('console', message => { if (message.text().includes('Content Security Policy')) violations.push(message.text()); });
  // Nenhuma chamada Google/Firebase chega ao projeto real.
  await page.route('https://www.google.com/recaptcha/**', route => route.fulfill({
    contentType: 'application/javascript', body: `
      window.grecaptcha = { enterprise: {
        ready(callback) { callback(); },
        render(_element, options) { window.testRecaptchaOptions = options; options.callback(); return 1; },
        execute() { return Promise.resolve('recaptcha-ficticio'); }
      }};
    `,
  }));
  await page.route('https://**.googleapis.com/**', async route => {
    const request = route.request();
    if (request.url().includes('exchangeRecaptchaEnterpriseToken') || request.url().includes('exchangeDebugToken')) {
      if (failExchange) return route.fulfill({ status: 403, json: { error: { message: 'assessment-invalid-test-only' } } });
      const body = request.postDataJSON();
      if (request.url().includes('exchangeDebugToken')) expect(typeof body.debug_token).toBe('string');
      else expect(body.recaptcha_enterprise_token).toBe('recaptcha-ficticio');
      const value = jwt(exchanges.length + 1, await page.evaluate(() => Date.now()));
      exchanges.push({ limited: body.limited_use, token: value });
      return route.fulfill({ json: { token: value, ttl: '3600s' } });
    }
    const attestation = request.headers()['x-firebase-appcheck'];
    requests.push(attestation ?? '');
    expect(exchanges.some(exchange => exchange.token === attestation)).toBeTruthy();
    if (request.url().includes(':generateContent')) return route.fulfill({ json: { candidates: [{ content: { role: 'model', parts: [{ text: 'Resposta fictícia' }] }, finishReason: 'STOP' }] } });
    if (request.url().includes('accounts:lookup')) return route.fulfill({ json: { users: [{ localId: 'test-user', providerUserInfo: [], createdAt: '1760000000000', lastLoginAt: '1760000000000' }] } });
    if (request.url().includes('identitytoolkit')) return route.fulfill({ json: { idToken: jwt(1000, Date.now(), { sub: 'test-user', user_id: 'test-user', auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'custom' } }), refreshToken: 'fake-refresh', expiresIn: '3600', localId: 'test-user' } });
    if (request.url().includes('firestore') && request.url().includes(':commit')) {
      return route.fulfill({ json: { commitTime: '2026-01-01T00:00:00Z', writeResults: [{}] } });
    }
    if (request.url().includes('firestore')) {
      const transaction = request.postDataJSON();
      expect(transaction.documents).toHaveLength(1);
      return route.fulfill({ json: [{ found: { name: transaction.documents[0], fields: { ok: { booleanValue: true } }, createTime: '2026-01-01T00:00:00Z', updateTime: '2026-01-01T00:00:00Z' }, readTime: '2026-01-01T00:00:00Z' }] });
    }
    if (request.url().includes('firebasestorage')) return route.fulfill({ contentType: 'application/octet-stream', body: Buffer.from([1, 2, 3]) });
    throw new Error(`Endpoint Google inesperado no teste: ${new URL(request.url()).hostname}`);
  });
  await page.route('**/api/app-check/status', route => {
    const value = route.request().headers()['x-firebase-appcheck'];
    requests.push(value ?? '');
    return route.fulfill({ json: { mode: 'monitor', verified: exchanges.some(exchange => exchange.token === value) } });
  });
  return { exchanges, requests, violations };
}

async function openFixture(page: Page, query = '') {
  await page.goto(`/__e2e/app-check${query}`);
  await page.waitForFunction(() => Boolean(window.appCheckFixture));
}

test('SDK Enterprise real emite, reutiliza cache e envia o token sob a CSP publicada', async ({ page }) => {
  const state = await prepare(page);
  await openFixture(page);
  const first = await page.evaluate(() => window.appCheckFixture.provider());
  expect(first).toBeTruthy();
  expect(await page.evaluate(() => window.appCheckFixture.provider())).toBe(first);
  expect(state.exchanges).toHaveLength(1);
  expect(await page.evaluate(() => window.appCheckFixture.request())).toEqual({ status: 200, body: { mode: 'monitor', verified: true } });
  expect(state.requests.at(-1)).toBe(first);
  expect(state.violations).toEqual([]);
});

test('SDK renova automaticamente a sessão antes de o token expirar', async ({ page }) => {
  await page.clock.install();
  const state = await prepare(page);
  await openFixture(page);
  const first = await page.evaluate(() => window.appCheckFixture.provider());
  await expect.poll(() => state.exchanges.length).toBe(1);
  await page.clock.fastForward(40 * 60 * 1000);
  await expect.poll(() => state.exchanges.length).toBeGreaterThan(1);
  expect(await page.evaluate(() => window.appCheckFixture.provider())).not.toBe(first);
  expect(state.violations).toEqual([]);
});

test('ao retomar uma aba com token expirado o SDK obtém uma sessão nova', async ({ page }) => {
  await page.clock.install();
  const state = await prepare(page);
  await openFixture(page);
  const first = await page.evaluate(() => window.appCheckFixture.provider());
  const later = await page.evaluate(() => Date.now() + 2 * 60 * 60 * 1000);
  // Avança o relógio sem executar timers, simulando uma aba suspensa.
  await page.clock.setSystemTime(later);
  expect(await page.evaluate(() => window.appCheckFixture.provider())).not.toBe(first);
  expect(state.exchanges).toHaveLength(2);
});

test('chamadas concorrentes compartilham a aquisição do token pelo SDK', async ({ page }) => {
  const state = await prepare(page);
  await openFixture(page);
  const values = await page.evaluate(() => Promise.all(Array.from({ length: 8 }, () => window.appCheckFixture.provider())));
  expect(values.every(value => value && value === values[0])).toBe(true);
  expect(state.exchanges).toHaveLength(1);
});

test('debug local usa o provedor oficial e é recusado fora do modo de desenvolvimento', async ({ page }) => {
  const state = await prepare(page);
  await openFixture(page, '?debug&development');
  expect(await page.evaluate(() => window.appCheckFixture.provider())).toBeTruthy();
  expect(state.exchanges.length).toBeGreaterThan(0);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/__e2e/app-check?debug');
  await expect.poll(() => errors.join('')).toContain('depuração do App Check só é permitida');
});

test('rejeição do middleware força um novo atestado e uma única repetição', async ({ page }) => {
  const state = await prepare(page);
  let attempts = 0;
  await page.route('**/api/app-check/status', route => {
    attempts++;
    return route.fulfill(attempts === 1
      ? { status: 401, json: { code: 'APP_CHECK_INVALID' } }
      : { json: { verified: true } });
  });
  await openFixture(page);
  expect((await page.evaluate(() => window.appCheckFixture.request())).status).toBe(200);
  expect(attempts).toBe(2);
  expect(state.exchanges).toHaveLength(2);
});

test('Firebase AI usa um token de uso limitado novo em cada geração', async ({ page }) => {
  const state = await prepare(page);
  await openFixture(page);
  expect(await page.evaluate(() => window.appCheckFixture.generate())).toBe('Resposta fictícia');
  expect(await page.evaluate(() => window.appCheckFixture.generate())).toBe('Resposta fictícia');
  expect(state.exchanges.filter(exchange => exchange.limited)).toHaveLength(2);
  expect(state.requests.at(-1)).not.toBe(state.requests.at(-2));
  expect(state.violations).toEqual([]);
});

test('Firestore, Storage e Auth recebem o atestado da mesma instância Firebase', async ({ page }) => {
  const state = await prepare(page);
  await openFixture(page);
  expect(await page.evaluate(() => window.appCheckFixture.readDocument())).toBe(true);
  expect(await page.evaluate(() => window.appCheckFixture.readFile())).toBe(3);
  expect(await page.evaluate(() => window.appCheckFixture.login())).toBe('test-user');
  expect(state.requests.length).toBeGreaterThanOrEqual(3);
  expect(state.requests.every(Boolean)).toBe(true);
  expect(state.violations).toEqual([]);
});

test('falha na avaliação não gera um token fictício válido nem expõe a resposta do provedor', async ({ page }) => {
  await prepare(page, true);
  await openFixture(page);
  expect(await page.evaluate(() => window.appCheckFixture.provider())).toBeNull();
  expect(await page.evaluate(() => window.appCheckFixture.warnings)).toEqual(['[App Check] Não foi possível validar esta sessão do navegador.']);
  expect((await page.evaluate(() => window.appCheckFixture.request())).body.verified).toBe(false);
});

test('sem site key o teste não solicita atestado nem bloqueia a montagem', async ({ page }) => {
  const state = await prepare(page);
  await openFixture(page, '?no-key');
  expect(await page.evaluate(() => window.appCheckFixture.provider())).toBeNull();
  expect(state.exchanges).toHaveLength(0);
});

test('bloqueio do script reCAPTCHA termina em erro controlado sem travar a chamada', async ({ page }) => {
  await prepare(page);
  await page.route('https://www.google.com/recaptcha/**', route => route.abort());
  await openFixture(page, '?short-timeout');
  expect(await page.evaluate(() => window.appCheckFixture.provider())).toBeNull();
  expect(await page.evaluate(() => window.appCheckFixture.warnings)).toEqual(['[App Check] Não foi possível validar esta sessão do navegador.']);
});
