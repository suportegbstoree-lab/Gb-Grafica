import { expect, test } from '@playwright/test';
import { LEGAL_REVIEW_DATE, LEGAL_ROUTES } from '../src/lib/legal';

test('institutional pages share the storefront theme and remember its setting', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const shell = page.locator('.store-shell');
  const header = page.locator('.store-header');
  const background = (node: Element) => getComputedStyle(node).backgroundColor;
  const lightShell = await shell.evaluate(background);
  const lightHeader = await header.evaluate(background);

  await page.getByRole('link', { name: 'Sobre Nós', exact: true }).click();
  await expect(page).toHaveURL(LEGAL_ROUTES.about);
  await expect(shell).toHaveCSS('background-color', lightShell);
  await expect(header).toHaveCSS('background-color', lightHeader);

  await page.getByRole('button', { name: 'Ativar tema escuro' }).click();
  await expect(shell).toHaveCSS('background-color', 'rgb(17, 17, 17)');
  await expect(header).toHaveCSS('background-color', 'rgb(25, 25, 25)');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('color', 'rgb(245, 245, 247)');
  await expect(page.getByRole('heading', { name: 'Identificação do fornecedor' }).locator('..'))
    .toHaveCSS('background-color', 'rgb(25, 25, 25)');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Ativar tema claro' })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar à loja' }).click();
  await expect(page).toHaveURL('/');
  await expect(shell).toHaveCSS('background-color', 'rgb(17, 17, 17)');
});

test('all institutional pages are navigable at 320 px and expose their current document', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(LEGAL_ROUTES.about);
  await expect(page.getByRole('heading', { name: 'Sobre a GB Gráfica', level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Ir para o conteúdo' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('article', { name: 'Sobre a GB Gráfica' })).toBeFocused();

  const navigation = page.getByRole('navigation', { name: 'Documentos institucionais' });
  const documents = [
    ['Sobre nós', 'Sobre a GB Gráfica', LEGAL_ROUTES.about],
    ['Política de Privacidade', 'Política de Privacidade', LEGAL_ROUTES.privacy],
    ['Termos de Uso', 'Termos de Uso e Compra', LEGAL_ROUTES.terms],
    ['Trocas e reembolsos', 'Política de Trocas, Cancelamentos e Reembolsos', LEGAL_ROUTES.exchanges],
    ['Prazos de produção', 'Prazos de Produção e Entrega', LEGAL_ROUTES.production],
    ['Artes personalizadas', 'Política de Artes Personalizadas', LEGAL_ROUTES.artwork],
    ['LGPD e seus direitos', 'LGPD e Direitos do Titular', LEGAL_ROUTES.lgpd],
  ];
  for (const [label, title, path] of documents) {
    const link = navigation.getByRole('link', { name: label, exact: true });
    await link.click();
    await expect(page).toHaveURL(path);
    await expect(page).toHaveTitle(`${title} | GB Gráfica`);
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('time')).toHaveAttribute('datetime', LEGAL_REVIEW_DATE);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  }

  await expect(page.getByRole('link', { name: 'privacidade@example.com' }).and(page.locator('a[href*="?subject="]')))
    .toHaveAttribute('href', 'mailto:privacidade@example.com?subject=Solicita%C3%A7%C3%A3o%20de%20privacidade');
  await expect(page.getByRole('link', { name: 'ANPD', exact: true })).toHaveAttribute('href', /^https:\/\/www\.gov\.br\/anpd\//);
});
