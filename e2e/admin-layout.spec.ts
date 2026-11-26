import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('menu organizado abre áreas antigas e volta ao clássico sem sair da tela', async ({ page }) => {
  await page.goto('/__e2e/admin');
  const nav = page.getByRole('navigation', { name: 'Seções administrativas' });
  await expect(nav.locator('button[aria-expanded]')).toHaveText(['Pedidos', 'Gerar PDF', 'Produtos', 'Descontos', 'Loja', 'Equipe']);
  await expect(nav.getByRole('button', { name: 'Catálogo', exact: true })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('button', { name: 'Equipe', exact: true }).click();
  await nav.getByRole('button', { name: 'Cargos e permissões', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/staff\/cargos$/);
  await expect(page.getByRole('button', { name: 'Criar cargo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aplicar função' })).toBeHidden();
  await nav.getByRole('button', { name: 'Funcionários', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Aplicar função' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Criar cargo' })).toBeHidden();

  await nav.getByRole('button', { name: 'Loja', exact: true }).click();
  await nav.getByRole('button', { name: 'Informações da Loja', exact: true }).click();
  await page.getByLabel('Razão social ou nome completo').fill('Rascunho preservado');
  await page.getByRole('button', { name: 'Voltar ao menu clássico' }).click();
  await expect(page).toHaveURL(/\/admin\/config$/);
  await expect(nav.getByRole('button', { name: 'Configurações', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('button')).toHaveCount(16);
  await expect(page.getByLabel('Razão social ou nome completo')).toHaveValue('Rascunho preservado');
  await page.getByRole('button', { name: 'Salvar Todas as Configurações' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Configurações salvas' })).toBeVisible();
  await page.reload();
  await expect(nav.getByRole('button', { name: 'Operações', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Usar menu organizado' }).click();
  await expect(nav.getByRole('button', { name: 'Informações da Loja', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('menu organizado só abre grupos e atalhos permitidos ao funcionário', async ({ page }) => {
  await page.goto('/__e2e/admin?role=designer');
  const nav = page.getByRole('navigation', { name: 'Seções administrativas' });
  await expect(nav.getByRole('button', { name: 'Produtos', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Catálogo', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Categorias', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Descontos', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Cargos e permissões', exact: true })).toHaveCount(0);
  await page.goto('/admin/staff/cargos?role=designer');
  await expect(page).not.toHaveURL(/\/admin\/staff/);
  await expect(page.getByRole('button', { name: 'Criar cargo' })).toHaveCount(0);
});

test('padrão de frete preenche o cadastro e o produto salva uma medida própria', async ({ page }) => {
  await page.goto('/admin/config');
  const preset = page.getByRole('region', { name: 'Peso e embalagem padrão' });
  await preset.getByRole('button', { name: 'Cadastrar padrão da loja' }).click();
  const fields = {
    'Peso por unidade vendida (g)': '500',
    'Peso da embalagem vazia (g)': '10',
    'Comprimento externo (cm)': '21',
    'Largura externa (cm)': '15',
    'Altura externa (cm)': '4',
    'Unidades que cabem por volume': '2',
  };
  for (const [name, value] of Object.entries(fields)) await preset.getByLabel(name, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Salvar Todas as Configurações' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Configurações salvas' })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Seções administrativas' });
  await nav.getByRole('button', { name: 'Produtos', exact: true }).click();
  await nav.getByRole('button', { name: 'Catálogo', exact: true }).click();
  await page.getByRole('button', { name: 'Novo Produto', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Novo Produto' });
  for (const [name, value] of Object.entries(fields)) await expect(editor.getByLabel(name, { exact: true })).toHaveValue(value);
  await editor.getByLabel('Nome do Produto').fill('Caderno com frete');
  await editor.getByLabel('Descrição', { exact: true }).fill('Caderno de teste.');
  await editor.getByLabel('Imagem Principal (URL)').fill('/logo.png');
  await editor.getByLabel('Preço base sem opções', { exact: true }).fill('20');
  await editor.getByLabel('Peso por unidade vendida (g)', { exact: true }).fill('725');
  const saveRequest = page.waitForRequest(request => request.method() === 'POST' && request.url().includes('/__e2e/catalog/anuncios/'));
  await editor.getByRole('button', { name: 'Salvar Produto', exact: true }).click();
  expect((await saveRequest).postDataJSON().value.shipping).toEqual({
    unitWeightGrams: 725, packagingWeightGrams: 10, lengthCm: 21, widthCm: 15, heightCm: 4, unitsPerParcel: 2,
  });
  await expect(editor).toBeHidden();
});

test('vitrine móvel tem uma faixa curta e o link abre a lista completa', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?many-offers');
  const browseOffers = page.getByRole('link', { name: 'Ver todas as promoções' });
  const offers = page.getByRole('region', { name: 'Produtos em promoção', exact: true }).filter({ has: browseOffers });
  const cards = offers.getByRole('article');
  await expect(cards).toHaveCount(3);
  expect(await cards.evaluateAll(nodes => new Set(nodes.map(node => node.getBoundingClientRect().top)).size)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await offers.getByRole('link', { name: 'Ver todas as promoções' }).click();
  await expect(page).toHaveURL(/\/promocoes$/);
  await expect(offers).toHaveCount(0);
  await expect(page.locator('#produtos article')).toHaveCount(7);
  await page.getByRole('navigation', { name: 'Seções da loja' }).getByRole('link', { name: 'Todos', exact: true }).click();
  await expect(offers).toBeVisible();
  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  await page.getByLabel('Filtrar por categoria', { exact: true }).selectOption({ label: 'Personalizados' });
  await expect(offers).toHaveCount(0);
});

test("etiquetas têm página própria no grupo Gerar PDF e saem das abas da oficina", async ({ page }) => {
  await page.goto("/admin/documents");
  const nav = page.getByRole("navigation", { name: "Seções administrativas" });
  await expect(
    page
      .getByRole("navigation", { name: "Ferramentas PDF da equipe" })
      .getByRole("button", { name: "Importar etiquetas", exact: true }),
  ).toHaveCount(0);
  await nav.getByRole("button", { name: "Etiquetas importadas", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/imported-labels$/);
  await expect(page.getByRole("heading", { name: "Etiquetas importadas", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Importação de etiquetas" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Ferramentas PDF da equipe" })).toBeHidden();
  await page.reload();
  await expect(nav.getByRole("button", { name: "Etiquetas importadas", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
