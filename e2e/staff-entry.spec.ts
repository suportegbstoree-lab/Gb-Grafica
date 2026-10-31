import { expect, test } from '@playwright/test';

test('a staff account gets the store panel entry and only its permitted sections', async ({ page }) => {
  await page.goto('/__e2e/team?role=product-manager');
  await page.getByRole('link', { name: 'Área Admin', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const nav = page.getByRole('navigation', { name: 'Seções administrativas' });
  for (const name of ['Produtos', 'Categorias', 'Promoções']) await expect(nav.getByRole('button', { name, exact: true })).toBeVisible();
  for (const name of ['Pedidos', 'Funcionários', 'Configurações', 'Fontes', 'Identidade Visual']) await expect(nav.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByText('Pedidos Recebidos', { exact: true })).toHaveCount(0);
  await expect(page.getByText('GB-E2E-PAGO', { exact: false })).toHaveCount(0);
});

test('direct panel navigation waits for the policy before making an access decision', async ({ page }) => {
  await page.goto('/__e2e/team/admin?permissions=fonts.manage&delay');
  await expect(page.getByRole('heading', { name: 'Verificando acesso ao painel', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Esta conta não possui uma seção liberada', exact: true })).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: 'Seções administrativas' });
  await expect(nav.getByRole('button', { name: 'Fontes', exact: true })).toBeVisible();
  await expect(nav.getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Fontes da personalização', exact: true, level: 2 })).toBeVisible();
});

test('an assigned account with an old session can find the sign-in instruction and refresh by signing in', async ({ page }) => {
  await page.goto('/__e2e/team?stale');
  await expect(page.getByRole('link', { name: 'Área Admin', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Verificar acesso', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entre novamente para atualizar seu acesso', exact: true })).toBeVisible();
  await expect(page.getByText('cliente@example.com', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Entrar novamente', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Seções administrativas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pedidos', exact: true })).toHaveCount(0);
});

test('missing permissions and errors show a useful gate without revealing administrative data', async ({ page }) => {
  await page.goto('/__e2e/team/admin?none');
  await expect(page.getByRole('heading', { name: 'Esta conta não possui uma seção liberada', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Seções administrativas' })).toHaveCount(0);
  await page.goto('/__e2e/team/admin?fail');
  await expect(page.getByRole('heading', { name: 'Não foi possível verificar seu acesso', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Seções administrativas' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Verificar acesso novamente', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Seções administrativas' })).toBeVisible();
});

test('revoking order permission removes the open section and its viewer in the same signed-in session', async ({ page }) => {
  await page.goto('/__e2e/team/admin?role=designer');
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir modelo composto', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Modelo personalizado', exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('e2e:staff-policy', { detail: ['fonts.manage'] })));
  await expect(page.getByRole('button', { name: 'Pedidos', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Pedidos Recebidos', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Modelo personalizado', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Seções administrativas' }).getByRole('button')).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event('e2e:staff-revoke')));
  await expect(page.getByRole('navigation', { name: 'Seções administrativas' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Esta conta não possui uma seção liberada', exact: true })).toBeVisible();
});

test('an unauthenticated visitor signs in on the panel and all unpermitted tabs remain absent', async ({ page }) => {
  await page.goto('/__e2e/team/admin?guest&permissions=branding.manage');
  await expect(page.getByRole('heading', { name: 'Entrar no painel da equipe', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Entrar com Google', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Seções administrativas' });
  await expect(nav.getByRole('button', { name: 'Identidade Visual', exact: true })).toBeVisible();
  await expect(nav.getByRole('button')).toHaveCount(1);
});
