import { test, expect } from "@playwright/test";
import { PDFDocument, rgb } from "pdf-lib";
import { readFile, writeFile } from "node:fs/promises";

test("linked product uses its own base, calculates R$32 and keeps the preview in the site", async ({
  page,
  context,
}) => {
  await page.goto("/produto/caderneta-azul?variations=1");
  const card = page.locator("article#produto-caderneta-azul");
  await card.getByRole("button", { name: /^Com imagem/ }).click();
  await card.getByRole("button", { name: /^Com nome/ }).click();
  await expect(card).toContainText("32,00");
  await card
    .getByRole("button", { name: "Personalizar e conferir modelo" })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Personalizar produto",
    exact: true,
  });
  const cover = editor.getByRole("img", {
    name: "Prévia da capa personalizada",
  });
  await expect(cover).toBeVisible();
  await expect(
    editor.getByRole("img", { name: "Prévia da contracapa" }),
  ).toBeVisible();
  const sourceRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/__e2e/cover.png"))
      sourceRequests.push(request.url());
  });
  const before = await cover.evaluate((canvas: HTMLCanvasElement) =>
    canvas.toDataURL(),
  );
  await editor.getByLabel("Nome ou texto do molde").fill("ANA\nMARIA");
  await expect(cover).toBeVisible();
  await expect
    .poll(() =>
      cover.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
    )
    .not.toBe(before);
  expect(sourceRequests).toHaveLength(0);
  await expect(
    editor.getByRole("button", { name: "Confirmar personalização" }),
  ).toBeEnabled();
  await expect(editor.getByRole("combobox")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/product-linked-editor.png",
    fullPage: false,
  });
  await editor
    .getByRole("button", { name: "Confirmar personalização" })
    .click();
  const viewer = page.getByRole("dialog", {
    name: "Modelo personalizado",
    exact: true,
  });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("button", { name: /JPG|PDF/ })).toHaveCount(0);
  await viewer
    .getByRole("button", { name: "Fechar visualização do modelo" })
    .click();
  // Browsing advertising images must not discard the composed production model.
  await card.getByRole("button", { name: /Mostrar imagem 2/ }).click();
  await expect(
    card.getByRole("button", { name: "Adicionar ao Carrinho" }),
  ).toBeEnabled();
  await card.getByRole("button", { name: "Adicionar ao Carrinho" }).click();
  const item = JSON.parse(
    (await page.getByTestId("e2e-cart").textContent()) || "[]",
  )[0];
  expect(item.preco).toBe("32.00");
  expect(item.textoMolde).toBe("ANA\nMARIA");
  expect(item.arquivoPath).toBeUndefined();
  expect(item.imagemClientePath).toBeUndefined();
  expect(item.moldeRevisao).toBe("a".repeat(32));
  expect(context.pages()).toHaveLength(1);
});
test("choices without image and name produce a plain model on mobile and invalidate prior composition", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/produto/caderneta-azul?variations=1");
  const card = page.locator("article#produto-caderneta-azul");
  await card.getByRole("button", { name: /^Sem imagem/ }).click();
  await card.getByRole("button", { name: /^Sem nome/ }).click();
  await expect(card).toContainText("25,00");
  await expect(card.locator("input[type=file]")).toHaveCount(0);
  await card
    .getByRole("button", { name: "Personalizar e conferir modelo" })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Personalizar produto",
    exact: true,
  });
  await expect(editor.getByRole("textbox")).toHaveCount(0);
  await editor
    .getByRole("button", { name: "Confirmar personalização" })
    .click();
  await page
    .getByRole("button", { name: "Fechar visualização do modelo" })
    .click();
  await expect(
    card.getByRole("button", { name: "Adicionar ao Carrinho" }),
  ).toBeEnabled();
  await card.getByRole("button", { name: /^Com nome/ }).click();
  await expect(
    card.getByRole("button", { name: "Adicionar ao Carrinho" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("production PDF preserves all four pages and reuses the exact workshop text and image rendering", async ({
  page,
}) => {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 4; i++) {
    const p = pdf.addPage([192, 288]);
    p.drawRectangle({
      x: 0,
      y: 0,
      width: 192,
      height: 288,
      color: rgb(0.94, 0.96, 1),
    });
    p.drawText("Base " + (i + 1), { x: 20, y: 20, size: 10 });
  }
  const bytes = Array.from(await pdf.save());
  await page.goto("/?variations=1");
  const result = await page.evaluate(async (bytes) => {
    // These are application modules served by the isolated Vite fixture.
    const module = (path: string) => import(path);
    const render = await module("/src/services/staffPdfRender.ts"),
      lib = await module("/src/lib/productCustomization.ts"),
      layouts = await module("/src/lib/staffPdf.ts"),
      preview = await module("/src/services/productPdfPreview.ts"),
      pdfPreview = await module("/src/services/pdfPreview.ts");
    const original = new Blob([new Uint8Array(bytes)], {
        type: "application/pdf",
      }),
      pages = await pdfPreview.pdfPreviewPages(original, 16),
      urls = pages.map((p: Blob) => URL.createObjectURL(p));
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#d14d8c";
    ctx.fillRect(0, 0, 120, 80);
    const image = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png"),
    );
    const binding = {
      revision: "a".repeat(32),
      baseId: "b".repeat(32),
      baseRevision: "c".repeat(32),
      layoutId: "d".repeat(32),
      layoutRevision: "e".repeat(32),
      fonts: [],
      layout: {
        ...layouts.defaultPdfLayout(),
        pos_x: 100,
        pos_y: 200,
        max_width_pixels: 600,
        max_height_pixels: 200,
        font_size: 80,
        pos_x_landscape: 100,
        pos_y_landscape: 200,
        max_width_pixels_landscape: 600,
        max_height_pixels_landscape: 200,
      },
      pdf: {
        id: "f".repeat(32),
        path: "unused.pdf",
        name: "Teste.pdf",
        pages: urls,
      },
    };
    try {
      const recipe = lib.productPdfOrder(binding, "ANA", true),
        output = await render.exportStaffPdf(
          original,
          recipe.job,
          recipe.fonts,
          recipe.fitMargin,
          undefined,
          image,
          recipe.fullPage,
        );
      const customer = await preview.productPdfPreview(
          binding,
          "ANA",
          true,
          image,
        ),
        exported = await pdfPreview.staffPdfPreviewPage(output, 1);
      const pixels = async (blob: Blob) => {
        const bitmap = await createImageBitmap(blob),
          canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const a = await pixels(customer.pages[0].blob),
        b = await pixels(exported);
      let different = 0;
      for (let i = 0; i < a.length; i++)
        if (Math.abs(a[i] - b[i]) > 12) different++;
      return {
        bytes: Array.from(new Uint8Array(await output.arrayBuffer())),
        different: different / a.length,
        preview: Array.from(
          new Uint8Array(await customer.pages[0].blob.arrayBuffer()),
        ),
      };
    } finally {
      urls.forEach(URL.revokeObjectURL);
    }
  }, bytes);
  const output = await PDFDocument.load(new Uint8Array(result.bytes));
  expect(output.getPageCount()).toBe(4);
  for (const p of output.getPages())
    expect([p.getWidth(), p.getHeight()]).toEqual([192, 288]);
  expect(result.different).toBeLessThan(0.015);
  await writeFile(
    "test-results/product-linked-production.pdf",
    new Uint8Array(result.bytes),
  );
  await writeFile(
    "test-results/product-linked-preview.png",
    new Uint8Array(result.preview),
  );
});

test("four-page storefront models can be checked in the editor, viewer and cart", async ({
  page,
}) => {
  await page.goto("/produto/caderneta-azul?variations=4");
  const card = page.locator("article#produto-caderneta-azul");
  await card.getByRole("button", { name: /^Sem imagem/ }).click();
  await card.getByRole("button", { name: /^Com nome/ }).click();
  await card
    .getByRole("button", { name: "Personalizar e conferir modelo" })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Personalizar produto",
    exact: true,
  });
  await editor.getByLabel("Nome ou texto do molde").fill("ANA");
  await expect(
    editor.getByLabel("Página da prévia").locator("option"),
  ).toHaveCount(4);
  await editor.getByLabel("Página da prévia").selectOption("2");
  await expect(
    editor.locator("figcaption").filter({ hasText: "Página 3" }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Confirmar personalização" })
    .click();
  const viewer = page.getByRole("dialog", {
    name: "Modelo personalizado",
    exact: true,
  });
  await expect(
    viewer.getByRole("button", { name: "Página 4", exact: true }),
  ).toBeVisible();
  await viewer
    .getByRole("button", { name: "Fechar visualização do modelo" })
    .click();
  await card.getByRole("button", { name: "Adicionar ao Carrinho" }).click();
  const item = JSON.parse(
    (await page.getByTestId("e2e-cart").textContent()) || "[]",
  )[0];
  expect(item.paginasModelo).toHaveLength(2);
  await page
    .getByRole("button", { name: "Abrir carrinho", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Visualizar modelo · capa e contracapa",
      exact: true,
    })
    .click();
  await expect(
    viewer.getByRole("button", { name: "Página 3", exact: true }),
  ).toBeVisible();
});

test("admin keeps the advertising image while adding a separate production base and option controls", async ({
  page,
}) => {
  await page.goto("/__e2e/admin");
  await page
    .getByRole("button", { name: "Editar Carimbo", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Editar Produto",
    exact: true,
  });
  const advertising = await editor
    .getByLabel("Imagem Principal (URL)")
    .inputValue();
  await editor
    .getByLabel("Enviar imagem-base", { exact: true })
    .setInputFiles("e2e/fixtures/editor-cover.png");
  await expect(editor.getByAltText("Imagem-base de impressão")).toBeVisible();
  await expect(editor.getByLabel("Imagem Principal (URL)")).toHaveValue(
    advertising,
  );
  await editor
    .getByRole("button", { name: "Adicionar variação", exact: true })
    .click();
  await editor
    .getByLabel("Tipo de variação", { exact: true })
    .selectOption({ label: "Imagem" });
  await editor.getByLabel("Nova opção de Imagem").fill("Com imagem");
  await editor
    .getByRole("button", { name: "Adicionar opção", exact: true })
    .click();
  await editor.getByLabel("Nova opção de Imagem").fill("Sem imagem");
  await editor
    .getByRole("button", { name: "Adicionar opção", exact: true })
    .click();
  await editor.getByLabel("Modo de preço").selectOption("adicionais");
  await editor
    .getByLabel("Adicional Imagem: Com imagem", { exact: true })
    .fill("10");
  await editor
    .getByLabel("imagem Imagem: Sem imagem", { exact: true })
    .selectOption("false");
  await expect(
    editor.getByLabel("Adicional Imagem: Com imagem", { exact: true }),
  ).toHaveValue("10");
  await expect(
    editor.getByLabel("imagem Imagem: Sem imagem", { exact: true }),
  ).toHaveValue("false");
  await expect(editor.getByLabel("Imagem Principal (URL)")).toHaveValue(
    advertising,
  );
});

test("base e molde têm busca independente, correspondência inicial e reaproveitamento da cópia", async ({
  page,
}) => {
  const copies: unknown[] = [];
  await page.route("**/__e2e/product-pdf-copy", async (route) => {
    copies.push(route.request().postDataJSON());
    const id = "f".repeat(32);
    const path = `catalog/templates/1yi50l93z/${id}.pdf`;
    await route.fulfill({
      json: {
        template: { id, path, name: "Álbum.pdf", pages: ["/__e2e/cover.png"] },
        assets: [{ path, url: path }],
      },
    });
  });
  await page.goto("/__e2e/admin?pdf-binding=1");
  await page
    .getByRole("button", { name: "Editar Carimbo", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Editar Produto" });
  await editor
    .getByRole("button", { name: "Carregar bases e moldes da oficina" })
    .click();
  const base = editor.getByLabel("Base PDF do produto");
  const layout = editor.getByLabel("Molde de edição do produto");
  await expect(base.locator("option")).toHaveText([
    "Selecione",
    "Álbum.pdf",
    "Zebra.pdf",
  ]);
  await expect(layout.locator("option")).toHaveText([
    "Selecione",
    "Álbum_template",
    "Zebra_template",
  ]);
  await layout.selectOption({ label: "Zebra_template" });
  await expect(base).toHaveValue("z".repeat(32));
  await base.selectOption("");
  await editor
    .getByRole("button", { name: "Buscar base pdf", exact: true })
    .click();
  await editor
    .getByRole("searchbox", { name: "Filtrar base pdf pelo nome" })
    .fill("album");
  await expect(base.locator("option")).toHaveText(["Selecione", "Álbum.pdf"]);
  await base.selectOption({ label: "Álbum.pdf" });
  await expect(layout).toHaveValue("e".repeat(32));
  await editor
    .getByRole("button", { name: "Buscar molde de edição", exact: true })
    .click();
  await editor
    .getByRole("searchbox", { name: "Filtrar molde de edição pelo nome" })
    .fill("zeb");
  await layout.selectOption({ label: "Zebra_template" });
  await expect(base).toHaveValue("b".repeat(32));
  await editor
    .getByRole("button", { name: "Vincular / atualizar molde" })
    .click();
  await expect(
    editor.getByText("Vinculado: Álbum.pdf · 1 páginas"),
  ).toBeVisible();
  expect(copies).toHaveLength(1);
  await layout.selectOption({ label: "Álbum_template" });
  await editor
    .getByRole("button", { name: "Vincular / atualizar molde" })
    .click();
  await expect(
    editor.getByRole("button", { name: "Vincular / atualizar molde" }),
  ).toBeEnabled();
  expect(copies).toHaveLength(1);
});

test("a opção usa sua capa e inicial decorativa na prévia e no carrinho", async ({
  page,
}) => {
  await page.route("**/__e2e/option-cover.png", (route) =>
    route.fulfill({
      path: "e2e/fixtures/editor-cover.png",
      contentType: "image/png",
    }),
  );
  await page.goto("/produto/caderneta-azul?variations=option");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 10;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ff00ff";
    context.fillRect(0, 0, 10, 10);
    return canvas.toDataURL().split(",")[1];
  });
  await page.route("**/__e2e/option-letter-a.png", (route) =>
    route.fulfill({
      body: Buffer.from(png, "base64"),
      contentType: "image/png",
    }),
  );
  const card = page.locator("article#produto-caderneta-azul");
  await card.getByRole("button", { name: /^Com imagem/ }).click();
  await card.getByRole("button", { name: /^Com nome/ }).click();
  const open = card.getByRole("button", {
    name: "Personalizar e conferir modelo",
  });
  const modal = page.getByRole("dialog", {
    name: "Personalizar produto",
    exact: true,
  });
  const optionCover = page.waitForRequest("**/__e2e/option-cover.png");
  await open.click();
  await optionCover;
  await expect(
    modal.getByRole("img", { name: "Prévia da capa personalizada" }),
  ).toBeVisible();
  const text = modal.getByLabel("Nome ou texto do molde");
  await text.fill("Teste");
  await expect(
    modal.getByRole("status").filter({ hasText: "A letra T" }),
  ).toContainText("A letra T não está cadastrada");
  const letter = page.waitForRequest("**/__e2e/option-letter-a.png");
  await text.fill("Ana");
  await letter;
  const centerPixel = (name: string) =>
    modal
      .getByRole("img", { name })
      .evaluate((element: HTMLCanvasElement) =>
        Array.from(
          element
            .getContext("2d")!
            .getImageData(
              Math.floor(element.width / 2),
              Math.floor(element.height / 2),
              1,
              1,
            ).data,
        ),
      );
  await expect
    .poll(() => centerPixel("Prévia da capa personalizada"))
    .toEqual([255, 0, 255, 255]);
  expect(await centerPixel("Prévia da contracapa")).not.toEqual([
    255, 0, 255, 255,
  ]);
  await modal.getByRole("button", { name: "Confirmar personalização" }).click();
  await page
    .getByRole("button", { name: "Fechar visualização do modelo" })
    .click();
  await card.getByRole("button", { name: "Adicionar ao Carrinho" }).click();
  const [item] = JSON.parse(
    (await page.getByTestId("e2e-cart").textContent()) || "[]",
  );
  expect(item.moldeRevisao).toBe("6".repeat(32));
  expect(JSON.parse(item.inicialReferencia)).toEqual([
    "A",
    `catalog/products/caderneta-azul/${"7".repeat(32)}.png`,
    60,
  ]);

  await card.getByRole("button", { name: /^Sem imagem/ }).click();
  await card.getByRole("button", { name: /^Com nome/ }).click();
  await expect(
    card.getByRole("button", { name: "Adicionar ao Carrinho" }),
  ).toBeDisabled();
  const defaultCover = page.waitForRequest("**/__e2e/cover.png");
  await open.click();
  await defaultCover;
  await modal.getByLabel("Nome ou texto do molde").fill("Maria");
  await modal.getByRole("button", { name: "Confirmar personalização" }).click();
  await page
    .getByRole("button", { name: "Fechar visualização do modelo" })
    .click();
  await card.getByRole("button", { name: "Adicionar ao Carrinho" }).click();
  const items = JSON.parse(
    (await page.getByTestId("e2e-cart").textContent()) || "[]",
  );
  expect(
    items.map((row: { moldeRevisao: string }) => row.moldeRevisao),
  ).toEqual(["6".repeat(32), "a".repeat(32)]);
});

test("o admin troca o molde de uma opção por imagem-base e salva sem alterar a outra opção", async ({
  page,
}) => {
  const image = await readFile("e2e/fixtures/editor-cover.png");
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/__e2e/uploads/")
    )
      uploads.push(request.url());
  });
  await page.route(
    "https://firebasestorage.googleapis.com/v0/b/demo-sales.firebasestorage.app/**",
    (route) => route.fulfill({ contentType: "image/png", body: image }),
  );
  await page.route("**/__e2e/product-pdf-copy", (route) => {
    const id = "f".repeat(32);
    const path = `catalog/templates/1yi50l93z/${id}.pdf`;
    return route.fulfill({
      json: {
        template: { id, path, name: "Álbum.pdf", pages: ["/__e2e/cover.png"] },
        assets: [{ path, url: path }],
      },
    });
  });
  await page.goto("/__e2e/admin?pdf-binding=1");
  const edit = page.getByRole("button", {
    name: "Editar Carimbo",
    exact: true,
  });
  await edit.click();
  const editor = page.getByRole("dialog", { name: "Editar Produto" });
  await editor
    .getByRole("button", { name: "Adicionar variação", exact: true })
    .click();
  await editor
    .getByLabel("Tipo de variação", { exact: true })
    .selectOption({ label: "Imagem" });
  for (const name of ["Própria", "Padrão"]) {
    await editor.getByLabel("Nova opção de Imagem").fill(name);
    await editor
      .getByRole("button", { name: "Adicionar opção", exact: true })
      .click();
  }
  await editor.getByLabel("Modo de preço").selectOption("adicionais");
  const upload = page.getByLabel("Enviar imagem-base de Imagem: Própria", {
    exact: true,
  });
  const option = editor.locator("details").filter({ has: upload });
  await option.locator("summary").click();
  await option
    .getByRole("button", { name: "Carregar bases e moldes da oficina" })
    .click();
  await option
    .getByLabel("Base PDF do produto")
    .selectOption({ label: "Álbum.pdf" });
  await option
    .getByRole("button", { name: "Vincular / atualizar molde" })
    .click();
  await expect(option.locator("summary")).toContainText("Álbum.pdf");
  const reference = editor.getByAltText("Referência Imagem: Própria", {
    exact: true,
  });
  await expect(reference).toHaveAttribute("src", "/__e2e/cover.png");
  await upload.setInputFiles({
    name: "ref-producao.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(option.locator("summary")).toContainText("Imagem-base própria");
  const baseReference = await option
    .getByAltText("Imagem-base de impressão")
    .getAttribute("src");
  expect(baseReference).toBeTruthy();
  await expect(reference).toHaveAttribute("src", baseReference!);
  expect(uploads).toHaveLength(1);
  await editor
    .getByLabel("Enviar referência Imagem: Própria", { exact: true })
    .setInputFiles({
      name: "ref-personalizada.png",
      mimeType: "image/png",
      buffer: image,
    });
  await expect(reference).not.toHaveAttribute("src", baseReference!);
  await editor
    .getByRole("button", { name: "Usar referência da base", exact: true })
    .click();
  await expect(reference).toHaveAttribute("src", baseReference!);
  await expect(
    option.getByText("Vinculado: Álbum.pdf · 1 páginas"),
  ).toHaveCount(0);
  const standard = editor.locator("details").filter({
    has: page.getByLabel("Enviar imagem-base de Imagem: Padrão", {
      exact: true,
    }),
  });
  await expect(standard.locator("summary")).toContainText(
    "Usar arte do produto",
  );
  await editor
    .getByRole("button", { name: "Salvar Produto", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await edit.click();
  await expect(option.locator("summary")).toContainText("Imagem-base própria");
  await expect(standard.locator("summary")).toContainText(
    "Usar arte do produto",
  );
});

test("o cliente pode desmarcar grupos e comprar a base ou apenas uma opção", async ({
  page,
}) => {
  await page.route("**/__e2e/option-cover.png", (route) =>
    route.fulfill({
      path: "e2e/fixtures/editor-cover.png",
      contentType: "image/png",
    }),
  );
  await page.goto("/produto/caderneta-azul?variations=partial");
  const card = page.locator("article#produto-caderneta-azul");
  const image = card.getByRole("button", { name: /^Com imagem/ });
  const text = card.getByRole("button", { name: /^Com nome/ });
  await expect(card).toContainText("20,00");
  await text.click();
  await expect(card).toContainText("22,00");
  await image.click();
  await expect(card).toContainText("32,00");
  await text.click();
  await expect(text).toHaveAttribute("aria-pressed", "false");
  await expect(image).toHaveAttribute("aria-pressed", "true");
  await expect(card).toContainText("30,00");
  await expect(image.locator("img")).toHaveAttribute(
    "src",
    "/__e2e/option-cover.png",
  );

  async function addWithoutText() {
    await card
      .getByRole("button", { name: "Personalizar e conferir modelo" })
      .click();
    const modal = page.getByRole("dialog", {
      name: "Personalizar produto",
      exact: true,
    });
    await expect(modal.getByRole("textbox")).toHaveCount(0);
    await modal
      .getByRole("button", { name: "Confirmar personalização" })
      .click();
    await page
      .getByRole("button", { name: "Fechar visualização do modelo" })
      .click();
    await card.getByRole("button", { name: "Adicionar ao Carrinho" }).click();
  }
  await addWithoutText();
  await expect(image).toHaveAttribute("aria-pressed", "true");
  await image.click();
  await expect(image).toHaveAttribute("aria-pressed", "false");
  await expect(card).toContainText("20,00");
  await addWithoutText();
  const items = JSON.parse(
    (await page.getByTestId("e2e-cart").textContent()) || "[]",
  );
  expect(items).toMatchObject([
    {
      selecoes: { Imagem: "Com imagem" },
      preco: "30.00",
      moldeRevisao: "6".repeat(32),
    },
    { selecoes: {}, preco: "20.00", moldeRevisao: "a".repeat(32) },
  ]);
});
