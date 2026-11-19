import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/__e2e/store');
  await expect(page.getByTestId('e2e-store')).toBeAttached();
});

test('filtra o catálogo e conclui checkout de retirada no backend simulado', async ({ page }) => {
  const products = page.locator('#produtos');
  await expect(products.getByRole('heading', { name: 'Carimbo', exact: true })).toBeVisible();
  await expect(products.getByRole('heading', { name: 'Livro de Receitas Personalizado' })).toBeVisible();

  await page.getByLabel('Buscar produtos').fill('livro de receitas');
  await expect(products.getByRole('heading', { name: 'Livro de Receitas Personalizado' })).toBeVisible();
  await expect(products.getByRole('heading', { name: 'Carimbo', exact: true })).toHaveCount(0);

  await page.getByLabel('Buscar produtos').fill('');
  await products.getByRole('button', { name: 'Adicionar ao Carrinho' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Meu Carrinho' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Adicionado ao carrinho.');
  await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click();

  const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
  await expect(cart).toBeVisible();
  await cart.getByRole('button', { name: 'Retirar na Loja' }).click();
  await cart.getByLabel('Nome completo').fill('Cliente Teste');
  await cart.getByLabel(/CPF do pagador/).fill('52998224725');
  await cart.getByLabel('Telefone para contato').fill('16999376260');
  await cart.getByLabel('Li e aceito as condições da compra.').check();

  const checkoutButton = cart.getByRole('button', { name: 'IR PARA O PAGBANK' });
  await expect(checkoutButton).toBeEnabled();
  const checkoutRequest = page.waitForRequest(request => request.url().endsWith('/api/checkout'));
  await checkoutButton.click();

  const request = await checkoutRequest;
  expect(request.headers().authorization).toBe('Bearer e2e-id-token');
  const payload = request.postDataJSON();
  expect(payload.deliveryMethod).toBe('retirada');
  expect(payload.items).toEqual([
    expect.objectContaining({ productId: '1yi50l93z', quantidade: 1 }),
  ]);
  await expect(page.getByTestId('e2e-checkout-redirect')).toHaveText(
    'https://pagamento.sandbox.pagbank.com.br/pagamento?code=e2e',
  );
  await expect(cart).toHaveCount(0);
});

test('calcula frete e preenche o endereço retornado pela API simulada', async ({ page }) => {
  await page.locator('#produtos').getByRole('button', { name: 'Adicionar ao Carrinho' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Meu Carrinho' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Adicionado ao carrinho.');
  await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click();
  const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });

  await cart.getByLabel('Calcular frete').fill('14400000');
  const quoteRequest = page.waitForRequest(request => request.url().endsWith('/api/shipping-quote'));
  await cart.getByRole('button', { name: 'OK' }).click();
  expect((await quoteRequest).postDataJSON()).toEqual({ cep: '14400000', items: [{ productId: '1yi50l93z', quantidade: 1, selecoes: {} }] });

  await expect(cart.getByText('Rua dos Testes, Centro, Franca/SP')).toBeVisible();
  await expect(cart.getByLabel('Rua')).toHaveValue('Rua dos Testes');
  await expect(cart.getByLabel('Bairro')).toHaveValue('Centro');
  await expect(cart.getByText('R$ 12.90', { exact: true })).toHaveCount(2);
  await expect(cart.getByText('Prazo estimado: 5 dias úteis após a postagem.')).toBeVisible();
});

