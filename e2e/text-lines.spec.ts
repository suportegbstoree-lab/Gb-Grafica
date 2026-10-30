import { expect, test, type Locator, type Page } from '@playwright/test';

async function editorFor(page: Page, text = 'LINHA1\nLINHA2\nLINHA3') {
  await page.goto('/__e2e/store');
  const card = page.locator('#produto-livro-receitas');
  await card.getByRole('button', { name: 'Personalizar texto', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Personalizar texto', exact: true });
  await editor.getByLabel('Nome para personalização').fill(text);
  await expect(editor.getByRole('img', { name: 'Prévia do item personalizado', exact: true })).toHaveAttribute('aria-busy', 'false');
  return { card, editor };
}
async function select(editor: Locator, index: number) { await editor.getByRole('button', { name: `Editar linha ${index}`, exact: true }).click(); }
async function position(editor: Locator, x: string, y: string) {
  await editor.getByLabel('Posição horizontal da linha').fill(x);
  await editor.getByLabel('Posição vertical da linha').fill(y);
}
async function canvasDigest(canvas: Locator) {
  return canvas.evaluate(async (element: HTMLCanvasElement) => {
    const bytes = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  });
}

test('cada linha mantém posição, tamanho e cor; a prévia coincide com o modelo e o checkout', async ({ page }) => {
  const { card, editor } = await editorFor(page);
  await editor.getByLabel('Compartilhar cor entre linhas', { exact: true }).uncheck();
  const colors = ['#ff0000', '#00ff00', '#0000ff'];
  for (const [index, size, x, y] of [[1, 5, 20, 20], [2, 8, 70, 50], [3, 4, 30, 75]]) {
    await select(editor, index);
    await editor.getByLabel('Tamanho da fonte', { exact: true }).fill(String(size));
    await editor.getByLabel('Cor do texto', { exact: true }).fill(colors[index - 1]);
    await position(editor, String(x), String(y));
  }
  const third = editor.getByRole('button', { name: 'Selecionar linha 3 na prévia', exact: true });
  await third.scrollIntoViewIfNeeded(); const box = (await third.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 20, { steps: 5 }); await page.mouse.up();
  await expect(editor.getByRole('button', { name: 'Editar linha 3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const thirdPosition = [await editor.getByLabel('Posição horizontal da linha').inputValue(), await editor.getByLabel('Posição vertical da linha').inputValue()];
  expect(Number(thirdPosition[0])).toBeGreaterThan(30); expect(Number(thirdPosition[1])).toBeLessThan(75);
  await select(editor, 1);
  await expect(editor.getByLabel('Posição horizontal da linha')).toHaveValue('20');
  await expect(editor.getByLabel('Posição vertical da linha')).toHaveValue('20');
  await expect(editor.getByLabel('Tamanho da fonte', { exact: true })).toHaveValue('5');
  await expect(editor.getByLabel('Cor do texto', { exact: true })).toHaveValue(colors[0]);
  const first = editor.getByRole('button', { name: 'Selecionar linha 1 na prévia', exact: true });
  await first.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
  await expect(editor.getByLabel('Posição horizontal da linha')).toHaveValue('21');
  await expect(editor.getByLabel('Posição vertical da linha')).toHaveValue('25');
  const canvas = editor.getByRole('img', { name: 'Prévia do item personalizado', exact: true });
  await expect(canvas).toHaveAttribute('aria-busy', 'false');
  const digest = await canvasDigest(canvas);
  const colorsPresent = await canvas.evaluate((element: HTMLCanvasElement) => {
    const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
    const counts = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) for (let color = 0; color < 3; color++) {
      if (pixels[i + color] === 255 && pixels[i + (color + 1) % 3] === 0 && pixels[i + (color + 2) % 3] === 0) counts[color]++;
    }
    return counts;
  });
  expect(colorsPresent.every(count => count > 30)).toBe(true);
  await editor.getByRole('button', { name: 'Aplicar e gerar modelo' }).click();
  const viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true });
  await expect(viewer.getByText('800 × 1200 px')).toBeVisible();
  await expect(viewer.getByRole('button', { name: /JPG|PDF/ })).toHaveCount(0);
  const modelDigest = await viewer.getByAltText('Capa do modelo personalizado').evaluate(async (image: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', ctx.getImageData(0, 0, canvas.width, canvas.height).data))].map(value => value.toString(16).padStart(2, '0')).join('');
  });
  expect(modelDigest).toBe(digest);
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: 'Editar texto e posição' }).click();
  await select(editor, 2);
  await expect(editor.getByLabel('Tamanho da fonte', { exact: true })).toHaveValue('8');
  await expect(editor.getByLabel('Cor do texto', { exact: true })).toHaveValue('#00ff00');
  await expect(editor.getByLabel('Posição horizontal da linha')).toHaveValue('70');
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: 'Adicionar ao Carrinho' }).click();
  await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click();
  const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
  await cart.getByRole('button', { name: 'Retirar na Loja' }).click();
  await cart.getByLabel('Nome completo').fill('Cliente Teste'); await cart.getByLabel(/CPF do pagador/).fill('52998224725');
  await cart.getByLabel('Telefone para contato').fill('16999376260'); await cart.getByLabel('Li e aceito as condições da compra.').check();
  const request = page.waitForRequest(r => r.url().endsWith('/api/checkout'));
  await cart.getByRole('button', { name: 'IR PARA O PAGBANK' }).click();
  const style = (await request).postDataJSON().items[0].personalizacaoTexto;
  expect(style.linhas.map((line: { tamanhoFonte: number; cor: string }) => [line.tamanhoFonte, line.cor])).toEqual([[5, colors[0]], [8, colors[1]], [4, colors[2]]]);
  expect(style.linhas[0].posicao).toEqual({ x: 21, y: 25 });
  expect(style.linhas[1].posicao).toEqual({ x: 70, y: 50 });
  expect(style.linhas[2].posicao).toEqual({ x: Number(thirdPosition[0]), y: Number(thirdPosition[1]) });
});

