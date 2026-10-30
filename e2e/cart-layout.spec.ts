import { expect, test, type Locator } from '@playwright/test';

async function expectContentInside(card: Locator) {
  const overflow = await card.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const descendants = [...element.querySelectorAll<HTMLElement>('h3, p, span, button, label, input, img')];
    return descendants.filter(child => child.getClientRects().length && !child.classList.contains('sr-only')).flatMap(child => {
      const rect = child.getBoundingClientRect();
      return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1
        ? [`${child.tagName}: ${child.textContent?.trim().slice(0, 45)}`] : [];
    });
  });
  expect(overflow).toEqual([]);
}

test('adicionar notifica, mantém a loja aberta e acumula itens até clicar no carrinho', async ({ page }) => {
  await page.goto('/__e2e/store');
  const card = page.locator('#produto-1yi50l93z');
  const add = card.getByRole('button', { name: 'Adicionar ao Carrinho', exact: true });
  const trigger = page.getByRole('button', { name: 'Abrir carrinho', exact: true });
  const cart = page.getByRole('dialog', { name: 'Meu Carrinho', exact: true });
  await add.click();
  await expect(page.getByRole('status')).toHaveText('Adicionado ao carrinho.');
  await expect(cart).toHaveCount(0);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toContainText('1');
  await expect(add).toBeFocused();
  await add.click();
  await expect(trigger).toContainText('2');
  await expect(cart).toHaveCount(0);
  await trigger.click();
  await expect(cart).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(cart.getByRole('button', { name: 'Aumentar quantidade de Carimbo' }).locator('..')).toContainText('2');
  await page.keyboard.press('Escape');
  await expect(cart).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const width of [320, 390, 768, 1024, 1280, 1600]) {
  test(`conteúdo do produto fica dentro do card com viewport de ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/__e2e/admin');
    await page.getByRole('button', { name: 'Editar Livro de Receitas Personalizado', exact: true }).click();
    const productEditor = page.getByRole('dialog', { name: 'Editar Produto', exact: true });
    await productEditor.getByLabel('Nome do Produto', { exact: true }).fill(`Caderno-${'ProdutoSemEspacos'.repeat(6)}`);
    await productEditor.getByLabel('Descrição', { exact: true }).fill('DescricaoSemEspacos'.repeat(10));
    await productEditor.getByLabel('Preço Base (Texto)', { exact: true }).fill('12345,67');
    await productEditor.getByRole('button', { name: 'Salvar Produto', exact: true }).click();
    await expect(productEditor).toHaveCount(0);
    await page.getByRole('link', { name: 'Voltar para a Loja' }).click();
    const card = page.locator('#produto-livro-receitas');
    await card.getByRole('button', { name: 'Personalizar texto', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Personalizar texto', exact: true });
    await editor.getByLabel('Nome para personalização').fill('TextoSemEspacos'.repeat(8));
    await editor.getByLabel('Incluir contracapa', { exact: true }).uncheck();
    await editor.getByRole('button', { name: 'Aplicar e gerar modelo' }).click();
    const viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true });
    await viewer.getByRole('button', { name: 'Fechar visualização do modelo' }).click();
    await expect(card.getByText('Modelo composto pronto', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Adicionar ao Carrinho' })).toBeEnabled();
    await expectContentInside(card);
    // A narrow product column must work independently of the viewport breakpoint.
    if (width === 1600) {
      await card.evaluate(element => { element.style.width = '440px'; });
      await expect(card).toHaveCSS('width', '440px');
      await expectContentInside(card);
      const imageBounds = await card.locator('img').first().boundingBox();
      const titleBounds = await card.getByRole('heading').boundingBox();
      expect(titleBounds!.y).toBeGreaterThanOrEqual(imageBounds!.y + imageBounds!.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  });
}

test('seletor da contracapa tem botão em português e permite escolher, cancelar e trocar a imagem', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/__e2e/store');
  await page.locator('#produto-livro-receitas').getByRole('button', { name: 'Personalizar texto', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Personalizar texto', exact: true });
  await editor.getByLabel('Incluir contracapa', { exact: true }).check();
  await editor.getByLabel('Escolher outra imagem', { exact: true }).check();
  const button = editor.getByRole('button', { name: 'Selecionar imagem da contracapa', exact: true });
  const choose = page.waitForEvent('filechooser');
  await button.click();
  const chooser = await choose;
  await chooser.setFiles('e2e/fixtures/editor-cover.png');
  const replace = editor.getByRole('button', { name: 'Trocar imagem da contracapa', exact: true });
  await expect(replace).toBeVisible();
  await expect(editor.getByText('editor-cover.png', { exact: true })).toBeVisible();
  const second = page.waitForEvent('filechooser');
  await replace.focus(); await page.keyboard.press('Enter');
  await (await second).setFiles([]);
  await expect(editor.getByText('editor-cover.png', { exact: true })).toBeVisible();
  const third = page.waitForEvent('filechooser'); await replace.click();
  await (await third).setFiles({ name: `${'arquivo'.repeat(35)}.png`, mimeType: 'image/png', buffer: await (await import('node:fs/promises')).readFile('e2e/fixtures/editor-cover.png') });
  await expect(editor.getByText(`${'arquivo'.repeat(35)}.png`, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  const field = editor.getByLabel('Imagem da contracapa', { exact: true });
  expect(await field.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
});
