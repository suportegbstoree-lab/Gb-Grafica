import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
test("admin product name and category filters combine, normalize accents, and clear", async ({
  page,
}) => {
  await page.goto("/__e2e/admin");
  await page
    .getByLabel("Filtrar produtos por categoria")
    .selectOption({ label: "Livros de Receita" });
  await expect(
    page.getByRole("button", {
      name: "Editar Livro de Receitas Personalizado",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Editar Carimbo", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Buscar produto por nome")
    .fill("RECEITAS personalizado");
  await expect(
    page.getByText("1 produto(s) encontrado(s)", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Buscar produto por nome").fill("nada coincide");
  await expect(
    page.getByText("0 produto(s) encontrado(s)", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Limpar filtros", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Editar Carimbo", exact: true }),
  ).toBeVisible();
});
test("staff generator shares the text editor, locks the automatic back, saves, reopens, downloads, emails and creates WhatsApp links", async ({
  page,
}, info) => {
  let checkoutCalls = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/checkout")) checkoutCalls++;
  });
  await page.goto("/__e2e/admin");
  await page
    .getByRole("button", {
      name: "Editar Livro de Receitas Personalizado",
      exact: true,
    })
    .click();
  const product = page.getByRole("dialog", {
    name: "Editar Produto",
    exact: true,
  });
  await product
    .getByLabel("Selecionar imagem principal do computador")
    .setInputFiles("e2e/fixtures/editor-template.pdf");
  await expect(product.getByText(/PDF: editor-template.pdf/)).toBeVisible();
  await product
    .getByRole("button", { name: "Salvar Produto", exact: true })
    .click();
  await expect(product).toHaveCount(0);
  await page.getByRole("button", { name: "Gerar PDF", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Personalizar PDF editor-template.pdf",
      exact: true,
    })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Personalizar texto",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Incluir contracapa")).toBeChecked();
  await expect(editor.getByLabel("Incluir contracapa")).toBeDisabled();
  await expect(
    editor.getByRole("radio", {
      name: "Automática: mesma arte da capa, sem o texto personalizado",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    editor.getByLabel("Imagem da contracapa", { exact: true }),
  ).toHaveCount(0);
  await editor
    .getByLabel("Texto da personalização", { exact: true })
    .fill("Ana\nDesigner");
  await page.screenshot({ path: info.outputPath("staff-editor.png") });
  await editor
    .getByRole("button", { name: "Aplicar e gerar modelo", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "salvo por sete dias" }),
  ).toBeVisible();
  const downloadButton = page
    .getByRole("button", { name: /^Baixar PDF PDF-/ })
    .last();
  const filename = (await downloadButton.textContent())!
    .replace("Baixar PDF ", "")
    .trim();
  const download = page.waitForEvent("download");
  await downloadButton.click();
  const artifact = await download;
  expect(artifact.suggestedFilename()).toBe(`${filename}.pdf`);
  const pdf = await PDFDocument.load(await readFile((await artifact.path())!));
  expect(pdf.getPageCount()).toBe(2);
  await page
    .getByRole("button", { name: `Visualizar ${filename}`, exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: filename, exact: true }).locator("iframe"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fechar PDF", exact: true }).click();
  await page
    .getByRole("button", { name: `Enviar por e-mail ${filename}`, exact: true })
    .click();
  const mail = page.getByRole("dialog", {
    name: `Enviar ${filename} por e-mail`,
    exact: true,
  });
  await mail.getByLabel("E-mail do destinatário").fill("buyer@example.test");
  await mail
    .getByRole("button", { name: "Enviar PDF por e-mail", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "aceitou o envio" }),
  ).toBeVisible();
  await expect(
    mail.getByRole("button", { name: "Enviar PDF por e-mail", exact: true }),
  ).toBeDisabled();
  await mail
    .getByRole("button", { name: "Fechar envio por e-mail", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: `WhatsApp / copiar link ${filename}`,
      exact: true,
    })
    .click();
  const share = page.getByRole("dialog", {
    name: "Compartilhar PDF",
    exact: true,
  });
  await expect(
    share.getByRole("link", { name: "Compartilhar no WhatsApp", exact: true }),
  ).toHaveAttribute("href", /^https:\/\/wa.me\/\?text=/);
  await share
    .getByRole("button", { name: "Fechar compartilhamento", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Atualizar documentos", exact: true })
    .click();
  await expect(downloadButton).toBeVisible();
  expect(checkoutCalls).toBe(0);
  await page.screenshot({ path: info.outputPath("staff-documents.png") });
  await page.getByRole("button", { name: "Operações", exact: true }).click();
  await expect(page.getByRole("table").last()).toContainText(
    "PDF interno gerado",
  );
  await expect(page.getByRole("table").last()).toContainText(filename);
  await page.screenshot({
    path: info.outputPath("staff-operations.png"),
    fullPage: true,
  });
});
test("document-only employee cannot open orders, products or team productivity pages", async ({
  page,
}) => {
  await page.goto("/__e2e/team/admin?permissions=documents.generate");
  await expect(
    page.getByRole("heading", { name: "Gerar PDF interno", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pedidos", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Produtos", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Operações", exact: true }),
  ).toHaveCount(0);
});
test("staff export repeats the original vector front on the back with no text or initial, even when source has page two", async ({
  page,
}) => {
  await page.goto("/__e2e/store");
  const bytes = (await readFile("e2e/fixtures/editor-template.pdf")).toString(
    "base64",
  );
  const result = await page.evaluate(async (bytes) => {
    const previewPath = "/src/services/pdfPreview.ts",
      exportPath = "/src/services/personalizationExport.ts";
    const renderer = await import(previewPath),
      service = await import(exportPath);
    const original = new Blob(
        [Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))],
        { type: "application/pdf" },
      ),
      pages = await renderer.pdfPreviewPages(original),
      out = await service.exportPersonalizationPdf({
        title: "Staff",
        originalPdf: original,
        repeatFrontForBack: true,
        pages: [
          { label: "Capa", blob: pages[0] },
          { label: "Contracapa", blob: pages[0] },
        ],
      });
    const rendered = await renderer.pdfPreviewPages(out);
    async function pixels(blob: Blob) {
      const image = await createImageBitmap(blob),
        canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      image.close();
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    }
    const a = await pixels(pages[0]),
      b = await pixels(rendered[1]);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    return diff / a.length;
  }, bytes);
  expect(result).toBeLessThan(0.1);
});

test("alphabet folder uploads original PNG bytes with at most three concurrent requests", async ({
  page,
}, info) => {
  const { mkdir, writeFile } = await import("node:fs/promises"),
    { join } = await import("node:path");
  const folder = info.outputPath("editor-template");
  await mkdir(folder, { recursive: true });
  const bytes = await readFile("e2e/fixtures/editor-template/A.png");
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    await writeFile(join(folder, `${letter}.png`), bytes);
  await page.goto("/__e2e/admin");
  await page
    .getByRole("button", {
      name: "Editar Livro de Receitas Personalizado",
      exact: true,
    })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Editar Produto",
    exact: true,
  });
  await editor
    .getByLabel("Selecionar imagem principal do computador")
    .setInputFiles("e2e/fixtures/editor-template.pdf");
  await expect(editor.getByText(/PDF: editor-template.pdf/)).toBeVisible();
  let active = 0,
    peak = 0,
    finished = 0;
  await page.route("**/__e2e/uploads/*", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    expect(route.request().postDataBuffer()).toEqual(bytes);
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 60));
    const response = await route.fetch();
    await route.fulfill({ response });
    active--;
    finished++;
  });
  await editor
    .getByLabel("Pasta de letras de editor-template.pdf")
    .setInputFiles(folder);
  await expect(editor.getByText(/Letras: A, B, C, D/)).toBeVisible();
  expect(finished).toBe(26);
  expect(peak).toBe(3);
  await expect(
    editor.getByRole("button", { name: "Salvar Produto", exact: true }),
  ).toBeEnabled();
});

test("automatic operations and workday controls fit a mobile viewport", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/operations/production");
  await expect(
    page.getByRole("heading", { name: "Operações · Produção", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Atividades concluídas", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  await page.screenshot({
    path: info.outputPath("operations-mobile.png"),
    fullPage: true,
  });
});
