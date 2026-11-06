import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { zipSync, strToU8 } from "fflate";

test("staff queue snapshots independent lines, supports revision and exports four original-size pages", async ({
  page,
}) => {
  await page.goto("/__e2e/staff-pdf");
  await page
    .getByLabel("Base PDF da equipe", { exact: true })
    .selectOption({ label: "Kit de teste.pdf · Interno" });
  await page
    .getByRole("button", { name: "Editar texto e geometria", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Editar texto do PDF interno",
    exact: true,
  });
  await modal.getByLabel("Texto da linha interna", { exact: true }).fill("ANA");
  await modal.getByLabel("Negrito", { exact: true }).check();
  await modal.getByLabel("Contorno", { exact: true }).check();
  await modal.getByLabel("Curvatura", { exact: true }).fill("20");
  await modal
    .getByRole("button", { name: "Adicionar linha de texto", exact: true })
    .click();
  await modal
    .getByLabel("Texto da linha interna", { exact: true })
    .fill("SEGUNDA");
  await modal
    .getByLabel("Tamanho da linha interna", { exact: true })
    .fill("90");
  await modal
    .getByLabel("Página da prévia interna", { exact: true })
    .selectOption("3");
  await expect(modal.getByRole("status")).toHaveCount(0);
  await expect(modal.getByRole("alert")).toHaveCount(0);
  await modal
    .getByRole("button", { name: "Aplicar texto à edição", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  await page
    .getByRole("button", { name: "Adicionar à fila", exact: true })
    .click();
  await expect(page.getByRole("article")).toContainText("ANA / SEGUNDA");
  await page
    .getByRole("button", { name: "Editar item da fila", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Editar texto e geometria", exact: true })
    .click();
  await modal.getByRole("button", { name: "Linha 2", exact: true }).click();
  await expect(
    modal.getByLabel("Tamanho da linha interna", { exact: true }),
  ).toHaveValue("90");
  await modal
    .getByLabel("Texto da linha interna", { exact: true })
    .fill("REVISADA");
  await modal
    .getByRole("button", { name: "Aplicar texto à edição", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
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
test("XLSX conversion exports only checked columns and preserves literal codes", async ({
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
      `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nome</t></is></c><c r="B1" t="inlineStr"><is><t>Código</t></is></c><c r="C1" t="inlineStr"><is><t>Ignorar</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Ana</t></is></c><c r="B2" t="inlineStr"><is><t>00123</t></is></c><c r="C2" t="inlineStr"><is><t>Fora</t></is></c></row></sheetData></worksheet>`,
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
  await page.getByLabel("C · Ignorar", { exact: true }).uncheck();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Baixar CSV selecionado", exact: true })
    .click();
  const file = await downloading;
  const csv = await readFile((await file.path())!, "utf8");
  expect(csv).toContain("00123");
  expect(csv).toContain("Código");
  expect(csv).not.toContain("Ignorar");
  expect(csv).not.toContain("Fora");

  await page
    .getByRole("button", { name: "Converter e revisar pedidos" })
    .click();
  const record = page.getByRole("row").filter({ hasText: "00123" });
  await expect(record).toContainText("Ana");
  await record
    .getByLabel("Base do registro 2")
    .selectOption({ label: "Kit de teste.pdf" });
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
  await expect(page.getByRole("article")).toContainText("Kit de teste_00123");
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
  expect((await savingPdf).suggestedFilename()).toBe("Kit de teste_00123.pdf");
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
      "pedido_plataforma,barcode,af_clean,nome,prazo_envio\r\n00123,,Kit de teste,ANA,\r\n00124,,Desconhecido,BIA,",
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