test('fonte e cor podem ser compartilhadas sem compartilhar o tamanho e a posição', async ({ page }) => {
  const { editor } = await editorFor(page, 'A\nB');
  await editor.getByLabel('Compartilhar fonte entre linhas', { exact: true }).uncheck();
  await editor.getByLabel('Compartilhar cor entre linhas', { exact: true }).uncheck();
  await select(editor, 1); await editor.getByRole('button', { name: 'Georgia', exact: true }).click();
  await editor.getByLabel('Cor do texto', { exact: true }).fill('#ff0000');
  await editor.getByLabel('Tamanho da fonte', { exact: true }).fill('4');
  await position(editor, '25', '30');
  await select(editor, 2);
  await expect(editor.getByRole('button', { name: 'Arial', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.getByLabel('Cor do texto', { exact: true })).toHaveValue('#ffffff');
  await editor.getByLabel('Cor do texto', { exact: true }).fill('#0000ff');
  await editor.getByLabel('Tamanho da fonte', { exact: true }).fill('9');
  await editor.getByLabel('Compartilhar cor entre linhas', { exact: true }).check();
  await editor.getByLabel('Compartilhar fonte entre linhas', { exact: true }).check();
  await select(editor, 1);
  await expect(editor.getByLabel('Cor do texto', { exact: true })).toHaveValue('#0000ff');
  await expect(editor.getByRole('button', { name: 'Arial', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.getByLabel('Tamanho da fonte', { exact: true })).toHaveValue('4');
  await expect(editor.getByLabel('Posição horizontal da linha')).toHaveValue('25');
  await editor.getByRole('button', { name: 'Centralizar e distribuir linhas' }).click();
  await expect(editor.getByLabel('Posição horizontal da linha')).toHaveValue('50');
  await expect(editor.getByLabel('Tamanho da fonte', { exact: true })).toHaveValue('4');
});

test('inserção e remoção de linhas preserva estilos e o limite de oito linhas é explícito', async ({ page }) => {
  const { editor } = await editorFor(page, 'A\nB\nC');
  await select(editor, 2); await editor.getByLabel('Tamanho da fonte', { exact: true }).fill('9'); await position(editor, '65', '40');
  const input = editor.getByLabel('Nome para personalização');
  await input.fill('Nova\nA\nB\nC'); await select(editor, 3);
  await expect(editor.getByLabel('Tamanho da fonte', { exact: true })).toHaveValue('9');
  await expect(editor.getByLabel('Posição horizontal da linha')).toHaveValue('65');
  await input.fill('B\nC'); await select(editor, 1);
  await expect(editor.getByLabel('Tamanho da fonte', { exact: true })).toHaveValue('9');
  await expect(editor.getByLabel('Posição vertical da linha')).toHaveValue('40');
  await input.fill(Array(9).fill('A').join('\n'));
  await expect(editor.getByRole('alert')).toContainText('Use até 8 linhas'); await expect(input).toHaveValue('B\nC');
});

test.describe('linhas no celular', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('toque seleciona a linha e arraste move somente ela sem transbordar o modal', async ({ page }) => {
    const { editor } = await editorFor(page, 'Primeira\nSegunda');
    await select(editor, 1); const original = [await editor.getByLabel('Posição horizontal da linha').inputValue(), await editor.getByLabel('Posição vertical da linha').inputValue()];
    const target = editor.getByRole('button', { name: 'Selecionar linha 2 na prévia', exact: true });
    await target.scrollIntoViewIfNeeded(); const bounds = (await target.boundingBox())!;
    const cdp = await page.context().newCDPSession(page); const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 20, y: y + 20, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(editor.getByRole('button', { name: 'Editar linha 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(Number(await editor.getByLabel('Posição horizontal da linha').inputValue())).toBeGreaterThan(50);
    await select(editor, 1);
    await expect(editor.getByLabel('Posição horizontal da linha')).toHaveValue(original[0]); await expect(editor.getByLabel('Posição vertical da linha')).toHaveValue(original[1]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  });
});

test('prévia do cliente bloqueia salvar pelo menu e arraste; exportação fica no pedido administrativo', async ({ page }) => {
  const { editor } = await editorFor(page, 'Teste');
  const canvas = editor.getByRole('img', { name: 'Prévia do item personalizado', exact: true });
  expect(await canvas.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(false);
  await editor.getByRole('button', { name: 'Aplicar e gerar modelo' }).click();
  let viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true });
  let image = viewer.getByAltText('Capa do modelo personalizado');
  await expect(image).toHaveAttribute('draggable', 'false');
  expect(await image.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(false);
  expect(await image.evaluate(element => element.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true })))).toBe(false);
  await expect(viewer.getByRole('button', { name: /JPG|PDF/ })).toHaveCount(0);
  await page.goto('/__e2e/admin'); await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir modelo composto' }).click();
  viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true }); image = viewer.getByAltText('Capa do modelo personalizado');
  await expect(image).toHaveAttribute('draggable', 'true');
  expect(await image.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(true);
  await expect(viewer.getByRole('button', { name: 'Baixar PDF' })).toBeVisible();
});
