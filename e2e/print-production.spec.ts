import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

async function imageFile(page: Page, width = 1040, height = 1540) {
  const data = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!; context.fillStyle = '#2563eb'; context.fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { width, height });
  return { name: 'arte.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
}

async function notebook(page: Page, width = 1040, height = 1540) {
  await page.goto('/__e2e/store?print=1');
  const card = page.locator('#produtos article').filter({ has: page.getByRole('heading', { name: 'Caderno Personalizado', exact: true }) });
  await card.locator('input[type=file]').setInputFiles(await imageFile(page, width, height));
  await card.getByRole('button', { name: 'Personalizar capa e contracapa' }).click();
  return { card, editor: page.getByRole('dialog', { name: 'Personalizar capa e contracapa', exact: true }) };
}

test('guia de corte não altera pixels, aprovação é exigida e checkout inclui o formato', async ({ page }) => {
  const { card, editor } = await notebook(page);
  await expect(editor.getByLabel('Guias de impressão', { exact: true })).toBeVisible();
  await expect(editor.getByText(/resolução efetiva: 254 dpi/)).toBeVisible();
  await expect(editor.getByText(/Resolução abaixo da recomendada/)).toBeVisible();
  await editor.getByLabel('Mostrar guias de corte e área segura').uncheck();
  await expect(editor.getByLabel('Guias de impressão', { exact: true })).toHaveCount(0);
  await editor.getByLabel('Mostrar guias de corte e área segura').check();
  await editor.getByRole('button', { name: 'Aplicar e gerar modelo' }).click();
  const viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true });
  await expect(viewer.getByText('1040 × 1540 px', { exact: true })).toBeVisible();
  await expect(viewer.getByRole('button', { name: /JPG|PDF/ })).toHaveCount(0);
  expect(await viewer.getByAltText('Capa do modelo personalizado').evaluate(async (image: HTMLImageElement) => {
    const bitmap = await createImageBitmap(await (await fetch(image.src)).blob());
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] !== 37 || pixels[i + 1] !== 99 || pixels[i + 2] !== 235 || pixels[i + 3] !== 255) return false;
    return true;
  })).toBe(true);
  await viewer.getByRole('button', { name: 'Fechar visualização do modelo' }).click();
  await card.getByRole('button', { name: 'Adicionar ao Carrinho' }).click();
  await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click();
  const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
  await cart.getByRole('button', { name: 'Retirar na Loja' }).click();
  await cart.getByLabel('Nome completo').fill('Cliente Teste');
  await cart.getByLabel(/CPF do pagador/).fill('52998224725');
  await cart.getByLabel('Telefone para contato').fill('16999376260');
  await cart.getByLabel('Li e aceito as condições da compra.').check();
  const pay = cart.getByRole('button', { name: 'IR PARA O PAGBANK' });
  await expect(pay).toBeDisabled();
  await cart.getByLabel('Aprovar arte de Caderno Personalizado', { exact: true }).check();
  await expect(pay).toBeEnabled();
  const request = page.waitForRequest(request => request.url().endsWith('/api/checkout'));
  await pay.click();
  const item = (await request).postDataJSON().items[0];
  expect(item.aprovarArte).toBe(true);
  expect(item.printProfile).toEqual({ widthMm: 100, heightMm: 150, bleedMm: 2, safeMarginMm: 5, targetDpi: 300 });
  expect(item.contracapaPath).toBeTruthy();
});

