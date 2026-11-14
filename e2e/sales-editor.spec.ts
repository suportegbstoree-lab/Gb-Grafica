import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("cadastro combina dois tipos, preserva uma referência própria e salva preços e SKUs por linha", async ({
  page,
}) => {
  await page.goto("/__e2e/admin");
  await page.getByRole("button", { name: "Produtos", exact: true }).click();
  await page
    .getByRole("button", { name: "Editar Carimbo", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Editar Produto" });
  const navigation = editor.getByRole("navigation", {
    name: "Seções do produto",
  });
  await expect(
    navigation.getByRole("button", { name: "Descrição" }),
  ).toBeVisible();
  await editor
    .getByLabel("SKU principal (opcional)", { exact: true })
    .fill("AGENDA");
  await navigation
    .getByRole("button", { name: "Variações", exact: true })
    .click();
  const addType = async (name: string, options: string[], create = false) => {
    await editor
      .getByRole("button", { name: "Adicionar variação", exact: true })
      .click();
    if (create) {
      await editor
        .getByLabel("Novo tipo de variação", { exact: true })
        .fill(name);
      await editor
        .getByRole("button", { name: "Cadastrar e adicionar", exact: true })
        .click();
    } else {
      await editor
        .getByLabel("Tipo de variação", { exact: true })
        .selectOption({ label: name });
    }
    const group = editor
      .locator("section")
      .filter({
        has: page.getByRole("textbox", {
          name: `Nova opção de ${name}`,
          exact: true,
        }),
      })
      .last();
    for (const option of options) {
      await group
        .getByLabel(`Nova opção de ${name}`, { exact: true })
        .fill(option);
      await group
        .getByRole("button", { name: "Adicionar opção", exact: true })
        .click();
    }
  };
  await addType("Cor", ["Floral 1", "Floral 2"]);
  await addType("Customização", ["Normal", "Nome", "Imagem"], true);
  await editor
    .getByLabel("Preço avulso Cor: Floral 1", { exact: true })
    .fill("24,90");
  await expect(
    editor.getByRole("button", { name: "Adicionar variação", exact: true }),
  ).toHaveCount(0);
  const reference = await readFile("e2e/fixtures/editor-cover.png");
  await page.route(
    "https://firebasestorage.googleapis.com/v0/b/demo-sales.firebasestorage.app/**",
    (route) => route.fulfill({ contentType: "image/png", body: reference }),
  );
  const main = await editor.getByLabel("Imagem Principal (URL)").inputValue();
  await editor
    .getByLabel("Enviar referência Cor: Floral 1", { exact: true })
    .setInputFiles({
      name: "ref-floral.png",
      mimeType: "image/png",
      buffer: reference,
    });
  await expect(
    editor.getByAltText("Referência Cor: Floral 1", { exact: true }),
  ).toBeVisible();
  await expect(editor.getByLabel("Imagem Principal (URL)")).toHaveValue(main);
  await editor
    .getByLabel("SKU da opção Cor: Floral 1", { exact: true })
    .fill("FL1");
  await editor
    .getByLabel("Preço para todas as combinações", { exact: true })
    .fill("20");
  await editor
    .getByRole("button", { name: "Aplicar a todos", exact: true })
    .click();
  await editor
    .getByLabel("Preço da combinação Floral 1 + Nome", { exact: true })
    .fill("30");
  const sku = editor.getByLabel("SKU da combinação Floral 1 + Nome", {
    exact: true,
  });
  await expect(sku).toHaveAttribute("placeholder", "AGENDA FL1 Nome");
  await sku.fill("AGENDA-FL1-NOME");
  await expect(editor.getByRole("table").locator("tbody tr")).toHaveCount(6);
  await editor
    .getByRole("button", { name: "Salvar Produto", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await page
    .getByRole("button", { name: "Editar Carimbo", exact: true })
    .click();
  await expect(
    editor.getByLabel("Preço da combinação Floral 1 + Nome", { exact: true }),
  ).toHaveValue("30");
  await expect(
    editor.getByLabel("Preço avulso Cor: Floral 1", { exact: true }),
  ).toHaveValue("24,90");
  await expect(
    editor.getByLabel("SKU da combinação Floral 1 + Nome", { exact: true }),
  ).toHaveValue("AGENDA-FL1-NOME");
  await expect(
    editor.getByAltText("Referência Cor: Floral 1", { exact: true }),
  ).toBeVisible();
});

test("cupom de frete pode ser cadastrado no ADM", async ({ page }) => {
  await page.goto("/__e2e/admin");
  await page.getByRole("button", { name: "Cupons", exact: true }).click();
  await page.getByRole("button", { name: "Novo cupom", exact: true }).click();
  await page.getByLabel("Código do cupom").fill("frete50");
  await page.getByLabel("Descrição do cupom").fill("Metade do frete");
  await page.getByLabel("Desconto (%)", { exact: true }).fill("50");
  await page.getByLabel("Válido até", { exact: true }).fill("2099-12-31");
  await page.getByRole("combobox", { name: "Aplicar em", exact: true }).selectOption({ label: "Frete" });
  await page.getByRole("button", { name: "Salvar cupom", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "FRETE50" })).toContainText("50% no frete");
});

test("cupom pode ser cadastrado, aplicado automaticamente e enviado no total conferido", async ({
  page,
}) => {
  await page.goto("/__e2e/admin");
  await page.getByRole("button", { name: "Cupons", exact: true }).click();
  await page.getByRole("button", { name: "Novo cupom", exact: true }).click();
  await page.getByLabel("Código do cupom").fill("grafica10");
  await page.getByLabel("Descrição do cupom").fill("Boas-vindas da gráfica");
  await page.getByLabel("Desconto (%)", { exact: true }).fill("10");
  await page.getByLabel("Válido até", { exact: true }).fill("2099-12-31");
  await page.getByLabel("Limite de usos", { exact: true }).fill("4");
  await page.getByLabel("Aplicar automaticamente na primeira compra").check();
  await page.getByRole("button", { name: "Salvar cupom", exact: true }).click();
  const row = page.locator("li").filter({ hasText: "Boas-vindas da gráfica" });
  await expect(row).toContainText("0/4 usos e reservas");
  const code = "GRAFICA10";
  await expect(row.getByText(code, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Voltar para a Loja" }).click();
  await page.goto("/produto/1yi50l93z");
  const card = page.locator("#produto-1yi50l93z");
  await card.getByRole("button", { name: "Adicionar ao Carrinho" }).click();
  await page
    .getByRole("button", { name: "Abrir carrinho", exact: true })
    .click();
  const cart = page.getByRole("dialog", { name: "Meu Carrinho" });
  await expect(cart).toContainText("Primeira compra · Boas-vindas da gráfica");
  await expect(cart).toContainText("Desconto do cupom");
  await cart
    .getByRole("textbox", { name: "Cupom de desconto", exact: true })
    .fill("GB-000000000000");
  await cart
    .getByRole("button", { name: "Aplicar cupom", exact: true })
    .click();
  await expect(cart).toContainText("Cupom inválido");
  await cart
    .getByRole("button", { name: "Remover cupom", exact: true })
    .click();
  await expect(cart).toContainText("Primeira compra · Boas-vindas da gráfica");
  await cart.getByRole("button", { name: "Retirar na Loja" }).click();
  await cart.getByLabel("Nome completo").fill("Cliente Teste");
  await cart.getByLabel(/CPF do pagador/).fill("52998224725");
  await cart.getByLabel("Telefone para contato").fill("16999376260");
  await cart.getByLabel("Li e aceito as condições da compra.").check();
  const request = page.waitForRequest((req) =>
    req.url().endsWith("/api/checkout"),
  );
  await cart.getByRole("button", { name: "IR PARA O PAGBANK" }).click();
  expect((await request).postDataJSON()).toMatchObject({
    expectedCouponCode: code,
    expectedCouponCents: 76,
  });
  await page.goto("/admin/coupons");
  await page.getByRole("button", { name: `Editar cupom ${code}` }).click();
  await page.getByLabel("Cupom ativo", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Salvar cupom", exact: true }).click();
  await expect(row).toContainText("Inativo");
  await page.getByRole("button", { name: "Novo cupom", exact: true }).click();
  await page.getByLabel("Código do cupom").fill("grafica10");
  await page.getByLabel("Descrição do cupom").fill("Duplicado");
  await page.getByLabel("Desconto (%)", { exact: true }).fill("10");
  await page.getByLabel("Válido até", { exact: true }).fill("2099-12-31");
  await page.getByRole("button", { name: "Salvar cupom", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Código de cupom em uso");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();

  await page.getByRole("button", { name: `Excluir cupom ${code}` }).click();
  await page
    .getByRole("alertdialog")
    .filter({ hasText: "Excluir cupom" })
    .getByRole("button", { name: "Excluir cupom", exact: true })
    .click();
  await expect(row).toHaveCount(0);
});
