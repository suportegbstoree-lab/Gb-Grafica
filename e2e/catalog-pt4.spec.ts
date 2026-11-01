import { test, expect } from '@playwright/test';
test('vitrine tem cards uniformes e grade de três, duas e uma colunas sem transbordar', async ({ page }) => {
  await page.goto('/?catalog=4');
  const grid = page.getByTestId('catalog-grid');
  await expect(grid.locator('article')).toHaveCount(6);
  await expect(page.locator('aside')).toHaveCount(0);
  for (const [width, columns] of [
    [1920, 3],
    [1100, 2],
    [390, 1],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(columns);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    const boxes = await grid
      .locator('article')
      .evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height));
    expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(2);
  }
  await page.setViewportSize({ width: 1920, height: 1000 });
  const search = await page.getByRole('search').boundingBox();
  expect(Math.abs(search!.x + search!.width / 2 - 960)).toBeLessThan(2);
});
test('rotas dinâmicas mantêm filtros de categoria, tags, preço e avaliação', async ({ page }) => {
  await page.goto('/?catalog=4');
  const grid = page.getByTestId('catalog-grid');
  await page.getByLabel('Buscar produtos').fill('presente especial');
  await expect(grid.locator('article')).toHaveCount(1);
  await expect(grid).toContainText('Cartões de visita');
  await page.getByLabel('Buscar produtos').fill('');
  await page
    .getByRole('navigation', { name: 'Seções da loja' })
    .getByRole('link', { name: 'Lançamentos', exact: true })
    .click();
  await expect(page).toHaveURL(/\/lancamentos/);
  await expect(grid.locator('article')).toHaveCount(1);
  await expect(grid).toContainText('Carimbo');
  await page
    .getByRole('navigation', { name: 'Seções da loja' })
    .getByRole('link', { name: 'Todos os produtos', exact: true })
    .click();
  await page.getByLabel('Filtrar por avaliação').selectOption('4');
  await expect(grid.locator('article')).toHaveCount(1);
  await page.getByLabel('Preço mínimo', { exact: true }).fill('8');
  await expect(grid.locator('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Seções da loja' })
    .getByRole('link', { name: 'Pacotes de produtos', exact: true })
    .click();
  await expect(grid.locator('article')).toHaveCount(2);
  await page.getByLabel('Filtrar por categoria').selectOption('Livros de Receita');
  await expect(page).toHaveURL(/pacotes\?categoria=livros-de-receita/);
  await expect(page.getByText('Nenhum produto encontrado.', { exact: true })).toBeVisible();
});
test('compartilhamento copia produto ou página pública e orienta o uso no Instagram', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/promocoes?catalog=4&q=carimbo&preview=customer&orderId=segredo');
  const card = page.locator('#produto-1yi50l93z');
  await card.getByRole('button', { name: 'Copiar link de Carimbo', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('http://127.0.0.1:4173/produto/1yi50l93z');
  await card.getByRole('button', { name: 'Copiar link de Carimbo para Instagram', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Cole-o no Instagram');
  expect(await card.getByRole('link', { name: 'Compartilhar Carimbo no WhatsApp' }).getAttribute('href')).toContain(
    encodeURIComponent('/produto/1yi50l93z'),
  );
  await page.getByRole('button', { name: 'Copiar link de Produtos em promoção', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('http://127.0.0.1:4173/promocoes?q=carimbo');
  await expect(page.getByRole('button', { name: /Facebook|Twitter/ })).toHaveCount(0);
});
test('pacote flexível mantém composição, calcula escolhas e envia componentes ao checkout', async ({ page }) => {
  await page.goto('/produto/kit?catalog=4');
  await page.locator('#produto-1yi50l93z').getByRole('button', { name: 'Confirmar componente', exact: true }).click();
  const card = page.locator('#produto-cards');
  await card.getByRole('button', { name: '100', exact: true }).click();
  await card.getByRole('button', { name: 'B', exact: true }).click();
  await card.getByRole('button', { name: 'Confirmar componente', exact: true }).click();
  await page.getByLabel('Quantidade de Cartões de visita', { exact: true }).fill('2');
  await page.getByLabel('Quantidade de pacotes', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Adicionar pacote ao carrinho', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Meu Carrinho' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click();
  const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
  await expect(cart).toContainText('4 × Cartões de visita');
  await cart.getByRole('button', { name: 'Retirar na Loja' }).click();
  await cart.getByLabel('Nome completo').fill('Cliente Teste');
  await cart.getByLabel(/CPF do pagador/).fill('52998224725');
  await cart.getByLabel('Telefone para contato').fill('11987654321');
  await cart.getByLabel('Li e aceito as condições da compra.').check();
  const request = page.waitForRequest((r) => r.url().endsWith('/api/checkout'));
  await cart.getByRole('button', { name: 'IR PARA O PAGBANK' }).click();
  const payload = (await request).postDataJSON();
  expect(payload.items[0]).toMatchObject({
    productId: 'kit',
    quantidade: 2,
    expectedUnitAmountCents: 10656,
    bundleRevision: 'a'.repeat(32),
    bundleItems: [
      { productId: '1yi50l93z', quantidade: 1 },
      { productId: 'cards', quantidade: 2, selecoes: { 'Quantidade impressa': '100', Material: 'B' } },
    ],
  });
});
test('pacote fixo bloqueia escolhas e quantidades também no carrinho', async ({ page }) => {
  await page.goto('/produto/kit-fixo?catalog=4');
  const card = page.locator('#produto-cards');
  await expect(card.getByRole('button', { name: '500', exact: true })).toBeDisabled();
  await expect(card.getByRole('button', { name: 'A', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Quantidade de pacotes', { exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: 'Confirmar componente', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar pacote ao carrinho', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Aumentar quantidade de Kit fixo', exact: true })).toBeDisabled();
});
test('perfil mantém histórico próprio e preenche a compra após editar os dados', async ({ page }) => {
  await page.goto('/minha-conta?catalog=4');
  await expect(page.getByText('GB-E2E-PAGO', { exact: true })).toBeVisible();
  await page.getByLabel('Nome completo', { exact: true }).fill('Ana Cliente');
  await page.getByLabel('Telefone para contato', { exact: true }).fill('11987654321');
  await page.getByLabel('CPF', { exact: true }).fill('52998224725');
  await page.getByLabel('CEP', { exact: true }).fill('01001000');
  await page.getByLabel('Rua', { exact: true }).fill('Praça da Sé');
  await page.getByLabel('Número', { exact: true }).fill('12');
  await page.getByLabel('Bairro', { exact: true }).fill('Sé');
  await page.getByLabel('Cidade', { exact: true }).fill('São Paulo');
  await page.getByLabel('Estado (UF)', { exact: true }).fill('SP');
  await page.getByRole('button', { name: 'Salvar meus dados', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Dados pessoais salvos');
  await page
    .getByRole('navigation', { name: 'Seções da loja' })
    .getByRole('link', { name: 'Todos os produtos', exact: true })
    .click();
  await page.locator('#produto-1yi50l93z').getByRole('button', { name: 'Adicionar ao Carrinho' }).click();
  await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click();
  const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
  await expect(cart.getByLabel('Nome completo')).toHaveValue('Ana Cliente');
  await expect(cart.getByLabel('Telefone para contato')).toHaveValue('11987654321');
  await cart.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(cart.getByLabel('Número', { exact: true })).toHaveValue('12');
  await expect(cart.getByLabel('Rua', { exact: true })).toHaveValue('Rua dos Testes');
});
test('comprador publica nota e comentário como texto na página do produto', async ({ page }) => {
  await page.goto('/produto/1yi50l93z?catalog=4');
  const reviews = page.locator('#avaliacoes');
  await reviews.getByLabel('Sua nota').selectOption('4');
  await reviews.getByLabel('Comentário').fill('<b>Produto ótimo</b>');
  await reviews.getByRole('button', { name: 'Publicar avaliação' }).click();
  await expect(reviews.locator('article').getByText('<b>Produto ótimo</b>', { exact: true })).toBeVisible();
  await expect(reviews.locator('b')).toHaveCount(0);
  await expect(reviews).toContainText('Compra verificada');
});
test('administrador cadastra pacote com variantes fixas e desconto próprio', async ({ page }) => {
  await page.goto('/admin/bundles?catalog=4');
  await page.getByRole('button', { name: 'Criar pacote', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Novo pacote', exact: true });
  await editor.getByLabel('Nome do pacote', { exact: true }).fill('Kit criado no painel');
  await editor.getByLabel('Descrição', { exact: true }).fill('Composição controlada');
  await editor.getByLabel('URL da imagem de apresentação').fill('/__e2e/pixel.png');
  await editor.getByLabel('Categoria', { exact: true }).selectOption('Personalizados');
  await editor.getByLabel('Adicionar produto ao pacote').selectOption('cards');
  await editor.getByLabel('Quantidade impressa', { exact: true }).selectOption('100');
  await editor.getByLabel('Material', { exact: true }).selectOption('B');
  await editor.getByLabel('Desconto do pacote', { exact: true }).selectOption('percent');
  await editor.getByLabel('Percentual', { exact: true }).fill('10');
  await editor.getByRole('button', { name: 'Salvar pacote', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const products = JSON.parse((await page.getByTestId('e2e-products').textContent()) || '[]');
  expect(products.find((p: any) => p.nome === 'Kit criado no painel')).toMatchObject({
    preco_base: '49.50',
    pacote: {
      discountType: 'percent',
      discountValue: 10,
      components: [
        { productId: 'cards', configurable: false, selections: { 'Quantidade impressa': '100', Material: 'B' } },
      ],
    },
  });
});

test('pacote mantém o texto e o modelo confirmados, permite conferir a arte e exige sua aprovação no carrinho', async ({
  page,
}) => {
  await page.goto('/produto/kit-texto?catalog=4&bundleText=1');
  const card = page.locator('#produto-livro-receitas');
  await card.getByRole('button', { name: 'Personalizar texto', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Personalizar texto', exact: true });
  await editor.getByLabel('Nome para personalização').fill('Receitas da Ana');
  await editor.getByRole('button', { name: 'Aplicar e gerar modelo' }).click();
  let viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true });
  await expect(viewer).toBeVisible();
  await viewer.getByRole('button', { name: 'Fechar visualização do modelo' }).click();
  await card.getByRole('button', { name: 'Confirmar componente', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Adicionar pacote ao carrinho', exact: true })).toBeEnabled();
  await expect(card.getByText('Receitas da Ana', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar pacote ao carrinho', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click();
  const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
  await expect(cart).toContainText('Receitas da Ana');
  await cart.getByRole('button', { name: 'Visualizar modelo de Livro de Receitas Personalizado', exact: true }).click();
  viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true });
  await expect(viewer.getByRole('button', { name: /Baixar/ })).toHaveCount(0);
  await viewer.getByRole('button', { name: 'Fechar visualização do modelo' }).click();
  await cart.getByLabel('Aprovar arte de Livro de Receitas Personalizado no pacote').check();
  await cart.getByRole('button', { name: 'Retirar na Loja' }).click();
  await cart.getByLabel('Nome completo').fill('Ana Cliente');
  await cart.getByLabel(/CPF do pagador/).fill('52998224725');
  await cart.getByLabel('Telefone para contato').fill('11987654321');
  await cart.getByLabel('Li e aceito as condições da compra.').check();
  const pending = page.waitForRequest((r) => r.url().endsWith('/api/checkout'));
  await cart.getByRole('button', { name: 'IR PARA O PAGBANK' }).click();
  const payload = (await pending).postDataJSON();
  expect(payload.items[0].bundleItems[0]).toMatchObject({
    productId: 'livro-receitas',
    textoPersonalizado: 'Receitas da Ana',
    aprovarArte: true,
    modeloPath: expect.stringMatching(/^artworks\/e2e-user\/pending\//),
  });
});
