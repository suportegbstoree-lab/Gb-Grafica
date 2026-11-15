import { test, expect } from "@playwright/test";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
} from "pdf-lib";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { defaultPdfLayout } from "../src/lib/staffPdf";

test("renames an uploaded PDF and reopens its existing mold", async ({ page }) => {
  await page.goto("/__e2e/staff-pdf");
  await page.getByRole("button", { name: "Bases e moldes", exact: true }).click();
  await page.getByText("Sem categoria", { exact: true }).click();
  await page.getByRole("button", { name: "Renomear Kit de teste.pdf", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Renomear base PDF" });
  await rename.getByRole("textbox", { name: "Nome do PDF" }).fill("Cadernos da equipe");
  await rename.getByRole("button", { name: "Salvar nome" }).click();
  await expect(rename).toHaveCount(0);
  await page.getByRole("button", { name: "Editar Cadernos da equipe.pdf", exact: true }).click();
  const mold = page.getByRole("dialog", { name: "Editor de molde PDF" });
  await expect(mold.getByRole("textbox", { name: "Nome do molde" })).toHaveValue("Kit de teste");
  await expect(mold.getByLabel("Base para associar e testar")).toHaveValue("a".repeat(32));
  await mold.getByRole("button", { name: "Fechar editor de molde" }).click();
  await page.getByRole("button", { name: "Edição e fila", exact: true }).click();
  await page.getByLabel("Base PDF da equipe").selectOption({ label: "Cadernos da equipe.pdf · Sem categoria" });
  await expect(page.getByLabel("Molde PDF da equipe")).toHaveValue("b".repeat(32));
});

test("lists bases in natural name order and links alphabet folders in bulk", async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), "gb-workshop-alphabets-"));
  try {
    const pdfRoot = join(root, "Cadernetas");
    const lettersRoot = join(root, "Alfabetos");
    await mkdir(pdfRoot);
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    const bytes = await pdf.save();
    for (const name of ["10 Azul", "Abelhas", "2 Verde"]) {
      await writeFile(join(pdfRoot, `${name}.pdf`), bytes);
    }
    const png = await readFile("e2e/fixtures/editor-cover.png");
    for (const [folder, letter] of [
      ["Abelhas", "É"],
      ["Álbum especial", "K"],
      ["Sem destino", "A"],
      ["10 Azul", "AB"],
      ["subpasta/2 Verde", "V"],
      ["duplicada/2 Verde", "V"],
    ]) {
      const path = join(lettersRoot, folder);
      await mkdir(path, { recursive: true });
      await writeFile(join(path, `${letter}.png`), png);
    }
    await page.goto("/__e2e/staff-pdf");
    await page
      .getByRole("button", { name: "Bases e moldes", exact: true })
      .click();
    await page
      .getByLabel("Importar pasta de PDFs", { exact: true })
      .setInputFiles(pdfRoot);
    const bases = page.getByRole("dialog", { name: "Importar bases PDF" });
    await bases
      .getByRole("button", { name: "Enviar 3 PDF(s)", exact: true })
      .click();
    await expect(bases.getByText("Enviado", { exact: true })).toHaveCount(3);
    await bases.getByRole("button", { name: "Concluir", exact: true }).click();
    await page.getByText("Cadernetas", { exact: true }).click();
    const editButtons = page.getByRole("button", { name: /^Editar .*\.pdf$/ });
    await expect.poll(() => editButtons.evaluateAll(
      buttons => buttons.map(button => button.getAttribute("aria-label")),
    )).toEqual([
      "Editar 2 Verde.pdf",
      "Editar 10 Azul.pdf",
      "Editar Abelhas.pdf",
    ]);
    const search = page.getByRole("textbox", { name: "Buscar base em Cadernetas" });
    await search.fill("abelhas");
    await expect(page.getByRole("button", { name: /^Editar .*\.pdf$/ })).toHaveAccessibleName("Editar Abelhas.pdf");
    await search.fill("");
    await page.getByLabel("Importar ou soltar JSON").setInputFiles({
      name: "templates.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          Abelhas_template__1p: defaultPdfLayout(),
          "Álbum especial_template": {
            ...defaultPdfLayout(),
            base_id: "a".repeat(32),
          },
        }),
      ),
    });
    await expect(
      page.getByText("Abelhas_template__1p", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Importar pastas de letras", { exact: true })
      .setInputFiles(lettersRoot);
    const letters = page.getByRole("dialog", {
      name: "Importar alfabetos em lote",
    });
    await expect(
      letters.getByText("Molde Abelhas_template__1p", { exact: true }),
    ).toBeVisible();
    await expect(
      letters
        .getByRole("listitem")
        .filter({ hasText: "Molde Álbum especial_template" }),
    ).toContainText("Kit de teste.pdf");
    await expect(
      letters.getByText(/Nenhuma base da equipe corresponde/),
    ).toBeVisible();
    await expect(letters.getByText(/Mais de uma pasta aponta/)).toHaveCount(2);
    await expect(letters.getByText(/AB\.png.*inválido/)).toBeVisible();
    await letters
      .getByRole("button", { name: "Importar 2 pasta(s)", exact: true })
      .click();
    await expect(letters.getByText("Vinculada", { exact: true })).toHaveCount(
      2,
    );
    await letters
      .getByRole("button", { name: "Concluir", exact: true })
      .click();
    await expect(
      page.getByText("Letras cadastradas · É", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Edição e fila", exact: true })
      .click();
    await expect(
      page.getByLabel("Base PDF da equipe").locator("option"),
    ).toHaveText([
      "Selecione o PDF",
      "2 Verde.pdf · Cadernetas",
      "10 Azul.pdf · Cadernetas",
      "Abelhas.pdf · Cadernetas",
      "Kit de teste.pdf · Sem categoria",
    ]);
    await page
      .getByRole("button", { name: "Buscar base PDF", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog", { name: "Buscar base PDF" })
        .getByRole("listitem"),
    ).toHaveText([
      "2 Verde.pdf · Cadernetas",
      "10 Azul.pdf · Cadernetas",
      "Abelhas.pdf · Cadernetas",
      "Kit de teste.pdf · Sem categoria",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("editing a queued order synchronizes only the mapped name cell and its warning", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/__e2e/staff-pdf");
  await page
    .getByRole("button", { name: "Planilha e CSV", exact: true })
    .click();
  await page.getByLabel("Arquivo CSV", { exact: true }).setInputFiles({
    name: "pedidos.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "pedido_plataforma,modelo,nome,observacao,barcode\n001,Kit de teste,,,BR2684621549924\n002,Kit de teste,Luísa,,BR2684621549925",
    ),
  });
  await page
    .getByRole("button", { name: "Enviar todos os pedidos válidos à fila" })
    .click();
  await page.getByRole("button", { name: "Revisar fila principal" }).click();
  const order = page
    .getByRole("article")
    .filter({ hasText: "BR2684621549924" });
  await expect(order).toContainText(
    "Campos em branco no CSV: nome, observacao.",
  );
  await order.getByRole("button", { name: "Editar item da fila" }).click();
  await page
    .getByRole("textbox", { name: "Texto principal", exact: true })
    .fill("Érica");
  await page.getByRole("button", { name: "Atualizar item da fila" }).click();
  await expect(order).toContainText("Érica");
  await expect(order).toContainText("Campos em branco no CSV: observacao.");
  await page
    .getByRole("button", { name: "Planilha e CSV", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Visualizar planilha importada" })
    .click();
  const table = page.getByRole("dialog", {
    name: "Planilha dos pedidos importados",
  });
  await expect(
    table
      .getByRole("row")
      .filter({ hasText: "001" })
      .getByText("Érica", { exact: true }),
  ).toBeVisible();
  await expect(
    table
      .getByRole("row")
      .filter({ hasText: "002" })
      .getByRole("button", { name: "Colar nome na linha 3" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await table.getByRole("button", { name: "Baixar CSV revisado" }).click();
  const csv = await readFile((await (await download).path())!, "utf8");
  expect(csv).toContain('"001","Kit de teste","Érica",,"BR2684621549924"');
  expect(csv).toContain('"002","Kit de teste",,,"BR2684621549925"');
  await table.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("button", { name: "Revisar fila principal" }).click();
  await order.getByRole("button", { name: "Editar item da fila" }).click();
  await page
    .getByRole("textbox", { name: "Texto principal", exact: true })
    .fill("");
  await page.getByRole("button", { name: "Atualizar item da fila" }).click();
  await expect(order).toContainText(
    "Campos em branco no CSV: nome, observacao.",
  );
  await page
    .getByRole("button", { name: "Planilha e CSV", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Visualizar planilha importada" })
    .click();
  await table
    .getByRole("button", { name: "BR2684621549924", exact: true })
    .click();
  await expect(table.getByRole("status")).toContainText("copiado");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "BR2684621549924",
  );
  await expect(
    table.getByRole("button", { name: "Colar nome na linha 3" }),
  ).toBeVisible();
  await page.evaluate(() =>
    navigator.clipboard.writeText("  Poliana Vitória\n"),
  );
  await table
    .getByRole("button", { name: "Colar nome na linha 2", exact: true })
    .click();
  await expect(table.getByRole("status")).toHaveText("Nome colado e salvo.");
  await expect(table.getByRole("row").filter({ hasText: "001" })).toContainText(
    "Poliana Vitória",
  );
  await table.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("button", { name: "Revisar fila principal" }).click();
  await expect(order).toContainText("Poliana Vitória");
  await expect(order).toContainText("Campos em branco no CSV: observacao.");
});

test("imports 30 PNG letters including accents from an existing mold", async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), "gb-png-letters-"));
  const folder = join(root, "Kit de teste");
  const wrong = join(root, "Outro kit");
  try {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    for (const path of [folder, wrong]) {
      await mkdir(path);
    }
    await writeFile(join(wrong, "A.png"), png);
    await Promise.all(
      [..."ABCDEFGHIJKLMNOPQRSTUVWXYZÁÇÉÓ"].map((letter) =>
        writeFile(join(folder, `${letter}.png`), png),
      ),
    );
    await page.goto("/__e2e/staff-pdf");
    await page
      .getByRole("button", { name: "Bases e moldes", exact: true })
      .click();
    const moldName = "Kit de teste_template__4p";
    await page.getByLabel("Importar ou soltar JSON").setInputFiles({
      name: "templates.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ [moldName]: defaultPdfLayout() })),
    });
    await page.getByLabel("Buscar molde", { exact: true }).fill(moldName);
    await page
      .getByRole("button", { name: `Editar molde ${moldName}`, exact: true })
      .click();
    const mold = page.getByRole("dialog", { name: "Editor de molde PDF" });
    const picker = mold.getByLabel("Importar pasta de letras", { exact: true });
    await expect(picker).toBeEnabled();
    await picker.setInputFiles(wrong);
    await expect(
      mold.getByRole("status").filter({ hasText: "Erro!" }),
    ).toContainText("Kit de teste");
    await picker.setInputFiles(folder);
    await expect(mold.getByText("Finalizado!", { exact: true })).toBeVisible();
    await expect(
      mold.getByText("Pasta vinculada · Kit de teste", { exact: true }),
    ).toBeVisible();
    const size = mold.getByLabel("Tamanho da inicial no molde (% da página)", { exact: true });
    await expect(size).toHaveAttribute("placeholder", "50");
    await size.fill("57");
    await mold.getByRole("button", { name: "Salvar molde", exact: true }).click();
    await expect(mold).toHaveCount(0);
    await page.getByRole("button", { name: `Editar molde ${moldName}`, exact: true }).click();
    await expect(size).toHaveValue("57");
    await mold.getByRole("button", { name: "Fechar editor de molde" }).click();
    await page.getByText("Sem categoria", { exact: true }).click();
    await expect(page.getByText(/^Letras cadastradas/)).toContainText(
      "Á, Ç, É, Ó",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
  context,
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
      `<worksheet xmlns="${ns}"><dimension ref="A1:G2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nome</t></is></c><c r="B1" t="inlineStr"><is><t>Nº de Pedido da Plataforma</t></is></c><c r="C1" t="inlineStr"><is><t>Modelo do SKU</t></is></c><c r="E1" t="inlineStr"><is><t>Prazo de Envio</t></is></c><c r="F1" t="inlineStr"><is><t>Qtd. do Produto</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Ana</t></is></c><c r="B2" t="inlineStr"><is><t>00123</t></is></c><c r="C2" t="inlineStr"><is><t>CADERNO - Kit de teste - BR</t></is></c><c r="D2" t="inlineStr"><is><t>Fora</t></is></c><c r="F2"><v>2.0</v></c></row></sheetData></worksheet>`,
    ),
  });
  await page.goto("/__e2e/staff-pdf?resume");
  await page
    .getByRole("button", { name: "Planilha e CSV", exact: true })
    .click();
  await page.getByLabel("Arquivo XLSX", { exact: true }).setInputFiles({
    name: "dados.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(bytes),
  });
  await context.setOffline(true);
  await page.getByLabel("SKU", { exact: true }).fill("Modelo do SKU");
  await context.setOffline(false);
  await page.reload();
  await page.getByRole("button", { name: "Planilha e CSV", exact: true }).click();
  await expect(page.getByLabel("SKU", { exact: true })).toHaveValue("Modelo do SKU");
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Baixar CSV selecionado", exact: true })
    .click();
  const file = await downloading;
  const csv = await readFile((await file.path())!, "utf8");
  expect(csv).toContain("00123");
  expect(csv).toContain(
    '"pedido_plataforma","barcode","af_clean","nome","prazo_envio","quantidade_itens"',
  );
  expect(csv.split(/\r?\n/).filter((line) => line === '"00123",,"Kit de teste",,,"1"'))
    .toHaveLength(2);
  expect(csv).not.toContain("Ignorar");
  expect(csv).not.toContain("Fora");

  await expect(
    page.getByRole("button", { name: "Baixar CSV com todas as colunas" }),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: "Converter e revisar pedidos" })
    .click();
  await expect(page.getByRole("row").filter({ hasText: "00123" })).toHaveCount(2);
  await page.reload();
  await page.getByRole("button", { name: "Planilha e CSV", exact: true }).click();
  const record = page.getByRole("row").filter({ has: page.getByLabel("Base do registro 2") });
  await expect(record).toContainText("Campos em branco: barcode, nome, prazo_envio.");
  await page
    .getByRole("button", { name: "Visualizar planilha importada" })
    .click();
  const review = page.getByRole("dialog", {
    name: "Planilha dos pedidos importados",
  });
  await expect(review.getByRole("columnheader")).toHaveText([
    "Linha",
    "pedido_plataforma",
    "barcode",
    "af_clean",
    "nome",
    "prazo_envio",
    "quantidade_itens",
    "Entrega",
    "Ações",
  ]);
  const copies = review.getByRole("row").filter({ hasText: "00123" });
  await expect(copies).toHaveCount(2);
  await copies.nth(1).getByRole("button", { name: "Excluir linha" }).click();
  await copies.nth(1).getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(copies).toHaveCount(1);
  await review.getByRole("button", { name: "Fechar", exact: true }).click();
  await record.getByLabel("Rastreio do registro 2").fill("BR2684621549924");
  await record.getByLabel("Base do registro 2").selectOption("a".repeat(32));
  await expect(record.getByLabel("Molde do registro 2")).toHaveValue(
    "b".repeat(32),
  );
  await page
    .getByRole("button", {
      name: "Enviar todos os pedidos válidos à fila",
      exact: true,
    })
    .click();
  await expect(page.getByText("Planilha enviada à fila para revisão.")).toBeVisible();
  await expect(page.getByLabel("SKU", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Revisar fila principal" }).click();
  await expect(page.getByRole("article")).toContainText(
    "Kit de teste BR2684621549924",
  );
  await page.getByRole("button", { name: "Editar item da fila" }).click();
  const text = page.getByRole("textbox", {
    name: "Texto principal",
    exact: true,
  });
  await expect(text).toHaveValue("");
  await text.fill("ANA REVISADA");
  await page.getByRole("button", { name: "Atualizar item da fila" }).click();
  await expect(page.getByRole("article")).toContainText("ANA REVISADA");
  const savingQueue = page.waitForEvent("download");
  await page.getByRole("button", { name: "Salvar fila em JSON" }).click();
  const queueFile = await savingQueue;
  await page.getByRole("button", { name: "Excluir da fila" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Excluir da fila" })
    .click();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page
    .getByLabel("Carregar fila JSON")
    .setInputFiles((await queueFile.path())!);
  await expect(page.getByRole("article")).toContainText("ANA REVISADA");
  await page.getByRole("button", { name: "Processar fila" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Gerar mesmo assim" })
    .click();
  await expect(page.getByRole("article")).toContainText("Concluído");
  const savingPdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar PDF-TEST-1" }).click();
  expect((await savingPdf).suggestedFilename()).toBe(
    "Kit de teste ANA REVISADA BR2684621549924.pdf",
  );
});

test("interrupted batches resume after reload without completing the same PDF twice", async ({ page }) => {
  await page.goto("/__e2e/staff-pdf?batches&resume");
  await page.getByRole("button", { name: "Planilha e CSV" }).click();
  await page.getByLabel("Arquivo CSV").setInputFiles({
    name: "lote.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "pedido_plataforma,modelo,texto,barcode\n" +
      "001,Kit de teste,Ana,BR2684621549924\n" +
      "002,Kit de teste,Bia,BR2684621549925\n" +
      "003,Kit de teste,Clara,BR2684621549926",
    ),
  });
  await page.getByRole("button", { name: "Enviar todos os pedidos válidos à fila" }).click();
  await page.getByRole("button", { name: "Revisar fila principal" }).click();
  await page.getByRole("textbox", { name: "Nome do lote (opcional)" }).fill("Lote retomado");
  await page.getByRole("button", { name: "Processar fila", exact: true }).click();
  await expect(page.getByText(/0 documento\(s\) concluído\(s\)\. A conexão foi interrompida/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Continuar lote", exact: true }).click();
  await expect(page.getByText(/A conexão foi interrompida/)).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Concluído" })).toHaveCount(1);
  await page.goto("/__e2e/staff-pdf?batches&resume&owner=outra-conta");
  await expect(page.getByText("Nenhum arquivo na fila.")).toBeVisible();
  await page.goto("/__e2e/staff-pdf?batches&resume");
  await expect(page.getByRole("heading", { name: "Fila principal · 3" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar lote", exact: true }).click();
  await expect(page.getByRole("article").filter({ hasText: "Concluído" })).toHaveCount(3);
  await expect(page.getByText("Lotes anteriores · 1")).toBeVisible();
  const completed = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("staff-pdf-resume-completions") || "[]"),
  );
  expect(completed).toHaveLength(3);
  expect(new Set(completed).size).toBe(3);
});

test("CSV matches model prefixes from af_clean, starts with empty names, and flags unknown models", async ({
  page,
}) => {
  await page.goto("/__e2e/staff-pdf");
  await page.getByRole("button", { name: "Importar CSV ou XLSX" }).click();
  await page.getByLabel("Arquivo CSV", { exact: true }).setInputFiles({
    name: "pedidos.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "pedido_plataforma,barcode,af_clean,nome\r\n" +
      "00123,BR2684621549924,Kit de teste COM NOME,ANA\r\n" +
      "00124,BR263172448223P,Desconhecido,BIA\r\n" +
      "00125,BR2684621549925,Kit de teste SEM NOME,CARLA\r\n",
    ),
  });
  const known = page.getByRole("row").filter({ hasText: "00123" });
  const unknown = page.getByRole("row").filter({ hasText: "00124" });
  await expect(known.getByLabel("Molde do registro 2")).toHaveValue(
    "b".repeat(32),
  );
  await expect(page.getByLabel("Molde do registro 4")).toHaveValue("b".repeat(32));
  await expect(unknown).toContainText("Confira a base e o molde.");
  await expect(known).toContainText("Campos em branco: nome.");
  await expect(
    page.getByLabel("Coluna do modelo").locator("option").filter({ hasText: "af_clean" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Visualizar planilha importada" }).click();
  const review = page.getByRole("dialog", { name: "Planilha dos pedidos importados" });
  await expect(review.getByRole("columnheader", { name: "af_clean" })).toBeVisible();
  const row = review.getByRole("row").filter({ hasText: "00123" });
  await row.getByRole("button", { name: "Editar linha" }).click();
  await expect(row.getByRole("textbox", { name: /af_clean/ })).toHaveValue("Kit de teste COM NOME");
  await expect(row.getByRole("textbox", { name: "nome, linha 2" })).toHaveValue("");
  await row.getByRole("textbox", { name: "nome, linha 2" }).fill("ANA");
  await row.getByRole("button", { name: "Salvar linha" }).click();
  const downloading = page.waitForEvent("download");
  await review.getByRole("button", { name: "Baixar CSV revisado" }).click();
  const csv = await readFile((await (await downloading).path())!, "utf8");
  expect(csv).toContain('"af_clean","nome"');
  expect(csv).toContain('"Kit de teste COM NOME","ANA"');
  expect(csv).toContain('"00124","BR263172448223P","Desconhecido",');
  expect(csv).not.toContain("BIA");
  await review.getByRole("button", { name: "Fechar", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Enviar todos os pedidos válidos à fila",
      exact: true,
    })
    .click();
  await expect(unknown).toBeVisible();
  await page.getByRole("button", { name: "Revisar fila principal" }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("article").filter({ hasText: "ANA" })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "BR2684621549925" }))
    .toContainText("Campos em branco no CSV: nome.");
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
    .getByRole("button", { name: "Editar código de barras", exact: true })
    .click();
  const barcode = page.getByRole("dialog", {
    name: "Código de barras do pedido",
  });
  await barcode
    .getByLabel("Código de barras", { exact: true })
    .fill("BR2684621549924");
  await barcode
    .getByLabel("Largura de referência (mm)", { exact: true })
    .fill("60");
  await barcode.getByLabel("Altura (mm)", { exact: true }).fill("14");
  await barcode.getByLabel("Escala horizontal", { exact: true }).fill("0.9");
  await barcode
    .getByRole("button", { name: "Aplicar código", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Adicionar à fila", exact: true })
    .click();
  const batchName = page.getByRole("textbox", { name: "Nome do lote (opcional)" });
  await expect(batchName).toHaveAttribute("placeholder", "Nome do lote (opcional)");
  await batchName.fill("Pedidos de terça");
  await page
    .getByRole("button", { name: "Processar fila", exact: true })
    .click();
  await expect(page.getByRole("article")).toContainText("Concluído");
  await page.getByText("Lotes anteriores · 1", { exact: true }).click();
  await page.getByText(/Pedidos de terça ·/).click();
  await page.getByRole("button", { name: "Renomear lote" }).click();
  await page.getByLabel("Novo nome do lote").fill("Pedidos revisados");
  await page.getByRole("button", { name: "Salvar nome" }).click();
  await expect(page.getByText(/Pedidos revisados ·/)).toBeVisible();
  const filter = page.getByRole("searchbox", {
    name: "Buscar arquivo em Pedidos revisados",
  });
  await filter.fill("inexistente");
  await expect(
    page.getByText("Nenhum arquivo encontrado neste lote."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Baixar lote", exact: true }),
  ).toBeEnabled();
  await filter.fill("TESTE ANA");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Kit de teste ANA BR2684621549924.pdf");
  const pdf = await PDFDocument.load(await readFile((await file.path())!));
  expect(pdf.getPageCount()).toBe(4);
  for (const index of [0, 2]) {
    const streams = pdf.getPage(index).node.Contents() as PDFArray;
    const commands = Array.from({ length: streams.size() }, (_, i) =>
      Buffer.from(
        decodePDFRawStream(streams.lookup(i, PDFRawStream)).decode(),
      ).toString(),
    ).join("\n");
    const scales = [...commands.matchAll(/^([\d.]+) 0 0 ([\d.]+) 0 0 cm$/gm)];
    expect(
      scales.filter(
        ([, w, h]) =>
          Math.abs(Number(w) - (30 * 72) / 25.4) < 0.001 &&
          Math.abs(Number(h) - (14 * 72) / 25.4) < 0.001,
      ),
    ).toHaveLength(2);
  }
  await expect(
    page.getByRole("heading", { name: /Documentos salvos · teste/ }),
  ).toBeVisible();
});

test("barcode defaults reach queued PDFs, individual sizes win, and clearing keeps previous batches", async ({ page }) => {
  await page.goto("/__e2e/staff-pdf?batches=true");
  const editDefault = page.getByRole("button", { name: "Editar código de barras padrão", exact: true });
  const defaults = page.getByRole("dialog", { name: "Editar código de barras padrão" });
  const individual = page.getByRole("dialog", { name: "Código de barras do pedido" });
  const height = "Altura (mm)";
  await editDefault.click();
  await expect(defaults.getByLabel(height, { exact: true })).toHaveValue("12");
  await expect(defaults.getByRole("textbox")).toHaveCount(0);
  await defaults.getByLabel(height, { exact: true }).fill("16");
  await defaults.getByRole("button", { name: "Salvar padrão" }).click();

  await page.getByLabel("Base PDF da equipe").selectOption("a".repeat(32));
  for (const name of ["HERDADO", "INDIVIDUAL"]) {
    await page.getByLabel("Texto principal", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Adicionar à fila", exact: true }).click();
  }
  const editCode = (name: string) => page.getByRole("article").filter({ hasText: name })
    .getByRole("button", { name: "Editar código de barras", exact: true });
  await editCode("INDIVIDUAL").click();
  await expect(individual.getByLabel(height, { exact: true })).toHaveValue("16");
  await individual.getByLabel(height, { exact: true }).fill("10");
  await individual.getByRole("button", { name: "Aplicar código" }).click();

  await editDefault.click();
  await defaults.getByLabel(height, { exact: true }).fill("19");
  await defaults.getByRole("button", { name: "Salvar padrão" }).click();
  for (const [name, expected] of [["HERDADO", "19"], ["INDIVIDUAL", "10"]]) {
    await editCode(name).click();
    await expect(individual.getByLabel(height, { exact: true })).toHaveValue(expected);
    await individual.getByRole("button", { name: "Fechar código de barras" }).click();
  }

  await page.getByRole("button", { name: "Processar fila", exact: true }).click();
  await expect(page.getByRole("article").filter({ hasText: "Concluído" })).toHaveCount(2);
  await page.getByText("Lotes anteriores · 1", { exact: true }).click();
  await page.getByText(/^LOTE-TESTE ·.*2 arquivo/).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar lote" }).click();
  const files = Object.entries(unzipSync(await readFile((await (await download).path())!)));
  expect(files).toHaveLength(2);
  for (const [filename, contents] of files) {
    const expected = filename.includes("HERDADO") ? 19 : 10;
    const streams = (await PDFDocument.load(contents)).getPage(0).node.Contents() as PDFArray;
    const commands = Array.from({ length: streams.size() }, (_, i) =>
      Buffer.from(decodePDFRawStream(streams.lookup(i, PDFRawStream)).decode()).toString(),
    ).join("\n");
    const heights = [...commands.matchAll(/^[\d.]+ 0 0 ([\d.]+) 0 0 cm$/gm)];
    expect(heights.filter(([, h]) => Math.abs(Number(h) - (expected * 72) / 25.4) < 0.001)).toHaveLength(2);
  }

  await editDefault.click();
  await defaults.getByLabel("Largura de referência (mm)").fill("55");
  await defaults.getByLabel("Escala horizontal").fill("1.2");
  await defaults.getByRole("button", { name: "Salvar padrão" }).click();
  await editDefault.click();
  await defaults.getByRole("button", { name: "Restaurar valores originais" }).click();
  await editDefault.click();
  await expect(defaults.getByLabel("Largura de referência (mm)")).toHaveValue("45");
  await expect(defaults.getByLabel(height, { exact: true })).toHaveValue("12");
  await expect(defaults.getByLabel("Escala horizontal")).toHaveValue("1.8");
  await defaults.getByRole("button", { name: "Fechar código de barras" }).click();
  await page.getByLabel("Texto principal", { exact: true }).fill("PENDENTE");
  await page.getByRole("button", { name: "Adicionar à fila", exact: true }).click();
  await page.getByRole("button", { name: "Excluir fila atual" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Excluir 3 itens da fila atual?" });
  await confirmation.getByRole("button", { name: "Voltar" }).click();
  await expect(page.getByRole("article")).toHaveCount(3);
  await page.getByRole("button", { name: "Excluir fila atual" }).click();
  await confirmation.getByRole("button", { name: "Excluir fila", exact: true }).click();
  await expect(page.getByText("Nenhum arquivo na fila.")).toBeVisible();
  await expect(page.getByText(/^LOTE-TESTE ·.*2 arquivo/)).toBeVisible();
});

test("mold extra lines keep their formatting and start blank in CSV orders", async ({ page }) => {
  await page.goto("/__e2e/staff-pdf");
  await page.getByRole("button", { name: "Bases e moldes" }).click();
  await page.getByRole("button", { name: "Criar molde", exact: true }).click();
  const mold = page.getByRole("dialog", { name: "Editor de molde PDF" });
  await mold.getByLabel("Nome do molde").fill("Molde Duas Linhas");
  await mold.getByLabel("Base para associar e testar").selectOption("a".repeat(32));
  await mold.getByRole("button", { name: "Adicionar linha de texto extra" }).click();
  const toolbar = page.getByRole("group", { name: "Formatação do texto" });
  await toolbar.getByLabel("Tamanho (px)", { exact: true }).fill("87");
  await toolbar.getByRole("button", { name: "Aumentar tamanho" }).click();
  await toolbar.getByRole("button", { name: "Negrito", exact: true }).click();
  await expect(toolbar.getByLabel("Texto da linha extra")).toHaveCount(0);
  await mold.getByRole("button", { name: "Salvar molde", exact: true }).click();

  await page.getByRole("button", { name: "Planilha e CSV" }).click();
  await page.getByLabel("Arquivo CSV").setInputFiles({
    name: "linhas.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("pedido_plataforma,af_clean,texto,linha_extra,barcode\n001,Molde Duas Linhas,ANA,IGNORAR,BR2684621549924"),
  });
  await page.getByRole("button", { name: "Enviar todos os pedidos válidos à fila" }).click();
  await page.getByRole("button", { name: "Revisar fila principal" }).click();
  await page.getByRole("button", { name: "Editar item da fila", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Texto principal", exact: true })).toHaveValue("ANA");
  await toolbar.getByLabel("Texto selecionado").selectOption({ label: "Linha extra 1" });
  await expect(toolbar.getByLabel("Texto da linha extra")).toHaveValue("");
  await expect(toolbar.getByLabel("Tamanho (px)", { exact: true })).toHaveValue("88");
  await expect(toolbar.getByRole("button", { name: "Negrito", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("admin keeps 51 PDFs processing across sections and splits them into batches of 50", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/__e2e/admin?pdf-queue=1");
  await page.getByRole("button", { name: "Gerar PDF", exact: true }).click();
  await page
    .getByRole("button", { name: "Planilha e CSV", exact: true })
    .click();
  const rows = Array.from(
    { length: 51 },
    (_, index) => `PED-${index + 1},BR${100000 + index},Kit de teste,ANA`,
  );
  await page.getByLabel("Arquivo CSV", { exact: true }).setInputFiles({
    name: "lote.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      ["pedido_plataforma,barcode,modelo,texto", ...rows].join("\n"),
    ),
  });
  await page
    .getByRole("button", { name: "Enviar todos os pedidos válidos à fila" })
    .click();
  await page.getByRole("button", { name: "Revisar fila principal" }).click();
  await expect(
    page.getByRole("heading", { name: "Fila principal · 51" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Processar fila", exact: true })
    .click();
  await page.getByRole("button", { name: "Pedidos", exact: true }).click();
  const progress = page.getByRole("region", {
    name: "Processamento da fila de PDFs",
  });
  await expect(progress.getByRole("progressbar")).toHaveAttribute("max", "51");
  for (const count of [20, 40]) {
    await expect(progress.getByRole("status")).toContainText(
      `Aguardando o limite de geração · ${count} de 51`,
    );
    await page.clock.fastForward(62000);
  }
  await expect(progress.getByRole("status")).toHaveText(
    "Processamento de PDFs concluído · 51 de 51 processado(s)",
  );
  await page.getByRole("button", { name: "Gerar PDF", exact: true }).click();
  await page.getByText("Lotes anteriores · 2", { exact: true }).click();
  await expect(page.getByText(/^LOTE-TESTE ·.*50 arquivo/)).toBeVisible();
  await expect(page.getByText(/^LOTE-TESTE-2 ·.*1 arquivo/)).toBeVisible();
});

test("quantity two creates two separate PDFs with the same order, model and tracking", async ({
  page,
}) => {
  await page.goto("/__e2e/staff-pdf?batches=true");
  await page
    .getByRole("button", { name: "Importar CSV ou XLSX", exact: true })
    .click();
  await page.getByLabel("Arquivo CSV", { exact: true }).setInputFiles({
    name: "mesma-entrega.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "pedido_plataforma,barcode,af_clean,nome,quantidade_itens\n001,BR264979796804XSPXLM14002828,Kit de teste,IGNORAR,2.0",
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
  await expect(table.getByRole("button", { name: "1", exact: true })).toHaveCount(2);
  await expect(table.getByRole("button", { name: /^Colar nome na linha/ })).toHaveCount(2);
  await table.getByRole("button", { name: "Fechar", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Enviar todos os pedidos válidos à fila",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Revisar fila principal", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("article").filter({ hasText: "BR264979796804XSPXLM14002828" })).toHaveCount(2);
  await page.getByRole("button", { name: "Processar fila", exact: true }).click();
  await page.getByRole("button", { name: "Gerar mesmo assim", exact: true }).click();
  await expect(page.getByRole("article").filter({ hasText: "Concluído" })).toHaveCount(2);
  await page.getByText("Lotes anteriores · 1", { exact: true }).click();
  await page.getByText(/^LOTE-TESTE ·.*2 arquivo/).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar lote", exact: true }).click();
  const pdfs = unzipSync(await readFile((await (await downloading).path())!));
  expect(Object.keys(pdfs).sort()).toEqual([
    "Kit de teste BR264979796804XSPXLM14002828 (2).pdf",
    "Kit de teste BR264979796804XSPXLM14002828.pdf",
  ]);
  for (const bytes of Object.values(pdfs))
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(4);
});

test("CSV review corrects and deletes queued rows and confirms remaining blanks before generation", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/__e2e/staff-pdf?batches=true");
  await page
    .getByRole("button", { name: "Planilha e CSV", exact: true })
    .click();
  await page.getByLabel("Arquivo CSV", { exact: true }).setInputFiles({
    name: "revisar.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "pedido_plataforma,,modelo,nome,barcode\n" +
        "001,,Kit de teste,,BR2684621549924\n" +
        "002,,Kit de teste,BIA,BR2684621549925\n" +
        "003,,Kit de teste,,",
    ),
  });
  const add = page.getByRole("button", { name: "Enviar todos os pedidos válidos à fila", exact: true });
  await expect(
    page.getByRole("row").filter({ hasText: "001" })
      .getByText("Campos em branco: Coluna B, nome.", { exact: true }),
  ).toBeVisible();
  await add.click();
  await page.getByRole("button", { name: "Revisar fila principal" }).click();
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(
    page.getByText("Campos em branco no CSV: Coluna B, nome, barcode."),
  ).toBeVisible();
  const process = page.getByRole("button", { name: "Processar fila" });
  await process.click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Gerar lote com campos em branco?",
  });
  await confirmation
    .getByRole("button", { name: "Voltar", exact: true })
    .click();
  const table = page.getByRole("dialog", {
    name: "Planilha dos pedidos importados",
  });
  const first = table.getByRole("row").filter({ hasText: "001" });
  await first.getByRole("button", { name: "001", exact: true }).click();
  await expect(table.getByRole("status")).toContainText("copiado");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("001");
  await first.getByRole("button", { name: "Editar linha" }).click();
  await first
    .getByRole("textbox", { name: "Coluna B, linha 2" })
    .fill("REVISTO");
  await first.getByRole("textbox", { name: "nome, linha 2" }).fill("ANA");
  await first.getByRole("button", { name: "Salvar linha" }).click();
  const removed = table.getByRole("row").filter({ hasText: "002" });
  await removed.getByRole("button", { name: "Excluir linha" }).click();
  await removed.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(removed).toHaveCount(0);
  const download = page.waitForEvent("download");
  await table.getByRole("button", { name: "Baixar CSV revisado" }).click();
  const edited = await readFile((await (await download).path())!, "utf8");
  expect(edited).toContain('"001","REVISTO","Kit de teste","ANA"');
  expect(edited).toContain('"003",,"Kit de teste",,');
  expect(edited).not.toContain('"002"');
  await table.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("button", { name: "Revisar fila principal" }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(
    page
      .getByRole("article")
      .filter({ has: page.getByText("ANA", { exact: true }) }),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole("article")
      .filter({ has: page.getByText("BIA", { exact: true }) }),
  ).toHaveCount(0);
  await process.click();
  await confirmation.getByRole("button", { name: "Gerar mesmo assim" }).click();
  await expect(
    page.getByRole("article").filter({ hasText: "Concluído" }),
  ).toHaveCount(2);
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
    .getByLabel("Selecionar base PDF", { exact: true })
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
  await page.getByText("Cadernetas", { exact: true }).click();
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

test("folder import keeps the root category and attaches letters to the matching nested PDF", async ({
  page,
}) => {
  const temporary = await mkdtemp(join(tmpdir(), "gb-pdf-import-"));
  try {
    const folder = join(temporary, "Agendas");
    await mkdir(join(folder, "Infantil", "Crianca"), { recursive: true });
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    const bytes = await pdf.save();
    await writeFile(join(folder, "00-Danificado.pdf"), "PDF inválido");
    await writeFile(join(folder, "Adulto.pdf"), bytes);
    await writeFile(join(folder, "Infantil", "Crianca.pdf"), bytes);
    await writeFile(
      join(folder, "Infantil", "Crianca", "T.png"),
      await readFile("e2e/fixtures/editor-cover.png"),
    );
    await writeFile(join(folder, "ignorar.txt"), "Este arquivo não é um PDF.");
    await writeFile(
      join(folder, "Infantil", "Crianca", "Thumbs.db"),
      "Metadados",
    );
    await page.goto("/__e2e/staff-pdf");
    await page
      .getByRole("button", { name: "Bases e moldes", exact: true })
      .click();
    await page
      .getByLabel("Importar pasta de PDFs", { exact: true })
      .setInputFiles(folder);
    const upload = page.getByRole("dialog", { name: "Importar bases PDF" });
    await expect(upload.getByText("Agendas", { exact: true })).toHaveCount(3);
    await expect(
      upload.getByRole("row").filter({ hasText: "Crianca.pdf" }),
    ).toContainText("Pasta de letras encontrada");
    await upload
      .getByRole("button", { name: "Enviar 3 PDF(s)", exact: true })
      .click();
    await expect(upload.getByText("Enviado", { exact: true })).toHaveCount(2);
    await expect(upload.getByRole("status")).toContainText(
      "2 PDF(s) enviado(s). 1 com erro.",
    );
    await upload.getByRole("button", { name: "Concluir", exact: true }).click();
    const category = page.locator("details").filter({
      has: page.locator("summary").getByText("Agendas", { exact: true }),
    });
    await expect(category.locator("summary")).toBeVisible();
    await expect(category).not.toHaveAttribute("open", "");
    await category.locator("summary").click();
    await expect(
      category.getByRole("button", { name: "Editar Adulto.pdf", exact: true }),
    ).toBeVisible();
    await expect(
      category.getByRole("button", { name: "Editar Crianca.pdf", exact: true }),
    ).toBeVisible();
    await expect(
      category.getByText("Letras cadastradas · T", { exact: true }),
    ).toBeVisible();
    const base = category
      .locator("div.rounded-lg")
      .filter({ hasText: "Crianca.pdf" });
    await expect(
      base.getByText("Pasta vinculada · Crianca", { exact: true }),
    ).toBeVisible();
    await base
      .getByLabel("Importar pasta de letras")
      .setInputFiles(join(folder, "Infantil", "Crianca"));
    await expect(base.getByText("Finalizado!", { exact: true })).toBeVisible();
    await base
      .getByRole("button", { name: "Editar Crianca.pdf", exact: true })
      .click();
    const mold = page.getByRole("dialog", { name: "Editor de molde PDF" });
    await mold
      .getByLabel("Tamanho da inicial no molde (% da página)")
      .fill("45");
    await mold
      .getByRole("button", { name: "Salvar molde", exact: true })
      .click();
    await base
      .getByRole("button", { name: "Editar Crianca.pdf", exact: true })
      .click();
    await expect(
      mold.getByLabel("Tamanho da inicial no molde (% da página)"),
    ).toHaveValue("45");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
