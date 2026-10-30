import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';

async function imageFile(page: Page, name: string, width: number, height: number, color: string) {
  const base64 = await page.evaluate(({ width, height, color }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, width, height);
    const result = canvas.toDataURL('image/png').split(',')[1]; canvas.width = canvas.height = 1; return result;
  }, { width, height, color });
  return { name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}

async function notebook(page: Page, width = 4096, height = 3072) {
  await page.goto('/__e2e/store');
  const card = page.locator('#produtos article').filter({ has: page.getByRole('heading', { name: 'Caderno Personalizado', exact: true }) });
  await card.locator('input[type=file]').setInputFiles(await imageFile(page, 'capa.png', width, height, '#16a34a'));
  await card.getByRole('button', { name: 'Personalizar capa e contracapa' }).click();
  return { card, editor: page.getByRole('dialog', { name: 'Personalizar capa e contracapa', exact: true }) };
}

test('caderno preserva 4096 pixels, abre no site, baixa JPG e PDF e mantém a contracapa no checkout', async ({ page, context }) => {
  const { card, editor } = await notebook(page);
  await expect(editor.getByLabel('Incluir contracapa', { exact: true })).toBeChecked();
  await editor.getByRole('button', { name: 'Aplicar e gerar modelo' }).click();
  const viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText('4096 × 3072 px')).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Contracapa', exact: true })).toBeVisible();
  expect(context.pages()).toHaveLength(1);

  const jpegDownload = page.waitForEvent('download');
  await viewer.getByRole('button', { name: 'JPG desta face' }).click();
  const jpg = await jpegDownload;
  expect(jpg.suggestedFilename()).toBe('Caderno-Personalizado-capa.jpg');
  const jpgBytes = await readFile((await jpg.path())!);
  expect([...jpgBytes.subarray(0, 3)]).toEqual([255, 216, 255]);
  const jpgSize = await page.evaluate(async base64 => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type: 'image/jpeg' }));
    const result = [bitmap.width, bitmap.height]; bitmap.close(); return result;
  }, jpgBytes.toString('base64'));
  expect(jpgSize).toEqual([4096, 3072]);

  const pdfDownload = page.waitForEvent('download');
  await viewer.getByRole('button', { name: 'Baixar PDF' }).click();
  const pdf = await PDFDocument.load(await readFile((await (await pdfDownload).path())!));
  expect(pdf.getPageCount()).toBe(2);
  const images = pdf.context.enumerateIndirectObjects().filter(([, obj]) => obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
  expect(images.length).toBeGreaterThan(0);
  for (const [, image] of images) {
    expect((image as PDFRawStream).dict.get(PDFName.of('Width'))?.toString()).toBe('4096');
    expect((image as PDFRawStream).dict.get(PDFName.of('Height'))?.toString()).toBe('3072');
  }
  await viewer.getByRole('button', { name: 'Fechar visualização do modelo' }).click();
  await card.getByRole('button', { name: 'Adicionar ao Carrinho' }).click();
  const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
  await cart.getByRole('button', { name: 'Visualizar modelo · capa e contracapa' }).click();
  await expect(viewer.getByRole('button', { name: 'Contracapa', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(cart).toBeVisible();
  await cart.getByRole('button', { name: 'Retirar na Loja' }).click();
  await cart.getByLabel('Nome completo').fill('Cliente Teste');
  await cart.getByLabel(/CPF do pagador/).fill('52998224725');
  await cart.getByLabel('Telefone para contato').fill('16999376260');
  await cart.getByLabel('Li e aceito as condições da compra.').check();
  const request = page.waitForRequest(request => request.url().endsWith('/api/checkout'));
  await cart.getByRole('button', { name: 'IR PARA O PAGBANK' }).click();
  const item = (await request).postDataJSON().items[0];
  expect(item.modeloPath).toMatch(/[.]png$/);
  expect(item.contracapaPath).toMatch(/[.]png$/);
  expect(item.modeloPath).not.toBe(item.contracapaPath);
  expect(item.contracapaModo).toBe('automatic');
});

test('contracapa escolhida exige imagem e mantém seus próprios pixels e conteúdo', async ({ page }) => {
  const { editor } = await notebook(page, 800, 1200);
  await editor.getByLabel('Escolher outra imagem', { exact: true }).check();
  await editor.getByRole('button', { name: 'Aplicar e gerar modelo' }).click();
  await expect(editor.getByRole('alert')).toContainText('Selecione a imagem da contracapa');
  await editor.getByLabel('Imagem da contracapa', { exact: true }).setInputFiles(await imageFile(page, 'verso.png', 2200, 3300, '#2563eb'));
  await editor.getByRole('button', { name: 'Aplicar e gerar modelo' }).click();
  const viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true });
  await viewer.getByRole('button', { name: 'Contracapa', exact: true }).click();
  await expect(viewer.getByText('2200 × 3300 px')).toBeVisible();
  const pixel = await viewer.getByAltText('Contracapa do modelo personalizado').evaluate(async (element: HTMLImageElement) => {
    const bitmap = await createImageBitmap(await (await fetch(element.src)).blob());
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0, 1, 1); bitmap.close();
    return [...context.getImageData(0, 0, 1, 1).data];
  });
  expect(pixel).toEqual([37, 99, 235, 255]);
  const download = page.waitForEvent('download');
  await viewer.getByRole('button', { name: 'JPG desta face' }).click();
  expect((await download).suggestedFilename()).toBe('Caderno-Personalizado-contracapa.jpg');
});

test.describe('modelo no celular', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('permite uma única face, zoom e fechamento por teclado sem abrir outra aba', async ({ page, context }) => {
    const { editor } = await notebook(page, 800, 1200);
    await editor.getByLabel('Incluir contracapa', { exact: true }).uncheck();
    await editor.getByRole('button', { name: 'Aplicar e gerar modelo' }).click();
    const viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Contracapa', exact: true })).toHaveCount(0);
    await viewer.getByRole('button', { name: '100%', exact: true }).click();
    await viewer.getByRole('button', { name: 'Aumentar zoom' }).click();
    await expect(viewer.getByText(/125%/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    expect(context.pages()).toHaveLength(1);
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
  });
});


test('pedidos do cliente e produção abrem capa e contracapa no visualizador interno', async ({ page, context }) => {
  await page.goto('/__e2e/store');
  await page.getByRole('button', { name: 'Meus Pedidos', exact: true }).first().click();
  const orders = page.getByRole('dialog', { name: 'Meus Pedidos' });
  await orders.getByRole('button', { name: 'Abrir modelo composto' }).click();
  let viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true });
  await expect(viewer.getByRole('button', { name: 'Contracapa', exact: true })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Fechar visualização do modelo' })).toBeFocused();
  await viewer.getByRole('button', { name: 'Contracapa', exact: true }).click();
  await expect(viewer.getByAltText('Contracapa do modelo personalizado')).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect(orders).toBeVisible();
  await page.goto('/__e2e/admin');
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir modelo composto' }).click();
  viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true });
  await expect(viewer.getByRole('button', { name: 'Contracapa', exact: true })).toBeVisible();
  expect(context.pages()).toHaveLength(1);
});
