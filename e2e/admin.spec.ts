import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/__e2e/admin');
  await expect(page.getByTestId('e2e-admin')).toBeAttached();
});

test('mantém o foco e permite digitação contínua no cadastro de produto', async ({ page }) => {
  await page.getByRole('button', { name: 'Novo Produto' }).click();
  const editor = page.getByRole('dialog', { name: 'Novo Produto' });
  const productName = editor.getByLabel('Nome do Produto');

  await productName.click();
  for (const character of 'Produto completo') {
    await page.keyboard.type(character);
    await expect(productName).toBeFocused();
  }

  await expect(productName).toHaveValue('Produto completo');
});

test('cadastra e preserva peso e embalagem ao reabrir o produto', async ({ page }) => {
  await page.getByRole('button', { name: 'Editar Carimbo', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar Produto' });
  // A imagem data: da fixture não é uma URL de catálogo persistível.
  await editor.getByLabel('Imagem Principal (URL)').fill('/logo.png');
  await editor.getByRole('button', { name: 'Cadastrar peso e embalagem' }).click();
  await editor.getByLabel('Peso por unidade vendida (g)').fill('300');
  await editor.getByLabel('Peso da embalagem vazia (g)').fill('150');
  await editor.getByLabel('Comprimento externo (cm)').fill('25');
  await editor.getByLabel('Largura externa (cm)').fill('20');
  await editor.getByLabel('Altura externa (cm)').fill('15');
  await editor.getByLabel('Unidades que cabem por volume').fill('2');
  await editor.getByRole('button', { name: 'Salvar Produto', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Editar Carimbo', exact: true }).click();
  await expect(editor.getByLabel('Peso por unidade vendida (g)')).toHaveValue('300');
  await expect(editor.getByLabel('Unidades que cabem por volume')).toHaveValue('2');
});

test('envia imagem principal e galeria pelo computador', async ({ page }) => {
  await page.getByRole('button', { name: 'Novo Produto' }).click();
  const editor = page.getByRole('dialog', { name: 'Novo Produto' });

  await editor.getByLabel('Selecionar imagem principal do computador').setInputFiles({
    name: 'capa.png',
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  await expect(editor.getByLabel('Imagem Principal (URL)')).toHaveValue(/^https:\/\/example\.com\//);
  await expect(editor.getByAltText('Prévia da imagem principal')).toBeVisible();

  await editor.getByLabel('Adicionar imagens do computador à galeria').setInputFiles({
    name: 'detalhe.webp',
    mimeType: 'image/webp',
    buffer: Buffer.from('RIFF0000WEBP'),
  });
  await expect(editor.locator('img[src^="https://example.com/"]')).toHaveCount(2);
});

test('permite cadastrar produto com texto e imagem', async ({ page }) => {
  await page.getByRole('button', { name: 'Novo Produto' }).click();
  const editor = page.getByRole('dialog', { name: 'Novo Produto' });
  await editor.getByLabel('Tipo de Personalização').selectOption('texto_arte');
  await expect(editor.getByLabel('Rótulo do Texto')).toBeVisible();
  await editor.getByLabel('Rótulo do Texto').fill('Nome para a capa');
  await expect(editor.getByLabel('Tipo de Personalização')).toHaveValue('texto_arte');
  await expect(editor.getByLabel('Rótulo do Texto')).toHaveValue('Nome para a capa');
});

test('mantém os quatro comandos de IA e a aprovação da sugestão no editor existente', async ({ page }) => {
  // Sessão fictícia somente neste navegador de teste. O servidor tem sua própria suíte de autorização.
  await page.evaluate(async () => {
    const modulePath = '/src/firebase.ts';
    const { auth } = await import(modulePath);
    await auth.authStateReady();
    Object.defineProperty(auth, 'currentUser', { value: { getIdToken: async () => 'e2e-admin-ai-token' }, configurable: true });
  });
  const requests: Record<string, string>[] = [];
  await page.route('**/api/admin/ai/suggestions', route => {
    expect(route.request().headers().authorization).toBe('Bearer e2e-admin-ai-token');
    const body = route.request().postDataJSON();
    requests.push(body);
    return route.fulfill({ json: { text: `Sugestão ${body.action}` } });
  });
  await page.getByRole('button', { name: 'Novo Produto' }).click();
  const editor = page.getByRole('dialog', { name: 'Novo Produto' });
  await editor.getByLabel('Nome do Produto').fill('Caneca');
  await editor.getByLabel('Descrição', { exact: true }).fill('Descrição original');

  await editor.getByRole('button', { name: 'Melhorar com IA', exact: true }).first().click();
  let preview = page.getByRole('dialog', { name: 'Sugestão da IA' });
  await expect(preview).toContainText('Sugestão improveTitle');
  await preview.getByRole('button', { name: 'Aprovar e Usar' }).click();
  await expect(editor.getByLabel('Nome do Produto')).toHaveValue('Sugestão improveTitle');

  await editor.getByRole('button', { name: 'Gerar da IA', exact: true }).click();
  preview = page.getByRole('dialog', { name: 'Sugestão da IA' });
  await expect(preview).toContainText('Sugestão generate');
  await preview.getByRole('button', { name: 'Aprovar e Usar' }).click();
  await expect(editor.getByLabel('Descrição', { exact: true })).toHaveValue('Sugestão generate');

  await editor.getByRole('button', { name: 'Melhorar com IA', exact: true }).last().click();
  preview = page.getByRole('dialog', { name: 'Sugestão da IA' });
  await expect(preview).toContainText('Sugestão improveDescription');
  await preview.getByRole('button', { name: 'Aprovar e Usar' }).click();
  await expect(editor.getByLabel('Descrição', { exact: true })).toHaveValue('Sugestão improveDescription');

  await editor.getByRole('button', { name: 'Comando IA', exact: true }).click();
  const custom = page.getByRole('dialog', { name: 'Comando Personalizado' });
  await custom.locator('textarea').fill('Use um tom informal');
  await custom.getByRole('button', { name: 'Gerar Descrição', exact: true }).click();
  preview = page.getByRole('dialog', { name: 'Sugestão da IA' });
  await expect(preview).toContainText('Sugestão custom');
  await preview.getByRole('button', { name: 'Aprovar e Usar' }).click();
  await expect(editor.getByLabel('Descrição', { exact: true })).toHaveValue('Sugestão custom');
  expect(requests).toEqual([
    { action: 'improveTitle', title: 'Caneca' },
    { action: 'generate', title: 'Sugestão improveTitle' },
    { action: 'improveDescription', description: 'Sugestão generate' },
    { action: 'custom', title: 'Sugestão improveTitle', prompt: 'Use um tom informal' },
  ]);
});

test('recusa da API de IA preserva o texto digitado e mantém o editor utilizável', async ({ page }) => {
  await page.evaluate(async () => {
    const modulePath = '/src/firebase.ts';
    const { auth } = await import(modulePath);
    await auth.authStateReady();
    Object.defineProperty(auth, 'currentUser', { value: { getIdToken: async () => 'e2e-admin-ai-token' }, configurable: true });
  });
  await page.route('**/api/admin/ai/suggestions', route => route.fulfill({
    status: 403, json: { code: 'ACCESS_DENIED', error: 'Você não tem permissão para esta operação.' },
  }));
  await page.getByRole('button', { name: 'Novo Produto' }).click();
  const editor = page.getByRole('dialog', { name: 'Novo Produto' });
  await editor.getByLabel('Nome do Produto').fill('Caneca');
  await editor.getByLabel('Descrição', { exact: true }).fill('Texto que deve permanecer');
  await editor.getByRole('button', { name: 'Gerar da IA', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('permissão');
  await expect(page.getByRole('dialog', { name: 'Sugestão da IA' })).toHaveCount(0);
  await expect(editor.getByLabel('Descrição', { exact: true })).toHaveValue('Texto que deve permanecer');
  await editor.getByLabel('Descrição', { exact: true }).fill('Posso continuar editando');
  await expect(editor.getByLabel('Descrição', { exact: true })).toHaveValue('Posso continuar editando');
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
  await page.getByRole('button', { name: 'Identidade Visual' }).click();
  await page.getByLabel('Título do Banner', { exact: true }).fill('Título ainda não salvo');
  await page.getByRole('button', { name: 'Produtos' }).click();

  const confirmation = page.getByRole('alertdialog', { name: 'Sair sem salvar?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Voltar' }).click();
  await expect(page.getByRole('heading', { name: 'Identidade Visual', exact: true })).toBeVisible();

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
  await editor.getByText('Usar URL externa').click();
  await editor.getByLabel('URL externa do banner da promoção').fill('javascript:alert(1)');
  await editor.getByRole('button', { name: 'Salvar Promoção' }).click();
  await expect(page.getByRole('alert')).toContainText('URL inválida');

  await editor.getByLabel('URL externa do banner da promoção').fill('/logo.png');
  await editor.getByLabel('Produto').selectOption('1yi50l93z');
  await editor.getByLabel('Desconto (%)').fill('15');
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
