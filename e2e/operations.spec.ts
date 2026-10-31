import { test, expect } from '@playwright/test';

test('production labels start production, can be reprinted and explicit pickup action moves the queue', async ({ page }) => {
  await page.goto('/__e2e/admin');
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Gerar etiqueta e iniciar produção', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('etiqueta-GB-E2E-PAGO.pdf');
  await expect(page.getByRole('button', { name: 'Marcar pronto para retirada', exact: true })).toBeVisible();
  const reprint = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Gerar etiqueta de produção', exact: true }).click(); await reprint;
  await expect(page.getByRole('button', { name: 'Marcar pronto para retirada', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Marcar pronto para retirada', exact: true }).click();
  await expect(page.getByLabel('Andamento do pedido GB-E2E-PAGO', { exact: true })).toHaveValue('pronto_retirada');
});

test('Correios shipping captures a code, uses A Caminho queue and finishes after a tracking refresh', async ({ page }) => {
  await page.goto('/__e2e/admin?delivery'); await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await page.getByRole('button', { name: 'Marcar A Caminho', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Enviar pedido GB-E2E-ENVIO', exact: true });
  await dialog.getByLabel('Código de rastreio dos Correios', { exact: true }).fill('AA123456789BR');
  await dialog.getByRole('button', { name: 'Confirmar envio', exact: true }).click(); await expect(dialog).toHaveCount(0);
  const select = page.getByLabel('Andamento do pedido GB-E2E-ENVIO', { exact: true }); await expect(select).toHaveValue('enviado');
  await expect(select.locator('option[value="entregue"]')).toHaveCount(0);
  await expect(page.getByText('Rastreio: AA123456789BR', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Corrigir rastreio', exact: true }).click();
  await page.getByRole('dialog', { name: 'Enviar pedido GB-E2E-ENVIO', exact: true }).getByLabel('Código de rastreio dos Correios', { exact: true }).fill('BB123456789BR');
  await page.getByRole('button', { name: 'Confirmar envio', exact: true }).click();
  await expect(page.getByText('Rastreio: BB123456789BR', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Consultar rastreio', exact: true }).click();
  await page.getByRole('button', { name: /Entregue 1/ }).click();
  await expect(page.getByLabel('Andamento do pedido GB-E2E-ENVIO', { exact: true })).toHaveValue('entregue');
});

test('customers can read detailed saved order options without model download controls', async ({ page }) => {
  await page.goto('/__e2e/store?print');
  await page.getByRole('button', { name: 'Meus Pedidos', exact: true }).first().click();
  await page.getByRole('button', { name: 'Ver detalhes do pedido GB-E2E-PAGO', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Detalhes do pedido GB-E2E-PAGO', exact: true });
  await expect(dialog).toBeVisible(); await expect(dialog.getByText('Capa e contracapa', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Arte aprovada na compra/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: /JPG|PDF|Baixar|etiqueta/i })).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'Meus Pedidos', exact: true })).toBeVisible();
});

test('flash countdown uses the saved deadline and removes an expired offer without a reload', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-30T12:00:00Z') });
  await page.goto('/__e2e/store?flash');
  const offers = page.getByRole('region', { name: 'Promoções relâmpago', exact: true });
  await expect(offers).toBeVisible(); await expect(offers.getByText('Valor original', { exact: true })).toBeVisible();
  await expect(offers.getByText('R$ 7,56', { exact: true })).toBeVisible();
  await page.clock.fastForward(61_000); await expect(offers).toHaveCount(0);
});

test('administrator can save a flash deadline without an optional banner', async ({ page }) => {
  await page.goto('/__e2e/admin'); await page.getByRole('button', { name: 'Promoções', exact: true }).click();
  await page.getByRole('button', { name: 'Editar Promoção de teste', exact: true }).click();
  await page.getByLabel('Promoção relâmpago', { exact: true }).check();
  await page.getByLabel('Duração (minutos)', { exact: true }).fill('30');
  await expect(page.getByText(/O contador usa este prazo/)).toBeVisible();
  await page.getByRole('button', { name: 'Salvar Promoção', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Promoção');
});

test('order operations fit a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/__e2e/admin?delivery');
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click(); await page.getByRole('button', { name: 'Marcar A Caminho', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Enviar pedido GB-E2E-ENVIO', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});
