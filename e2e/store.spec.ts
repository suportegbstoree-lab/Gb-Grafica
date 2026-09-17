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
  const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });

  await cart.getByLabel('Calcular frete').fill('14400000');
  const quoteRequest = page.waitForRequest(request => request.url().endsWith('/api/shipping-quote'));
  await cart.getByRole('button', { name: 'OK' }).click();
  expect((await quoteRequest).postDataJSON()).toEqual({ cep: '14400000' });

  await expect(cart.getByText('Rua dos Testes, Centro, Franca/SP')).toBeVisible();
  await expect(cart.getByLabel('Rua')).toHaveValue('Rua dos Testes');
  await expect(cart.getByLabel('Bairro')).toHaveValue('Centro');
  await expect(cart.getByText('R$ 12.90', { exact: true })).toHaveCount(2);
});

test('configura texto, fonte e posição e envia os dados estruturados ao checkout', async ({ page }) => {
  const products = page.locator('#produtos');
  const productCard = products.locator('article').filter({
    has: page.getByRole('heading', { name: 'Livro de Receitas Personalizado' }),
  });

  await productCard.getByRole('button', { name: 'Personalizar texto' }).click();
  const drawer = page.getByRole('dialog', { name: 'Personalizar texto' });
  await drawer.getByLabel('Nome para personalização').fill('Receitas da Família');
  await drawer.getByRole('button', { name: 'Georgia' }).click();

  const preview = drawer.getByRole('button', { name: /Prévia da posição do texto/ });
  const bounds = await preview.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.click(bounds!.x + bounds!.width * 0.75, bounds!.y + bounds!.height * 0.25);
  await expect(preview).toHaveAttribute('aria-label', /75% horizontal e 25% vertical/);
  await drawer.getByRole('button', { name: 'Aplicar' }).click();

  await expect(productCard.getByText('Receitas da Família')).toBeVisible();
  await expect(productCard.getByText(/Georgia · X 75% · Y 25%/)).toBeVisible();
  await productCard.getByRole('button', { name: 'Adicionar ao Carrinho' }).click();

  const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
  await expect(cart.getByText('Texto: Receitas da Família')).toBeVisible();
  await expect(cart.getByText(/Fonte: Georgia · Posição: X 75% \/ Y 25%/)).toBeVisible();
  await cart.getByRole('button', { name: 'Retirar na Loja' }).click();
  await cart.getByLabel('Nome completo').fill('Cliente Teste');
  await cart.getByLabel(/CPF do pagador/).fill('52998224725');
  await cart.getByLabel('Telefone para contato').fill('16999376260');
  await cart.getByLabel('Li e aceito as condições da compra.').check();

  const checkoutRequest = page.waitForRequest(request => request.url().endsWith('/api/checkout'));
  await cart.getByRole('button', { name: 'IR PARA O PAGBANK' }).click();
  const payload = (await checkoutRequest).postDataJSON();
  expect(payload.items[0]).toEqual(expect.objectContaining({
    productId: 'livro-receitas',
    textoPersonalizado: 'Receitas da Família',
    personalizacaoTexto: {
      texto: 'Receitas da Família',
      fonte: 'georgia',
      fonteNome: 'Georgia',
      fonteCssFamily: 'Georgia, serif',
      posicao: { x: 75, y: 25 },
    },
  }));
});

test.describe('loja em viewport móvel', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('não cria rolagem horizontal e mantém o carrinho operável', async ({ page }) => {
    const overflow = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);

    await page.locator('#produtos').getByRole('button', { name: 'Adicionar ao Carrinho' }).first().click();
    const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
    await expect(cart).toBeVisible();
    const box = await cart.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(390);

    await page.keyboard.press('Escape');
    await expect(cart).toHaveCount(0);
  });
});