test('proporção incompatível impede gerar capa ou contracapa sem cortar a imagem', async ({ page }) => {
  let { editor } = await notebook(page, 1000, 1000);
  await expect(editor.getByRole('alert')).toContainText('proporção da imagem difere');
  await editor.getByRole('button', { name: 'Aplicar e gerar modelo' }).click();
  await expect(editor.getByText(/proporção da capa ou contracapa difere/)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Modelo personalizado', exact: true })).toHaveCount(0);
  ({ editor } = await notebook(page));
  await editor.getByLabel('Escolher outra imagem', { exact: true }).check();
  await editor.getByLabel('Imagem da contracapa', { exact: true }).setInputFiles(await imageFile(page, 1000, 1000));
  await editor.getByRole('button', { name: 'Aplicar e gerar modelo' }).click();
  await expect(editor.getByText(/proporção da capa ou contracapa difere/)).toBeVisible();
});

test('admin configura, preserva e remove formato sem obrigar produtos antigos', async ({ page }) => {
  await page.goto('/__e2e/admin');
  const edit = page.getByRole('button', { name: 'Editar Carimbo', exact: true });
  await edit.click();
  const editor = page.getByRole('dialog', { name: 'Editar Produto' });
  await editor.getByLabel('Imagem Principal (URL)').fill('/logo.png');
  await editor.getByRole('button', { name: 'Configurar formato de impressão' }).click();
  for (const [label, value] of [['Largura final (mm)', '100'], ['Altura final (mm)', '150'], ['Sangria por lado (mm)', '2'], ['Margem segura interna (mm)', '5']]) await editor.getByLabel(label, { exact: true }).fill(value);
  await editor.getByRole('button', { name: 'Salvar Produto', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await edit.click();
  await expect(editor.getByLabel('Largura final (mm)')).toHaveValue('100');
  await expect(editor.getByLabel('Sangria por lado (mm)')).toHaveValue('2');
  await editor.getByRole('button', { name: 'Remover formato de impressão' }).click();
  await editor.getByRole('button', { name: 'Salvar Produto', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await edit.click();
  await expect(editor.getByRole('button', { name: 'Configurar formato de impressão' })).toBeVisible();
});

test('ficha usa dados da compra e exporta duas páginas em medidas reais com TrimBox', async ({ page }) => {
  await page.goto('/__e2e/admin?print=1');
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await page.getByRole('button', { name: 'Ficha de produção', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Ficha de produção · GB-E2E-PAGO', exact: true });
  await expect(sheet.getByText('1 × Carimbo', { exact: true })).toBeVisible();
  await expect(sheet.getByText(/100 × 150 mm/)).toBeVisible();
  await expect(sheet.getByText(/Arte aprovada pelo cliente/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Conferir arquivos de produção' }).click();
  const viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true });
  const pdfEvent = page.waitForEvent('download');
  await viewer.getByRole('button', { name: 'Baixar PDF', exact: true }).click();
  const pdf = await PDFDocument.load(await readFile((await (await pdfEvent).path())!));
  expect(pdf.getPageCount()).toBe(2);
  for (const face of pdf.getPages()) {
    expect(face.getWidth()).toBeCloseTo(104 * 72 / 25.4, 6);
    expect(face.getHeight()).toBeCloseTo(154 * 72 / 25.4, 6);
    const trim = face.getTrimBox();
    expect(trim.x).toBeCloseTo(2 * 72 / 25.4, 6); expect(trim.y).toBeCloseTo(2 * 72 / 25.4, 6);
    expect(trim.width).toBeCloseTo(100 * 72 / 25.4, 6); expect(trim.height).toBeCloseTo(150 * 72 / 25.4, 6);
    expect(face.getBleedBox()).toEqual(face.getMediaBox());
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Fechar ficha', exact: true }).click();
  await expect(sheet).toHaveCount(0);
});

test.describe('formato no celular', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('guias, aviso de qualidade e aprovação cabem na tela', async ({ page }) => {
    const { card, editor } = await notebook(page);
    await expect(editor.getByLabel('Guias de impressão', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await editor.getByRole('button', { name: 'Aplicar e gerar modelo' }).click();
    const viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true });
    await expect(viewer.getByAltText('Capa do modelo personalizado')).toBeVisible();
    await expect(viewer.getByLabel('Conferência de impressão', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await viewer.getByRole('button', { name: 'Fechar visualização do modelo' }).click();
    await card.getByRole('button', { name: 'Adicionar ao Carrinho' }).click();
    await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click();
    const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
    const approval = cart.getByLabel('Aprovar arte de Caderno Personalizado', { exact: true });
    await expect(approval).not.toBeChecked();
    await approval.check();
    await expect(approval).toBeChecked();
    expect(await cart.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });
});
