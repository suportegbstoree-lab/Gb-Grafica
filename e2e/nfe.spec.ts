import { expect, test } from '@playwright/test';

test('emitter setup and item-level issues guide fiscal review without requiring the whole catalog', async ({ page }) => {
  await page.goto('/admin/config');
  await page.getByRole('button', { name: 'Configurar NF-e', exact: true }).click();
  let modal = page.getByRole('dialog', { name: 'Configuração de NF-e' });
  await expect(modal.getByText(/Campos a preencher:.*CNPJ/)).toBeVisible();
  await modal.getByLabel('Razão social', { exact: true }).fill('GB Teste');
  await modal.getByLabel('CNPJ', { exact: true }).fill('11.222.333/0001-81');
  await modal.getByLabel('Inscrição estadual', { exact: true }).fill('012.345.678-90');
  await modal.getByLabel('Regime tributário (CRT)').selectOption('1');
  await modal.getByLabel('CEP', { exact: true }).fill('01001000');
  await modal.getByRole('button', { name: 'Consultar CEP do emitente' }).click();
  await expect(modal.getByLabel('Código IBGE do município')).toHaveValue('3550308');
  await modal.getByLabel('Número', { exact: true }).fill('10');
  await modal.getByRole('button', { name: 'Salvar configuração fiscal' }).click();
  await expect(modal).toHaveCount(0);

  await page.getByRole('button', { name: 'Configurar NF-e', exact: true }).click();
  await expect(modal.getByLabel('CNPJ', { exact: true })).toHaveValue('11222333000181');
  await modal.getByRole('button', { name: 'Voltar', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Seções administrativas' });
  await nav.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await page.getByRole('button', { name: 'Ver pendências fiscais' }).click();
  const issues = page.getByRole('region', { name: 'Pendências fiscais dos pedidos' });
  await expect(issues.getByText('Item 1 · Carimbo (CAR01) · Confira NCM.')).toBeVisible();
  await issues.getByRole('button', { name: 'Conferir NF-e' }).click();
  modal = page.getByRole('dialog', { name: 'Rascunho de NF-e' });
  const confirm = modal.getByRole('button', { name: 'Marcar como conferido' });
  await expect(confirm).toBeDisabled();
  await modal.getByLabel('NCM', { exact: true }).fill('49119900');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(modal.getByText('Rascunho fiscal conferido.')).toBeVisible();
  await modal.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(issues.getByText('Conferido', { exact: true })).toBeVisible();

  await nav.getByRole('button', { name: 'Produtos', exact: true }).click();
  await page.getByLabel('Buscar produto por nome').fill('Carimbo');
  await page.getByLabel('Só produtos com pendências fiscais').check();
  await expect(page.getByText('Confira NCM, Código de origem, Unidade comercial.')).toBeVisible();
  await page.getByRole('button', { name: 'Editar classificação fiscal' }).click();
  await expect(page.getByRole('dialog', { name: 'Editar Produto' }).getByLabel('NCM', { exact: true })).toBeFocused();
});

test('the NF-e simulation recovers a timed-out attempt without resending it', async ({ page }) => {
  await page.goto('/admin/orders');
  await page.getByRole('button', { name: 'Simular NF-e', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Simulação de NF-e' });
  await expect(modal.getByText('Caderno de demonstração')).toBeVisible();
  await modal.getByRole('button', { name: 'Conferir rascunho de teste' }).click();
  await modal.getByLabel('Cenário').selectOption('timeout');
  await modal.getByRole('button', { name: 'Simular emissão' }).click();
  await expect(modal.getByRole('alert')).toContainText('Timeout simulado');
  await expect(modal.getByRole('status')).toHaveText('Resposta pendente após timeout');
  await expect(modal.getByRole('button', { name: 'Simular emissão' })).toHaveCount(0);
  await modal.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: 'Simular NF-e', exact: true }).click();
  await expect(modal.getByText('Tentativa SIM-DEMO')).toBeVisible();
  await modal.getByRole('button', { name: 'Consultar tentativa' }).click();
  await expect(modal.getByRole('status')).toHaveText('Autorização simulada');
  await expect(modal.getByText('Tentativa SIM-DEMO')).toBeVisible();
});
