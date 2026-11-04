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
    page.getByRole("button", { name: "XLSX para CSV", exact: true }),
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
    .getByRole("button", { name: "XLSX para CSV", exact: true })
    .click();
  await page
    .getByLabel("Arquivo XLSX", { exact: true })
    .setInputFiles({
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
});
