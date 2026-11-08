import { test, expect } from "@playwright/test";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { zipSync, strToU8 } from "fflate";

test("staff queue snapshots independent lines, supports revision and exports four original-size pages", async ({
  page,
}) => {
  await page.goto("/__e2e/staff-pdf");
  await page
    .getByRole("button", { name: "Buscar base PDF", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Buscar base PDF",
    exact: true,
  });
  await picker.getByLabel("Filtrar por nome").fill("Kit");
  await picker
    .getByRole("button", {
      name: "Kit de teste.pdf · Sem categoria",
      exact: true,
    })
    .click();
  await page.getByLabel("Texto principal", { exact: true }).fill("ANA");
  await expect(
    page.getByRole("group", { name: "Formatação do texto" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Adicionar linha de texto", exact: true })
    .click();
  const toolbar = page.getByRole("group", { name: "Formatação do texto" });
  await toolbar.getByLabel("Texto da linha extra").fill("SEGUNDA");
  await toolbar.getByLabel("Tamanho (px)", { exact: true }).fill("90");
  await toolbar.getByRole("button", { name: "Negrito" }).click();
  await toolbar.getByRole("button", { name: "Efeitos" }).click();
  await toolbar.getByLabel("Contorno", { exact: true }).check();
  await toolbar.getByLabel("Sombra", { exact: true }).check();
  await toolbar.getByLabel("Brilho", { exact: true }).check();
  await toolbar.getByLabel("Curvatura", { exact: true }).fill("20");
  await page.getByLabel("Página da prévia interna").selectOption("3");
  await toolbar
    .getByLabel("Texto selecionado")
    .selectOption({ label: "Texto principal" });
  await expect(toolbar.getByRole("button", { name: "Efeitos" })).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "Negrito" })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Adicionar à fila", exact: true })
    .click();
  await expect(page.getByRole("article")).toContainText("ANA / SEGUNDA");
  await page
    .getByRole("button", { name: "Editar item da fila", exact: true })
    .click();
  await toolbar
    .getByLabel("Texto selecionado")
    .selectOption({ label: "Linha extra 1" });
  await expect(toolbar.getByLabel("Tamanho (px)", { exact: true })).toHaveValue(
    "90",
  );
  await toolbar.getByLabel("Texto da linha extra").fill("REVISADA");
  await page
    .getByRole("button", { name: "Atualizar item da fila", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Processar fila", exact: true })
    .click();
  await expect(page.getByRole("article")).toContainText("Concluído");
  await expect(page.getByRole("article")).toContainText("ANA / REVISADA");
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Baixar PDF-TEST-1", exact: true })
    .click();
  const file = await downloading;
  const pdf = await PDFDocument.load(await readFile((await file.path())!));
  expect(pdf.getPageCount()).toBe(4);
  for (const p of pdf.getPages()) {
    expect(p.getSize()).toEqual({ width: 595, height: 842 });
    expect(p.getRotation().angle).toBe(0);
  }
  await page
    .getByRole("button", { name: "Excluir da fila", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Excluir da fila", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Fila principal · 0", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Baixar PDF-TEST-1", exact: true }),
  ).toBeVisible();
});
test("template and generation tools are independently hidden", async ({
  page,
}) => {
  await page.goto("/__e2e/staff-pdf?permission=generate");
  await expect(
    page.getByRole("button", { name: "Bases e moldes", exact: true }),
  ).toHaveCount(0);
  await page.goto("/__e2e/staff-pdf?permission=templates");
  await expect(
    page.getByRole("button", { name: "Edição e fila", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Planilha e CSV", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Criar molde", exact: true }),
  ).toBeVisible();
});
test("XLSX field mapping normalizes SKU and preserves literal codes", async ({
  page,
}) => {
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const bytes = zipSync({
    "xl/workbook.xml": strToU8(
      `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dados" r:id="s1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="s1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nome</t></is></c><c r="B1" t="inlineStr"><is><t>Nº de Pedido da Plataforma</t></is></c><c r="C1" t="inlineStr"><is><t>Modelo do SKU</t></is></c><c r="D1" t="inlineStr"><is><t>Ignorar</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Ana</t></is></c><c r="B2" t="inlineStr"><is><t>00123</t></is></c><c r="C2" t="inlineStr"><is><t>CADERNO - Kit de teste - BR</t></is></c><c r="D2" t="inlineStr"><is><t>Fora</t></is></c></row></sheetData></worksheet>`,
    ),
  });
  await page.goto("/__e2e/staff-pdf");
  await page
    .getByRole("button", { name: "Planilha e CSV", exact: true })
    .click();
  await page.getByLabel("Arquivo XLSX", { exact: true }).setInputFiles({
    name: "dados.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(bytes),
  });
  await page.getByLabel("SKU", { exact: true }).fill("C");
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Baixar CSV selecionado", exact: true })
    .click();
  const file = await downloading;
  const csv = await readFile((await file.path())!, "utf8");
  expect(csv).toContain("00123");
  expect(csv).toContain('"pedido_plataforma","barcode","af_clean","nome"');
  expect(csv).toContain('"Kit de teste"');
  expect(csv).not.toContain("Ignorar");
  expect(csv).not.toContain("Fora");

  await page
    .getByRole("button", { name: "Converter e revisar pedidos" })
    .click();
  const record = page.getByRole("row").filter({ hasText: "00123" });
  await expect(record).toContainText("Ana");
  await record.getByLabel("Rastreio do registro 2").fill("BR2684621549924");
  await record
    .getByLabel("Base do registro 2")
    .selectOption({ label: "Kit de teste.pdf · Sem categoria" });
  await expect(record.getByLabel("Molde do registro 2")).toHaveValue(
    "b".repeat(32),
  );
  await page
    .getByRole("button", {
      name: "Adicionar 1 pedido(s) da página à fila",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Revisar fila principal" }).click();
  await expect(page.getByRole("article")).toContainText(
    "Kit de teste Ana BR2684621549924",
  );
  await page.getByRole("button", { name: "Editar item da fila" }).click();
  await expect(page.getByLabel("Texto principal", { exact: true })).toHaveValue(
    "Ana",
  );
  await page
    .getByLabel("Texto principal", { exact: true })
    .fill("ANA REVISADA");
  await page.getByRole("button", { name: "Atualizar item da fila" }).click();
  const savingQueue = page.waitForEvent("download");
  await page.getByRole("button", { name: "Salvar fila em JSON" }).click();
  const queueFile = await savingQueue;
  await page.getByRole("button", { name: "Excluir da fila" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Excluir da fila" })
    .click();
  await page
    .getByLabel("Carregar fila JSON")
    .setInputFiles((await queueFile.path())!);
  await expect(page.getByRole("article")).toContainText("ANA REVISADA");
  await page.getByRole("button", { name: "Processar fila" }).click();
  await expect(page.getByRole("article")).toContainText("Concluído");
  const savingPdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar PDF-TEST-1" }).click();
  expect((await savingPdf).suggestedFilename()).toBe(
    "Kit de teste ANA REVISADA BR2684621549924.pdf",
  );
});

test("desktop CSV matches its model and flags unknown records before processing", async ({
  page,
}) => {
  await page.goto("/__e2e/staff-pdf");
  await page.getByRole("button", { name: "Importar CSV ou XLSX" }).click();
  await page.getByLabel("Arquivo CSV", { exact: true }).setInputFiles({
    name: "pedidos.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "pedido_plataforma,barcode,af_clean,nome,prazo_envio\r\n00123,BR2684621549924,Kit de teste,ANA,\r\n00124,BR263172448223P,Desconhecido,BIA,",
    ),
  });
  const known = page.getByRole("row").filter({ hasText: "00123" });
  const unknown = page.getByRole("row").filter({ hasText: "00124" });
  await expect(known.getByLabel("Molde do registro 2")).toHaveValue(
    "b".repeat(32),
  );
  await expect(unknown).toContainText("Confira a base e o molde.");
  await page
    .getByRole("button", {
      name: "Adicionar 1 pedido(s) da página à fila",
      exact: true,
    })
    .click();
  await expect(unknown).toBeVisible();
  await page.getByRole("button", { name: "Revisar fila principal" }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText("ANA");
});

test("the workshop saves recipes in previous batches and reconstructs its PDF for download", async ({
  page,
}) => {
  await page.goto("/__e2e/staff-pdf?batches=true");
  await page
    .getByLabel("Base PDF da equipe")
    .selectOption({ label: "Kit de teste.pdf · Sem categoria" });
  await page.getByLabel("Texto principal", { exact: true }).fill("ANA");
  await page
    .getByRole("button", { name: "Adicionar código de barras", exact: true })
    .click();
  const barcode = page.getByRole("dialog", {
    name: "Código de barras do pedido",
  });
  await barcode
    .getByLabel("Código de barras", { exact: true })
    .fill("BR2684621549924");
  await barcode
    .getByRole("button", { name: "Aplicar código", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Adicionar à fila", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Processar fila", exact: true })
    .click();
  await expect(page.getByRole("article")).toContainText("Concluído");
  await page.getByText("Lotes anteriores · 1", { exact: true }).click();
  await page.getByText(/LOTE-TESTE ·/).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Kit de teste ANA BR2684621549924.pdf");
  const pdf = await PDFDocument.load(await readFile((await file.path())!));
  expect(pdf.getPageCount()).toBe(4);
  await expect(
    page.getByRole("heading", { name: /Documentos salvos · teste/ }),
  ).toBeVisible();
});

test("equal tracking codes remain separate orders and are highlighted in the import table", async ({
  page,
}) => {
  await page.goto("/__e2e/staff-pdf");
  await page
    .getByRole("button", { name: "Importar CSV ou XLSX", exact: true })
    .click();
  await page.getByLabel("Arquivo CSV", { exact: true }).setInputFiles({
    name: "mesma-entrega.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "pedido_plataforma,barcode,af_clean,nome\n001,BR264979796804XSPXLM14002828,Kit de teste,ANA\n001,BR264979796804XSPXLM14002828,Kit de teste,BIA",
    ),
  });
  await page
    .getByRole("button", { name: "Visualizar planilha importada", exact: true })
    .click();
  const table = page.getByRole("dialog", {
    name: "Planilha dos pedidos importados",
  });
  await expect(
    table.getByText("Código repetido · 2 itens", { exact: true }),
  ).toHaveCount(2);
  await table.getByRole("button", { name: "Fechar", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Adicionar 2 pedido(s) da página à fila",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Revisar fila principal", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(
    page.getByRole("article").filter({ hasText: "ANA" }),
  ).toContainText("BR264979796804XSPXLM14002828");
  await expect(
    page.getByRole("article").filter({ hasText: "BIA" }),
  ).toContainText("BR264979796804XSPXLM14002828");
});

test("uploading an individual PDF asks for a category and offers direct template editing", async ({
  page,
}) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  pdf.addPage([595, 842]);
  await page.goto("/__e2e/staff-pdf");
  await page
    .getByRole("button", { name: "Bases e moldes", exact: true })
    .click();
  await page
    .getByLabel("Enviar base PDF ou soltar aqui", { exact: true })
    .setInputFiles({
      name: "Nova Base.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await pdf.save()),
    });
  const category = page.getByRole("dialog", { name: "Categoria do PDF" });
  await category.getByLabel("Categoria", { exact: true }).fill("Cadernetas");
  await category
    .getByRole("button", { name: "Continuar", exact: true })
    .click();
  const uploading = page.getByRole("dialog", { name: "Importar bases PDF" });
  await uploading
    .getByRole("button", { name: "Enviar 1 PDF(s)", exact: true })
    .click();
  await expect(uploading.getByText("Enviado", { exact: true })).toBeVisible();
  await uploading
    .getByRole("button", { name: "Concluir", exact: true })
    .click();
  await page.getByText('Cadernetas', { exact: true }).click();
  await page
    .getByRole("button", { name: "Editar Nova Base.pdf", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Editor de molde PDF" });
  await expect(
    editor.getByLabel("Base para associar e testar"),
  ).not.toHaveValue("");
  await expect(editor.getByLabel("Nome do molde")).toHaveValue(
    "Nova Base_template__2p",
  );
});

test("folder import uses its root category for every PDF including nested files", async ({
  page,
}) => {
  const temporary = await mkdtemp(join(tmpdir(), "gb-pdf-import-"));
  try {
    const folder = join(temporary, "Agendas");
    await mkdir(join(folder, "Infantil"), { recursive: true });
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    const bytes = await pdf.save();
    await writeFile(join(folder, "Adulto.pdf"), bytes);
    await writeFile(join(folder, "Infantil", "Crianca.pdf"), bytes);
    await writeFile(join(folder, "ignorar.txt"), "Este arquivo não é um PDF.");
    await page.goto("/__e2e/staff-pdf");
    await page
      .getByRole("button", { name: "Bases e moldes", exact: true })
      .click();
    await page
      .getByLabel("Importar pasta de PDFs", { exact: true })
      .setInputFiles(folder);
    const upload = page.getByRole("dialog", { name: "Importar bases PDF" });
    await expect(upload.getByText("Agendas", { exact: true })).toHaveCount(2);
    await upload
      .getByRole("button", { name: "Enviar 2 PDF(s)", exact: true })
      .click();
    await expect(upload.getByText("Enviado", { exact: true })).toHaveCount(2);
    await upload.getByRole("button", { name: "Concluir", exact: true }).click();
    const category = page
      .locator("details")
      .filter({
        has: page.locator("summary").getByText("Agendas", { exact: true }),
      });
    await expect(category.locator('summary')).toBeVisible();
    await expect(category).not.toHaveAttribute('open', '');
    await category.locator('summary').click();
    await expect(
      category.getByRole("button", { name: "Editar Adulto.pdf", exact: true }),
    ).toBeVisible();
    await expect(
      category.getByRole("button", { name: "Editar Crianca.pdf", exact: true }),
    ).toBeVisible();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
