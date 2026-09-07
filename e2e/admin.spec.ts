import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/__e2e/admin');
  await expect(page.getByTestId('e2e-admin')).toBeAttached();
});

test('avisa antes de descartar alterações de um produto', async ({ page }) => {
  await page.getByRole('button', { name: 'Novo Produto' }).click();
  const editor = page.getByRole('dialog', { name: 'Novo Produto' });
  await editor.getByLabel('Nome do Produto').fill('Produto não salvo');
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).last().click();

  const confirmation = page.getByRole('alertdialog', { name: 'Descartar alterações?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Voltar' }).click();
  await expect(editor).toBeVisible();

  await editor.getByRole('button', { name: 'Cancelar', exact: true }).last().click();
  await page.getByRole('alertdialog', { name: 'Descartar alterações?' })
    .getByRole('button', { name: 'Descartar' }).click();
  await expect(editor).toHaveCount(0);
});

test('valida duplicidade, cria e exclui produto com confirmação', async ({ page }) => {
  await page.getByRole('button', { name: 'Novo Produto' }).click();
  const editor = page.getByRole('dialog', { name: 'Novo Produto' });
  await editor.getByLabel('Nome do Produto').fill('Carimbo');
  await editor.getByLabel('Descrição').fill('Produto criado pelo teste de navegador.');
  await editor.getByLabel('Preço Base (Texto)').fill('19,90');
  await editor.getByLabel('Imagem Principal (URL)').fill('/logo.png');
  await editor.getByRole('button', { name: 'Salvar Produto' }).click();
  await expect(page.getByRole('alert')).toContainText('Já existe um produto com esse nome.');

  await editor.getByLabel('Nome do Produto').fill('Produto E2E');
  await editor.getByRole('button', { name: 'Salvar Produto' }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId('e2e-admin-action')).toContainText('set:anuncios:');
  await expect(page.getByRole('heading', { name: 'Produto E2E' })).toBeVisible();

  await page.getByRole('button', { name: 'Excluir Produto E2E' }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Excluir produto?' });
  await expect(confirmation).toContainText('Produto E2E');
  await confirmation.getByRole('button', { name: 'Excluir produto' }).click();
  await expect(page.getByRole('heading', { name: 'Produto E2E' })).toHaveCount(0);
  await expect(page.getByTestId('e2e-admin-action')).toContainText('delete:anuncios:');
});

test('protege configurações pendentes ao trocar de seção', async ({ page }) => {
  await page.getByRole('button', { name: 'Configurações' }).click();
  await page.getByLabel('Título do Banner', { exact: true }).fill('Título ainda não salvo');
  await page.getByRole('button', { name: 'Produtos' }).click();

  const confirmation = page.getByRole('alertdialog', { name: 'Sair sem salvar?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Voltar' }).click();
  await expect(page.getByRole('heading', { name: 'Configurações do Site' })).toBeVisible();

  await page.getByRole('button', { name: 'Produtos' }).click();
  await page.getByRole('alertdialog', { name: 'Sair sem salvar?' })
    .getByRole('button', { name: 'Sair sem salvar' }).click();
  await expect(page.getByRole('heading', { name: 'Gerenciar Produtos' })).toBeVisible();
});

test('rejeita promoção insegura e persiste uma promoção válida', async ({ page }) => {
  await page.getByRole('button', { name: 'Promoções' }).click();
  await page.getByRole('button', { name: 'Nova Promoção' }).click();
  const editor = page.getByRole('dialog', { name: 'Nova Promoção' });
  await editor.getByLabel('Título da Promoção').fill('Promoção E2E');
  await editor.getByLabel('Banner URL').fill('javascript:alert(1)');
  await editor.getByRole('button', { name: 'Salvar Promoção' }).click();
  await expect(page.getByRole('alert')).toContainText('URL inválida');

  await editor.getByLabel('Banner URL').fill('/logo.png');
  await editor.getByLabel('Link de Destino (Opcional)').fill('/#produtos');
  await editor.getByRole('button', { name: 'Salvar Promoção' }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByText('Promoção E2E', { exact: true })).toBeVisible();
  await expect(page.getByTestId('e2e-admin-action')).toContainText('set:promocoes:');
});

test.describe('painel em viewport móvel', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('mantém navegação e ações de produto acessíveis por toque', async ({ page }) => {
    const overflow = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
    await expect(page.getByRole('button', { name: 'Editar Carimbo' })).toBeVisible();
    await page.getByRole('button', { name: 'Editar Carimbo' }).click();
    await expect(page.getByRole('dialog', { name: 'Editar Produto' })).toBeVisible();
  });
});
