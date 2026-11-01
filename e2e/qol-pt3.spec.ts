import { expect, test } from '@playwright/test';

test('theme is a single persistent button with a fixed palette and no settings panel', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => { if (!localStorage.getItem('gb_theme')) localStorage.setItem('gb_theme', JSON.stringify({ mode: 'light', color: '#123456' })); });
  await page.goto('/__e2e/store');
  await expect(page.getByLabel('Cor do modo escuro')).toHaveCount(0);
  await expect(page.getByLabel('Tema da loja')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-store-theme', 'dark');
  await expect(page.locator('html')).toHaveCSS('--store-base', '#111111');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gb_theme') || '{}'))).toEqual({ mode: 'dark' });
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-store-theme', 'dark');
});

test('operations uses team activity and removed modules have neither navigation nor API access', async ({ page }) => {
  await page.goto('/admin/operations');
  const nav = page.getByRole('navigation', { name: 'Páginas de operações' });
  for (const name of ['Erros', 'Equipamentos', 'Versões']) await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(0);
  await expect(page.getByText('Atividades concluídas', { exact: true })).toBeVisible();
  for (const path of ['/errors', '/machines', '/releases']) expect(await page.evaluate(async path => (await fetch(`/api/admin/operations${path}`, { headers: { Authorization: 'Bearer e2e-operations' } })).status, path)).toBe(404);
  await page.goto('/admin/operations/releases'); await expect(page.getByText('Página não encontrada.', { exact: true })).toBeVisible();
});

test('administrator creates a named role, assigns an employee name, and edits it independently', async ({ page }) => {
  await page.goto('/admin/staff');
  await page.getByLabel('Nome do novo cargo', { exact: true }).fill('Atendimento');
  await page.getByRole('button', { name: 'Criar cargo', exact: true }).click();
  const permission = page.getByRole('checkbox', { name: 'Atendimento: Gerenciar categorias', exact: true });
  await expect(permission).toBeVisible(); await permission.check();
  await page.getByRole('button', { name: 'Salvar permissões de Atendimento', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Aplicar função', exact: true })).toBeEnabled();
  await page.getByLabel('Nome do funcionário', { exact: true }).fill('Ana Teste');
  await page.getByLabel('E-mail cadastrado', { exact: true }).fill('designer@example.com');
  await page.getByLabel('Função', { exact: true }).selectOption({ label: 'Atendimento' });
  await page.getByRole('button', { name: 'Aplicar função', exact: true }).click();
  const name = page.getByLabel('Nome de designer@example.com', { exact: true });
  await expect(name).toHaveValue('Ana Teste'); await name.fill('Ana do Atendimento');
  await page.getByRole('button', { name: 'Salvar nome de designer@example.com', exact: true }).click();
  await expect(name).toHaveValue('Ana do Atendimento');
  await expect(page.getByLabel('Função de admin@example.com', { exact: true })).toBeDisabled();
});

test('a designer image change automatically reaches the operations report with employee and role', async ({ page }) => {
  await page.goto('/__e2e/admin?role=designer');
  await page.getByRole('button', { name: 'Editar Carimbo', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Editar arte do produto', exact: true });
  await modal.getByLabel('Imagem principal (URL)', { exact: true }).fill('/__e2e/cover.png?activity=1');
  await modal.getByRole('button', { name: 'Salvar arte do produto', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.goto('/admin/operations');
  await expect(page.getByRole('table').first()).toContainText('Designer Teste');
  await expect(page.getByRole('table').first()).toContainText('Designer');
  await expect(page.getByRole('table').last()).toContainText('Imagens do produto alteradas');
  await expect(page.getByRole('img', { name: 'Quantidade de atividades concluídas por dia', exact: true })).toBeVisible();
});
