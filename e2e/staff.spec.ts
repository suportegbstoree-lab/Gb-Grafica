import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('designer only sees permitted areas and has a product editor without commercial fields', async ({ page }) => {
  await page.goto('/__e2e/admin?role=designer');
  const nav = page.getByRole('navigation', { name: 'Seções administrativas' });
  for (const label of ['Produtos', 'Pedidos', 'Identidade Visual', 'Fontes']) await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible();
  for (const label of ['Categorias', 'Promoções', 'Configurações', 'Funcionários']) await expect(nav.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Novo Produto', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Excluir Carimbo', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Editar Carimbo', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar arte do produto', exact: true });
  for (const field of ['Nome do Produto', 'Descrição', 'Categoria', 'Preço Base (Texto)']) await expect(editor.getByLabel(field, { exact: true })).toHaveCount(0);
  await editor.getByLabel('Enviar imagem principal', { exact: true }).setInputFiles({ name: 'capa.png', mimeType: 'image/png', buffer: await readFile('e2e/fixtures/editor-cover.png') });
  await editor.getByLabel('Tipo de personalização', { exact: true }).selectOption('texto_arte');
  await editor.getByLabel('Rótulo do texto', { exact: true }).fill('Seu nome');
  await editor.getByRole('button', { name: 'Salvar arte do produto', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const products = JSON.parse(await page.getByTestId('e2e-products').textContent() || '[]');
  const product = products.find((value: { id: string }) => value.id === '1yi50l93z');
  expect(product).toEqual(expect.objectContaining({ nome: 'Carimbo', desc: 'Carimbo personalizado', categoria: 'Personalizados', preco_base: '8,40', tipoInput: 'texto_arte', labelTexto: 'Seu nome' }));
  expect(product.imagem).toMatch(/^https:\/\/example.com\//);
});

test('designer can inspect and export artwork but production transitions remain read-only', async ({ page }) => {
  await page.goto('/__e2e/admin?role=designer');
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await expect(page.getByLabel('Andamento do pedido GB-E2E-PAGO')).toBeDisabled();
  await page.getByRole('button', { name: 'Abrir modelo composto', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true });
  await expect(viewer.getByRole('button', { name: 'Baixar PDF', exact: true })).toBeVisible();
});

test('product manager has the full product form and promotion/category areas without private order access', async ({ page }) => {
  await page.goto('/__e2e/admin?role=product-manager');
  const nav = page.getByRole('navigation', { name: 'Seções administrativas' });
  for (const label of ['Produtos', 'Categorias', 'Promoções']) await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible();
  for (const label of ['Pedidos', 'Funcionários', 'Configurações', 'Fontes', 'Identidade Visual']) await expect(nav.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Editar Carimbo', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar Produto', exact: true });
  await expect(editor.getByLabel('Nome do Produto', { exact: true })).toBeVisible();
  await expect(editor.getByLabel('Preço Base (Texto)', { exact: true })).toBeVisible();
});

test('administrator assigns registered email, edits role permissions and sees pending email status', async ({ page }) => {
  await page.goto('/__e2e/admin');
  await page.getByRole('button', { name: 'Funcionários', exact: true }).click();
  await page.getByLabel('E-mail cadastrado', { exact: true }).fill('designer@example.com');
  await page.getByLabel('Função', { exact: true }).selectOption('designer');
  await page.getByRole('button', { name: 'Aplicar função', exact: true }).click();
  await expect(page.getByLabel('Função de designer@example.com')).toHaveValue('designer');
  await expect(page.getByText(/aviso está pendente porque o envio de e-mail não foi configurado/)).toBeVisible();
  const permission = page.getByLabel('Designer: Alterar etapas de produção e envio', { exact: true });
  await expect(permission).not.toBeChecked(); await permission.check();
  await expect(page.getByRole('button', { name: 'Aplicar função', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Salvar permissões de Designer', exact: true }).click();
  await expect(permission).toBeChecked();
  await expect(page.getByRole('button', { name: 'Aplicar função', exact: true })).toBeEnabled();
  await page.getByLabel('Função de admin@example.com', { exact: true }).selectOption('none');
  await expect(page.getByRole('alert')).toContainText('Sua própria função administrativa não pode ser removida');
});

test('separate branding and font tabs preserve commercial configuration', async ({ page }) => {
  await page.goto('/__e2e/admin');
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Identidade visual e banner', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Gerenciar fontes', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Identidade Visual', exact: true }).click();
  await page.getByLabel('Título do Banner', { exact: true }).fill('Nova identidade');
  await page.getByRole('button', { name: 'Salvar identidade visual', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Configurações salvas');
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await expect(page.getByLabel('Razão social ou nome completo', { exact: true })).toHaveValue('GB Gráfica Teste');
  await expect(page.getByLabel('E-mail de privacidade/LGPD', { exact: true })).toHaveValue('privacidade@example.com');
  await page.getByRole('button', { name: 'Fontes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Gerenciar fontes', exact: true })).toBeVisible();
});

test.describe('staff panel on mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('role controls and restricted editor fit the screen', async ({ page }) => {
    await page.goto('/__e2e/admin?role=designer');
    await page.getByRole('button', { name: 'Editar Carimbo', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Editar arte do produto', exact: true });
    await expect(editor).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await page.keyboard.press('Escape'); await expect(editor).toHaveCount(0);
    await page.goto('/__e2e/admin'); await page.getByRole('button', { name: 'Funcionários', exact: true }).click();
    await expect(page.getByLabel('E-mail cadastrado', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  });
});