test('seleciona Jadlog pelo Melhor Envio e envia preço e serviço escolhidos ao checkout', async ({ page }) => {
  await page.locator('#produtos').getByRole('button', { name: 'Adicionar ao Carrinho' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Meu Carrinho' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Adicionado ao carrinho.');
  await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click();
  const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
  await cart.getByLabel('Calcular frete').fill('14400000');
  await cart.getByRole('button', { name: 'OK', exact: true }).click();
  await cart.getByRole('radio', { name: /Jadlog/ }).check();
  await expect(cart.getByText('R$ 25.90', { exact: true })).toHaveCount(2);
  await cart.getByLabel('Número', { exact: true }).fill('123');
  await cart.getByLabel('Nome completo').fill('Cliente Teste');
  await cart.getByLabel(/CPF do pagador/).fill('52998224725');
  await cart.getByLabel('Telefone para contato').fill('16999376260');
  await cart.getByLabel('Li e aceito as condições da compra.').check();
  const request = page.waitForRequest(r => r.url().endsWith('/api/checkout'));
  await cart.getByRole('button', { name: 'IR PARA O PAGBANK' }).click();
  expect((await request).postDataJSON()).toEqual(expect.objectContaining({ shippingServiceCode: 'me:3', shippingAmountCents: 2590 }));
  await expect(page.getByTestId('e2e-checkout-redirect')).not.toBeEmpty();
});

test('alteração de quantidade invalida a cotação', async ({ page }) => {
  await page.locator('#produtos').getByRole('button', { name: 'Adicionar ao Carrinho' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Meu Carrinho' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Adicionado ao carrinho.');
  await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click();
  const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
  await cart.getByLabel('Calcular frete').fill('14400000');
  await cart.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(cart.getByRole('radio', { name: /PAC/ })).toBeVisible();
  await cart.getByRole('button', { name: 'Aumentar quantidade de Carimbo' }).click();
  await expect(cart.getByRole('radio', { name: /PAC/ })).toHaveCount(0);
  await cart.getByRole('button', { name: 'IR PARA O PAGBANK' }).click();
  await expect(cart.getByRole('alert')).toContainText('CEP e cálculo do frete');
});

test('cupom de frete é recalculado quando o cliente troca de serviço', async ({ page }) => {
  await page.route('**/api/checkout/coupon', async route => {
    const { couponCode, shippingServiceCode } = route.request().postDataJSON();
    const amount = shippingServiceCode === 'me:3' ? 1295 : 645;
    await route.fulfill({ json: { coupon: couponCode ? {
      code: 'FRETE50', description: 'Metade do frete', discountCents: amount, shippingDiscountCents: amount, firstPurchase: false,
    } : null } });
  });
  await page.locator('#produtos').getByRole('button', { name: 'Adicionar ao Carrinho' }).first().click();
  await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click();
  const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
  await cart.getByLabel('Calcular frete').fill('14400000');
  await cart.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(cart.getByRole('radio', { name: /PAC/ })).toBeChecked();
  await cart.getByRole('textbox', { name: 'Cupom de desconto', exact: true }).fill('FRETE50');
  await cart.getByRole('button', { name: 'Aplicar cupom' }).click();
  await expect(cart.getByText('Desconto no frete')).toBeVisible();
  await expect(cart.getByText(/− R\$\s*6,45/)).toBeVisible();
  const revalidation = page.waitForRequest(r => r.url().endsWith('/api/checkout/coupon') && r.postDataJSON()?.shippingServiceCode === 'me:3');
  await cart.getByRole('radio', { name: /Jadlog/ }).check();
  expect((await revalidation).postDataJSON()).toMatchObject({ couponCode: 'FRETE50', cep: '14400000' });
  await expect(cart.getByText(/− R\$\s*12,95/)).toBeVisible();
  await cart.getByLabel('Número', { exact: true }).fill('123');
  await cart.getByLabel('Nome completo').fill('Cliente Teste');
  await cart.getByLabel(/CPF do pagador/).fill('52998224725');
  await cart.getByLabel('Telefone para contato').fill('16999376260');
  await cart.getByLabel('Li e aceito as condições da compra.').check();
  const checkout = page.waitForRequest(r => r.url().endsWith('/api/checkout'));
  await cart.getByRole('button', { name: 'IR PARA O PAGBANK' }).click();
  expect((await checkout).postDataJSON()).toMatchObject({
    shippingServiceCode: 'me:3', shippingAmountCents: 2590, expectedCouponCents: 1295, expectedShippingDiscountCents: 1295,
  });
});

test('resposta atrasada de outro CEP não restaura uma cotação antiga', async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/shipping-quote', async route => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.locator('#produtos').getByRole('button', { name: 'Adicionar ao Carrinho' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Meu Carrinho' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Adicionado ao carrinho.');
  await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click();
  const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
  await cart.getByLabel('Calcular frete').fill('14400000');
  const pending = page.waitForRequest(r => r.url().endsWith('/api/shipping-quote'));
  await cart.getByRole('button', { name: 'OK', exact: true }).click();
  await pending;
  await cart.getByLabel('Calcular frete').fill('01001000');
  release();
  await expect(cart.getByRole('radio')).toHaveCount(0);
  await expect(cart.getByRole('button', { name: 'OK', exact: true })).toBeEnabled();
});

test('gera o modelo composto e envia texto, fonte, posição e arquivo ao checkout', async ({ page }) => {
  await page.locator('#produto-livro-receitas').getByRole('link',{name:'Ver e configurar produto'}).click();
  const products = page.locator('#produtos');
  const productCard = products.locator('article').filter({
    has: page.getByRole('heading', { name: 'Livro de Receitas Personalizado' }),
  });

  await productCard.getByRole('button', { name: 'Personalizar texto' }).click();
  const drawer = page.getByRole('dialog', { name: 'Personalizar texto' });
  await drawer.getByLabel('Nome para personalização').fill('Receitas da Família');
  await drawer.getByRole('button', { name: 'Georgia' }).click();

  const preview = drawer.getByRole('group', { name: /Prévia da posição do texto/ });
  const bounds = await preview.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.click(bounds!.x + bounds!.width * 0.75, bounds!.y + bounds!.height * 0.25);
  await expect(preview).toHaveAttribute('aria-label', /75% horizontal e 25% vertical/);
  await drawer.getByRole('button', { name: 'Aplicar e gerar modelo' }).click();

  const viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true });
  await expect(viewer).toBeVisible();
  await viewer.getByRole('button', { name: 'Fechar visualização do modelo' }).click();
  await expect(productCard.getByText('Receitas da Família')).toBeVisible();
  await expect(productCard.getByText(/Georgia/)).toBeVisible();
  await expect(productCard.getByText('Modelo composto pronto')).toBeVisible();
  await productCard.getByRole('button', { name: 'Adicionar ao Carrinho' }).click();
  await expect(page.getByRole('dialog', { name: 'Meu Carrinho' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Adicionado ao carrinho.');
  await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click();

  const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
  await expect(cart.getByText('Texto: Receitas da Família')).toBeVisible();
  await expect(cart.getByText('Fonte: Georgia')).toBeVisible();
  await expect(cart.getByText('Modelo composto')).toBeVisible();
  await cart.getByRole('button', { name: 'Retirar na Loja' }).click();
  await cart.getByLabel('Nome completo').fill('Cliente Teste');
  await cart.getByLabel(/CPF do pagador/).fill('52998224725');
  await cart.getByLabel('Telefone para contato').fill('16999376260');
  await cart.getByLabel(/^Aprovar arte de /).check();
  await cart.getByLabel('Li e aceito as condições da compra.').check();

  const checkoutRequest = page.waitForRequest(request => request.url().endsWith('/api/checkout'));
  await cart.getByRole('button', { name: 'IR PARA O PAGBANK' }).click();
  const payload = (await checkoutRequest).postDataJSON();
  expect(payload.items[0]).toEqual(expect.objectContaining({
    productId: 'livro-receitas',
    modeloPath: expect.stringMatching(/^artworks\/e2e-user\/pending\/[a-f0-9]{32}[.]png$/),
    modeloNome: 'Livro-de-Receitas-Personalizado-modelo.png',
    textoPersonalizado: 'Receitas da Família',
    personalizacaoTexto: expect.objectContaining({
      texto: 'Receitas da Família',
      fonte: 'georgia',
      fonteNome: 'Georgia',
      fonteCssFamily: 'Georgia, serif',
      tamanhoFonte: 7.2,
      cor: '#ffffff',
      posicao: { x: 75, y: 25 },
      linhas: [expect.objectContaining({ texto: 'Receitas da Família', posicao: { x: 75, y: 25 } })],
    }),
  }));
});

test.describe('loja em viewport móvel', () => {
  test.use({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });

  test('encontra produtos, filtra categorias e abre a conta na loja móvel', async ({ page }) => {
    const header = page.locator('header');
    const filters = page.getByRole('button', { name: 'Filtros', exact: true });
    const category = page.getByLabel('Filtrar por categoria');
    const grid = page.getByTestId('catalog-grid');
    const heading = page.locator('#products-heading');

    await expect(grid.locator('article').first()).toBeInViewport();
    await expect(category).toBeHidden();
    await filters.tap();
    await category.selectOption('Livros de Receita');
    await expect(heading).toContainText('Livros de Receita');
    await expect(grid.locator('article')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Filtros (1)' })).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'Limpar filtros' }).tap();

    const search = header.getByRole('searchbox', { name: 'Buscar produtos' });
    await search.fill('carimbo');
    await header.getByRole('button', { name: 'Buscar', exact: true }).tap();
    await expect(page).toHaveURL(/q=carimbo/);
    await expect(grid.locator('article')).toHaveCount(1);
    await expect(grid).toContainText('Carimbo');

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => header.evaluate(element => element.getBoundingClientRect().top)).toBe(0);
    const account = header.locator('summary').filter({ hasText: 'Conta' });
    await account.tap();
    await expect(header.getByRole('link', { name: 'Atendimento', exact: true })).toBeVisible();
    await header.getByRole('link', { name: 'Minha conta', exact: true }).tap();
    await expect(page).toHaveURL(/\/minha-conta$/);
    await expect(page.getByRole('heading', { name: 'Minha conta', exact: true })).toBeInViewport();
  });

  test('não cria rolagem horizontal e mantém o carrinho operável', async ({ page }) => {
    const overflow = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);

    await page.locator('#produtos').getByRole('button', { name: 'Adicionar ao Carrinho' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Meu Carrinho' })).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Adicionado ao carrinho.');
    const trigger = page.getByRole('button', { name: 'Abrir carrinho', exact: true });
    await trigger.click();
    const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
    await expect(cart).toBeVisible();
    await expect(cart).toHaveCSS('width', '390px');

    const pay = cart.getByRole('button', { name: 'IR PARA O PAGBANK', exact: true });
    await expect(pay).toBeInViewport();
    await expect(cart.getByText('Total sem frete', { exact: true })).toBeInViewport();

    await cart.getByLabel('Calcular frete').fill('14400000');
    await cart.getByRole('button', { name: 'Calcular', exact: true }).tap();
    await expect(cart.getByRole('radio', { name: /Jadlog/ })).toBeVisible();
    await cart.getByRole('button', { name: 'Retirar na Loja' }).tap();
    await expect(cart.getByRole('paragraph').filter({ hasText: /^Total$/ })).toBeInViewport();
    await cart.getByLabel('Observações do pedido').scrollIntoViewIfNeeded();
    await expect(pay).toBeInViewport();
    await expect(cart.getByRole('button', { name: 'Fechar Meu Carrinho' })).toBeInViewport();

    await page.keyboard.press('Escape');
    await expect(cart).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
