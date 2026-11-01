import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFDict, PDFRawStream } from 'pdf-lib';

test('tema acompanha o sistema, alterna por botão e chega aos modais; categoria tem URL própria', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await page.goto('/__e2e/store');
  await expect(page.locator('html')).toHaveAttribute('data-store-theme', 'dark');
  await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).click();
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-store-theme', 'light');
  await expect(page.locator('html')).toHaveCSS('--store-base', '#111111');
  await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Produtos em promoção' })).toContainText('Carimbo');
  await page.getByRole('navigation', { name: 'Categorias de produtos' }).getByRole('button', { name: /Livros de Receita/ }).click();
  await expect(page).toHaveURL(/\/categoria\//); await expect(page.locator('#produtos article')).toHaveCount(1);
  await page.locator('#produto-livro-receitas').getByRole('link',{name:'Ver e configurar produto'}).click();
  await page.getByRole('button', { name: 'Personalizar texto', exact: true }).click(); const modal = page.getByRole('dialog', { name: 'Personalizar texto', exact: true });
  await expect(modal).toBeVisible(); expect(await modal.locator('textarea').first().evaluate(node => getComputedStyle(node).color)).toBe('rgb(245, 245, 247)');
  await page.keyboard.press('Escape'); await page.goto('/categoria/nao-existe'); await expect(page.locator('#produtos article')).toHaveCount(0);
});

test('uma promoção seleciona produtos de categorias distintas', async ({ page }) => {
  await page.goto('/__e2e/admin'); await page.getByRole('button', { name: 'Promoções', exact: true }).click(); await page.getByRole('button', { name: 'Nova Promoção' }).click();
  const editor = page.getByRole('dialog', { name: 'Nova Promoção' }); await editor.getByLabel('Título da Promoção').fill('Oferta de várias categorias');
  await editor.getByRole('checkbox', { name: /Carimbo/ }).check(); await editor.getByRole('checkbox', { name: /Livro de Receitas Personalizado/ }).check();
  await editor.getByLabel('Desconto (%)').fill('12'); await editor.getByRole('button', { name: 'Salvar Promoção' }).click(); await expect(editor).toHaveCount(0);
  await expect(page.getByText('Oferta de várias categorias', { exact: true })).toBeVisible(); await expect(page).toHaveURL(/\/admin\/promotions/);
});

test('checkout aponta campos ausentes, foca o primeiro e não chama pagamento', async ({ page }) => {
  let checkouts = 0; page.on('request', request => { if (request.url().endsWith('/api/checkout')) checkouts++; });
  await page.goto('/__e2e/store'); await page.locator('#produto-1yi50l93z').getByRole('button', { name: 'Adicionar ao Carrinho' }).click();
  await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click(); const cart = page.getByRole('dialog', { name: 'Meu Carrinho' }); await cart.getByLabel('Nome completo').fill('');
  await cart.getByRole('button', { name: 'IR PARA O PAGBANK' }).click(); await expect(cart.getByRole('alert')).toContainText('Nome completo não preenchido ou inválido');
  await expect(cart.getByLabel('Nome completo')).toBeFocused(); await expect(cart.getByLabel('Nome completo')).toHaveAttribute('aria-invalid', 'true'); expect(checkouts).toBe(0);
});

