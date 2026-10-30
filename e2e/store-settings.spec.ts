import { expect, test } from '@playwright/test';

test('produtos podem entrar e sair dos destaques e o banner acompanha a seleção', async ({ page }) => {
  await page.goto('/__e2e/admin');
  await page.getByRole('button', { name: 'Adicionar a destaque', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Remover de destaque', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Editar Carimbo', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar Produto' });
  await editor.getByLabel('Imagem Principal (URL)').fill('/logo.png');
  await editor.getByRole('button', { name: 'Salvar Produto', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Adicionar a destaque', exact: true }).first().click();
  await page.getByRole('link', { name: 'Voltar para a Loja' }).click();
  const banner = page.getByRole('region', { name: 'Destaques', exact: true });
  await expect(banner.getByRole('button', { name: 'Mostrar Carimbo', exact: true })).toBeVisible();
  await banner.getByRole('button', { name: 'Mostrar Livro de Receitas Personalizado', exact: true }).click();
  await expect(banner.getByRole('heading', { name: 'Livro de Receitas Personalizado', exact: true })).toBeVisible();
  await banner.getByRole('button', { name: 'Ver produto', exact: true }).click();
  await expect(page.locator('#produto-livro-receitas')).toBeInViewport();
  await page.getByRole('link', { name: 'Área Admin' }).click();
  await page.getByRole('button', { name: 'Remover de destaque', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Remover de destaque', exact: true })).toHaveCount(1);
});

test('atendimento aceita somente email e benefícios podem ser removidos, adicionados e reordenados', async ({ page }) => {
  await page.goto('/__e2e/admin');
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  const contacts = page.getByRole('region', { name: 'Atendimento', exact: true });
  while (await contacts.getByRole('button', { name: /Remover contato/ }).count()) await contacts.getByRole('button', { name: /Remover contato/ }).first().click();
  await contacts.getByRole('button', { name: 'Adicionar meio de contato' }).click();
  await contacts.getByLabel('Tipo do contato 1', { exact: true }).selectOption('email');
  await contacts.getByLabel('Nome do contato 1', { exact: true }).fill('Suporte por e-mail');
  await contacts.getByLabel('Valor do contato 1', { exact: true }).fill('cliente@example.com');
  const benefits = page.getByRole('region', { name: 'Benefícios da loja', exact: true });
  await benefits.getByRole('button', { name: 'Remover benefício 2', exact: true }).click();
  await benefits.getByRole('button', { name: 'Adicionar benefício', exact: true }).click();
  await benefits.getByLabel('Título do benefício 3', { exact: true }).fill('Entrega local');
  await benefits.getByLabel('Descrição do benefício 3', { exact: true }).fill('Atendimento em Franca');
  await benefits.getByRole('button', { name: 'Subir benefício 3', exact: true }).click();
  await expect(benefits.getByLabel('Título do benefício 2', { exact: true })).toHaveValue('Entrega local');
  await page.getByRole('button', { name: 'Salvar Todas as Configurações', exact: true }).click();
  await expect(page.getByText('Configurações salvas com sucesso!', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar para a Loja' }).click();
  await expect(page.locator('a[href="mailto:cliente@example.com"]')).toHaveCount(2);
  await expect(page.locator('a[href^="https://wa.me/"]')).toHaveCount(0);
  const publicBenefits = page.getByRole('region', { name: 'Benefícios da loja', exact: true });
  await expect(publicBenefits.getByText('Entrega local', { exact: true })).toBeVisible();
  await expect(publicBenefits.getByText('PAGAMENTO SEGURO', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Falar com a GB Gráfica: Suporte por e-mail' })).toBeVisible();
});

test('remover todos os contatos e benefícios mantém a configuração vazia no celular', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/__e2e/admin');
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  for (const sectionName of ['Atendimento', 'Benefícios da loja']) {
    const section = page.getByRole('region', { name: sectionName, exact: true });
    while (await section.getByRole('button', { name: /^Remover/ }).count()) await section.getByRole('button', { name: /^Remover/ }).first().click();
  }
  await page.getByRole('button', { name: 'Salvar Todas as Configurações', exact: true }).click();
  await expect(page.getByText('Configurações salvas com sucesso!', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar para a Loja' }).click();
  await expect(page.getByRole('region', { name: 'Benefícios da loja', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Falar com a GB Gráfica:/ })).toHaveCount(0);
  await expect(page.locator('a[href^="https://wa.me/"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});
