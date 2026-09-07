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