test('produção automática registra o expediente e permite consultar e exportar atividades sem formulário manual', async ({page})=>{
 await page.goto('/admin/operations/production');
 await expect(page.getByText('Atividades concluídas',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Novo lançamento',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Iniciar intervalo',exact:true}).click();await expect(page.getByText('Meu expediente · Em intervalo',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Retornar do intervalo',exact:true}).click();await page.getByRole('button',{name:'Encerrar expediente',exact:true}).click();await expect(page.getByRole('button',{name:'Retomar expediente',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Retomar expediente',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar CSV',exact:true}).click();expect((await download).suggestedFilename()).toBe('atividades-producao.csv');
});

test('PDF de catálogo mantém duas páginas, abre a prévia interna e preserva vetor na exportação de produção', async ({ page }) => {
  await page.goto('/__e2e/admin'); await page.getByRole('button', { name: 'Editar Livro de Receitas Personalizado', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar Produto' }); await editor.getByLabel('Selecionar imagem principal do computador').setInputFiles('e2e/fixtures/editor-template.pdf');
  await expect(editor.getByText(/PDF: editor-template.pdf/)).toBeVisible(); await editor.getByRole('button', { name: 'Salvar Produto', exact: true }).click(); await expect(editor).toHaveCount(0);
  await page.getByRole('link', { name: 'Visualizar como cliente', exact: true }).click(); await expect(page.getByRole('link', { name: 'Área Admin', exact: true })).toHaveCount(0);
  if(!page.url().includes('/produto/')) await page.locator('#produto-livro-receitas').getByRole('link', {name:'Ver e configurar produto'}).click();
  const card = page.locator('#produto-livro-receitas'); await card.getByRole('button', { name: 'Personalizar texto', exact: true }).click(); const textEditor = page.getByRole('dialog', { name: 'Personalizar texto', exact: true });
  await textEditor.getByLabel('Nome para personalização').fill('Nome do cliente'); await textEditor.getByLabel('Incluir contracapa').check(); await textEditor.getByRole('button', { name: 'Contracapa', exact: true }).click();
  await expect(textEditor.getByRole('img', { name: 'Prévia do item personalizado', exact: true })).toHaveAttribute('aria-busy', 'false'); await textEditor.getByRole('button', { name: 'Aplicar e gerar modelo' }).click();
  const viewer = page.getByRole('dialog', { name: 'Modelo personalizado', exact: true }); await expect(viewer).toBeVisible(); await expect(viewer.getByRole('button', { name: /Baixar/ })).toHaveCount(0);
  const raw = await readFile('e2e/fixtures/editor-template.pdf');
  const exported = await page.evaluate(async base64 => {
    const path = '/src/services/personalizationExport.ts', service = await import(path); const previewPath = '/src/services/pdfPreview.ts', preview = await import(previewPath);
    const blob = new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'application/pdf' }), pages = await preview.pdfPreviewPages(blob);
    return Array.from(new Uint8Array(await (await service.exportPersonalizationPdf({ title: 'Produção PDF', originalPdf: blob, automaticPdfBack: true, pages: pages.map((page, i) => ({ label: i ? 'Contracapa' : 'Capa', blob: page })) })).arrayBuffer()));
  }, raw.toString('base64'));
  const pdf = await PDFDocument.load(Uint8Array.from(exported)); expect(pdf.getPageCount()).toBe(2); expect(pdf.catalog.has(PDFName.of('AcroForm'))).toBe(false);
  for (const sheet of pdf.getPages()) { const resources = sheet.node.Resources()!, objects = resources.lookup(PDFName.of('XObject'), PDFDict); expect(objects.values().some(value => (pdf.context.lookup(value) as PDFRawStream).dict.get(PDFName.of('Subtype'))?.toString() === '/Form')).toBe(true); }
});

test('galeria recebe lote e a combinação troca imagem e preço no produto e no carrinho', async ({ page }) => {
  await page.goto('/__e2e/admin'); await page.getByRole('button', { name: 'Editar Carimbo', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar Produto' }); await editor.getByLabel('Imagem Principal (URL)').fill('/logo.png');
  const image = await readFile('e2e/fixtures/editor-cover.png');
  await editor.getByLabel('Adicionar imagens do computador à galeria').setInputFiles([{ name: 'azul.png', mimeType: 'image/png', buffer: image }, { name: 'vermelho.png', mimeType: 'image/png', buffer: image }]);
  await expect(editor.locator('img[src^="/__e2e/uploads/"]')).toHaveCount(2);
  await editor.getByRole('button', { name: '+ Adicionar Atributo', exact: true }).click(); await editor.getByLabel('Nome (ex: Tamanho)').fill('Cor'); await editor.getByLabel('Opções (separadas por vírgula)').fill('Azul,Vermelho'); await editor.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await editor.getByLabel('Preço da combinação Azul', { exact: true }).fill('25.00'); await editor.getByLabel('Preço da combinação Vermelho', { exact: true }).fill('10.00');
  await editor.getByLabel('Imagem da combinação Azul').selectOption({ label: 'Imagem 1 da galeria' }); const selectedImage = await editor.getByLabel('Imagem da combinação Azul').inputValue();
  await editor.getByRole('button', { name: 'Salvar Produto', exact: true }).click(); await expect(editor).toHaveCount(0); await page.getByRole('link', { name: 'Voltar para a Loja' }).click();
  await page.locator('#produto-1yi50l93z').getByRole('link',{name:'Ver e configurar produto'}).click();
  const card = page.locator('#produto-1yi50l93z'); await card.getByRole('button', { name: 'Azul', exact: true }).click(); await expect(card.getByAltText('Carimbo', { exact: true })).toHaveAttribute('src', selectedImage);
  await card.getByRole('button', { name: 'Adicionar ao Carrinho' }).click(); await page.getByRole('button', { name: 'Abrir carrinho', exact: true }).click(); const cart = page.getByRole('dialog', { name: 'Meu Carrinho' });
  await expect(cart.getByAltText('Carimbo', { exact: true })).toHaveAttribute('src', selectedImage); await expect(cart).toContainText('22,50');
});
