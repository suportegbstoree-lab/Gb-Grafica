import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

async function openEditor(page: Page) {
  await page.goto('/__e2e/store');
  const card = page.locator('#produtos article').filter({ has: page.getByRole('heading', { name: 'Livro de Receitas Personalizado' }) });
  await card.getByRole('button', { name: 'Personalizar texto', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Personalizar texto', exact: true });
  return { card, editor };
}

test('modal mostra Enter, tamanho e cor na prévia e no modelo em resolução original', async ({ page, context }) => {
  const { card, editor } = await openEditor(page);
  const text = editor.getByLabel('Nome para personalização');
  await expect(text).toHaveJSProperty('tagName', 'TEXTAREA');
  await text.fill('AAAA\nBBBB');
  await editor.getByLabel('Tamanho da fonte', { exact: true }).fill('9');
  await editor.getByLabel('Cor do texto', { exact: true }).fill('#00ff00');
  const preview = editor.getByRole('img', { name: 'Prévia do item personalizado', exact: true });
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  const previewBounds = await preview.evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const rows: number[] = [];
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (pixels[i] === 0 && pixels[i + 1] === 255 && pixels[i + 2] === 0) { rows.push(y); break; }
    }
    return { width: canvas.width, height: canvas.height, rows };
  });
  expect(previewBounds.rows.length).toBeGreaterThan(20);
  const gaps = previewBounds.rows.filter((row, index, rows) => index && row - rows[index - 1] > 10);
  expect(gaps).toHaveLength(1);
  const box = await editor.boundingBox();
  expect(box!.x).toBeGreaterThan(20); expect(box!.width).toBeGreaterThan(700);
  await editor.getByRole('button', { name: 'Aplicar e gerar modelo' }).click();
  const viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true });
  await expect(viewer.getByText('800 × 1200 px')).toBeVisible();
  const modelRows = await viewer.getByAltText('Capa do modelo personalizado').evaluate(async (image: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data; const rows: number[] = [];
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (pixels[i] === 0 && pixels[i + 1] === 255 && pixels[i + 2] === 0) { rows.push(y); break; }
    }
    return rows;
  });
  expect(modelRows).toEqual(previewBounds.rows);
  expect(context.pages()).toHaveLength(1);
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: 'Editar texto e posição' }).click();
  await expect(editor.getByLabel('Nome para personalização')).toHaveValue('AAAA\nBBBB');
  await expect(editor.getByLabel('Tamanho da fonte', { exact: true })).toHaveValue('9');
  await expect(editor.getByLabel('Cor do texto')).toHaveValue('#00ff00');
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: 'Adicionar ao Carrinho' }).click();
  await expect(page.getByRole('dialog', { name: 'Meu Carrinho' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Adicionado ao carrinho.');
  await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click();
  const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
  await cart.getByRole('button', { name: 'Retirar na Loja' }).click();
  await cart.getByLabel('Nome completo').fill('Cliente Teste');
  await cart.getByLabel(/CPF do pagador/).fill('52998224725');
  await cart.getByLabel('Telefone para contato').fill('16999376260');
  await cart.getByLabel('Li e aceito as condições da compra.').check();
  const request = page.waitForRequest(r => r.url().endsWith('/api/checkout'));
  await cart.getByRole('button', { name: 'IR PARA O PAGBANK' }).click();
  expect((await request).postDataJSON().items[0].personalizacaoTexto).toEqual(expect.objectContaining({ texto: 'AAAA\nBBBB', tamanhoFonte: 9, cor: '#00ff00' }));
});

test('fontes TTF e OTF são validadas, publicadas e usadas no canvas do cliente', async ({ page }) => {
  await page.goto('/__e2e/admin');
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await expect(page.getByLabel('Nome da fonte 1')).toHaveCount(0);
  const trigger = page.getByRole('button', { name: 'Gerenciar fontes' });
  await trigger.click();
  const modal = page.getByRole('dialog', { name: 'Fontes da personalização', exact: true });
  const upload = modal.locator('input[type=file]');
  for (const extension of ['ttf', 'otf']) {
    await upload.setInputFiles({ name: `Fonte-${extension}.${extension}`, mimeType: '', buffer: await (await import('node:fs/promises')).readFile(path.join('e2e/fixtures', `editor-font.${extension}`)) });
    await expect(modal.getByText(`Arquivo ${extension.toUpperCase()}`, { exact: true })).toBeVisible();
  }
  await upload.setInputFiles({ name: 'invalida.ttf', mimeType: 'font/ttf', buffer: Buffer.from([0,1,0,0,9,9,9,9]) });
  await expect(modal.getByRole('alert')).toContainText('inválido');
  await modal.getByRole('button', { name: 'Concluir edição de fontes' }).click();
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'Salvar Todas as Configurações' }).click();
  await page.getByRole('link', { name: 'Voltar para a Loja' }).click();
  const card = page.locator('#produtos article').filter({ has: page.getByRole('heading', { name: 'Livro de Receitas Personalizado' }) });
  await card.getByRole('button', { name: 'Personalizar texto', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Personalizar texto', exact: true });
  await editor.getByLabel('Nome para personalização').fill('Teste');
  for (const extension of ['ttf', 'otf']) {
    await editor.getByRole('button', { name: `Fonte ${extension}`, exact: true }).click();
    await expect(editor.getByRole('img', { name: 'Prévia do item personalizado', exact: true })).toHaveAttribute('aria-busy', 'false');
    await expect(editor.getByRole('alert')).toHaveCount(0);
  }
  await editor.getByRole('button', { name: 'Aplicar e gerar modelo' }).click();
  await expect(page.getByRole('dialog', { name: 'Modelo personalizado', exact: true })).toBeVisible();
});

test.describe('editor no celular', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('prévia e controles cabem no modal e cancelamento preserva o item', async ({ page }) => {
    const { card, editor } = await openEditor(page);
    await expect(editor.getByLabel('Nome para personalização')).toBeFocused();
    await editor.getByLabel('Nome para personalização').fill('Linha um\nLinha dois');
    await editor.getByLabel('Tamanho da fonte', { exact: true }).fill('6');
    await editor.getByRole('img', { name: 'Prévia do item personalizado', exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    const bounds = await editor.boundingBox(); expect(bounds!.width).toBeLessThanOrEqual(390);
    await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Personalizar texto', exact: true })).toBeFocused();
    await expect(card.getByText('Linha um')).toHaveCount(0);
  });
});
