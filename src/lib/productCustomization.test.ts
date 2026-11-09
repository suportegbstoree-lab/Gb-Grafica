import test from "node:test";
import assert from "node:assert/strict";
import type { Anuncio } from "../types";
import {
  productCustomization,
  productPrice,
  productMinimum,
  productPdfOrder,
  bindingValid,
  resolveProductProduction,
  productionAssetUrls,
} from "./productCustomization";
import { defaultPdfLayout } from "./staffPdf";
import { selectedPrice, minimumPrice } from "./bundles";
import { repriceCart } from "./cartPricing";
import { validateProductDraft } from "./adminValidation";
const product: Anuncio = {
  id: "blue",
  nome: "Caderneta Azul",
  desc: "Caderneta",
  categoria: "Cadernetas",
  imagem: "https://example.com/advert.png",
  preco_base: "20.00",
  tipoInput: "texto_arte",
  labelTexto: "Nome",
  precificacao: "adicionais",
  combinacoes: {},
  atributos: [
    {
      nome: "Arte",
      opcoes: ["Com imagem", "Sem imagem"],
      configuracao: {
        "Com imagem": { adicional: "10,00", imagem: true },
        "Sem imagem": { adicional: "5,00", imagem: false },
      },
    },
    {
      nome: "Nome",
      opcoes: ["Com nome", "Sem nome"],
      configuracao: {
        "Com nome": { adicional: "2,00", texto: true },
        "Sem nome": { adicional: "0", texto: false },
      },
    },
  ],
};
const choices = { Arte: "Com imagem", Nome: "Com nome" };
test("additive selections, minimum, bundle pricing and cart reprice agree in integer cents", () => {
  assert.equal(productPrice(product, choices), 3200);
  assert.equal(selectedPrice(product, choices), 3200);
  assert.equal(productMinimum(product), 2000);
  assert.equal(minimumPrice(product), 2000);
  const [item] = repriceCart(
    [
      {
        id: "line",
        productId: "blue",
        nome: "Azul",
        imagem: "",
        selecoes: choices,
        quantidade: 1,
        preco: "1.00",
      },
    ],
    [product],
    [],
    Date.now(),
  );
  assert.equal(item.preco, "32.00");
  assert.equal(
    productPrice(product, { Arte: "Sem imagem", Nome: "Sem nome" }),
    2500,
  );
});
test("invalid selections and negative or oversized additions never produce a price", () => {
  assert.equal(productPrice(product, { ...choices, Extra: "x" }), null);
  assert.equal(productPrice(product, { Arte: "Inválida" }), null);
  const copy = structuredClone(product);
  copy.atributos[0].configuracao!["Com imagem"].adicional = "-1";
  assert.equal(productPrice(copy, choices), null);
  copy.atributos[0].configuracao!["Com imagem"].adicional = "999999999";
  assert.equal(productPrice(copy, choices), null);
});
test("choices independently remove text and image; explicit enables work on an otherwise plain product", () => {
  assert.deepEqual(
    productCustomization(product, { Arte: "Com imagem", Nome: "Sem nome" }),
    { text: false, image: true },
  );
  assert.deepEqual(
    productCustomization(product, { Arte: "Sem imagem", Nome: "Com nome" }),
    { text: true, image: false },
  );
  assert.deepEqual(
    productCustomization({ ...product, tipoInput: "nenhum" }, choices),
    { text: true, image: true },
  );
  assert.deepEqual(
    productCustomization(product, { Arte: "Sem imagem", Nome: "Sem nome" }),
    { text: false, image: false },
  );
});
test("legacy combination prices keep their original meaning", () => {
  const old = {
    ...product,
    precificacao: undefined,
    combinacoes: { "Com imagem|Com nome": "35.00" },
  };
  assert.equal(productPrice(old, choices), 3500);
  assert.equal(productMinimum(old), 2000);
  assert.equal(productPrice(old, { Arte: "Com imagem" }), null);
  assert.equal(
    productPrice({ ...old, preco_base: "A partir de R$ 35" }, {}),
    null,
  );
});
test("product validation preserves optional controls and rejects invalid pricing settings", () => {
  const categories = [{ id: "cat", nome: "Cadernetas", icon: "", ordem: 0 }];
  const valid = validateProductDraft(product, categories, []);
  assert.ok(valid.ok);
  if (valid.ok) assert.deepEqual(valid.value.atributos, product.atributos);
  assert.equal(
    validateProductDraft(
      { ...product, precificacao: "other" as any },
      categories,
      [],
    ).ok,
    false,
  );
  const invalid = structuredClone(product);
  invalid.atributos[0].configuracao!["Com imagem"].adicional = "-1";
  assert.equal(validateProductDraft(invalid, categories, []).ok, false);
  const many = {
    ...product,
    atributos: Array.from({ length: 4 }, (_, i) => ({
      nome: "A" + i,
      opcoes: Array.from({ length: 10 }, (_, n) => String(n)),
    })),
  };
  assert.equal(validateProductDraft(many, categories, []).ok, true);
});
test("a linked job fixes geometry and style from the workshop; suppressed text is absent from output", () => {
  const binding = {
    revision: "a".repeat(32),
    baseId: "b".repeat(32),
    baseRevision: "c".repeat(32),
    layoutId: "d".repeat(32),
    layoutRevision: "e".repeat(32),
    layout: {
      ...defaultPdfLayout(),
      font_size: 88,
      color: "#ff0066",
      text_rotation: 5,
    },
    fonts: [],
    pdf: {
      id: "f".repeat(32),
      path: `catalog/templates/blue/${"f".repeat(32)}.pdf`,
      name: "Base.pdf",
      pages: ["https://example.com/front.png", "https://example.com/back.png"],
    },
  };
  assert.equal(bindingValid(binding, "blue"), true);
  assert.equal(bindingValid(binding, "other-product"), false);
  const recipe = productPdfOrder(binding, "ANA\nMARIA", true);
  assert.equal(recipe.job.lines[0].text, "ANA\nMARIA");
  assert.equal(recipe.job.lines[0].fontSize, 88);
  assert.equal(recipe.job.lines[0].portrait.x, binding.layout.pos_x);
  assert.equal(recipe.job.lines[0].rotation, 5);
  assert.equal(productPdfOrder(binding, "hidden", false).job.lines[0].text, "");
  assert.throws(() => productPdfOrder(binding, "", true));
  assert.throws(() => productPdfOrder(binding, "a".repeat(201), true));
});

test("own option artwork takes precedence in attribute order and falls back to the product", () => {
  const draft = structuredClone(product);
  draft.imagemBase = "https://example.com/default.png";
  draft.atributos[0].configuracao!["Com imagem"].imagemBase =
    "https://example.com/first.png";
  draft.atributos[1].configuracao!["Com nome"].imagemBase =
    "https://example.com/second.png";
  assert.equal(
    resolveProductProduction(draft, choices).imagemBase,
    "https://example.com/first.png",
  );
  assert.equal(
    resolveProductProduction(draft, { ...choices, Arte: "Sem imagem" })
      .imagemBase,
    "https://example.com/second.png",
  );
  assert.equal(
    resolveProductProduction(draft, {}).imagemBase,
    draft.imagemBase,
  );
  assert.deepEqual(productionAssetUrls(draft), [
    draft.imagemBase,
    "https://example.com/first.png",
    "https://example.com/second.png",
  ]);
});

test("base and single selections use their own price without changing complete combinations", () => {
  assert.equal(productPrice(product, {}), 2000);
  assert.equal(productPrice(product, { Nome: "Com nome" }), 2200);
  assert.equal(productPrice(product, { Arte: "Com imagem" }), 3000);

  const exact = structuredClone(product);
  exact.precificacao = "combinacoes";
  exact.combinacoes = {
    "Com imagem|Com nome": "35.00",
    "Com imagem|Sem nome": "33.00",
    "Sem imagem|Com nome": "27.00",
    "Sem imagem|Sem nome": "25.00",
  };
  exact.atributos[1].configuracao!["Com nome"].precoIndividual = "18,50";
  assert.equal(productPrice(exact, {}), 2000);
  assert.equal(productPrice(exact, { Nome: "Com nome" }), 1850);
  assert.equal(productPrice(exact, choices), 3500);
  assert.equal(productMinimum(exact), 1850);
  const categories = [{ id: "cat", nome: "Cadernetas", icon: "", ordem: 0 }];
  assert.ok(validateProductDraft(exact, categories, []).ok);
  exact.atributos[1].configuracao!["Com nome"].precoIndividual = "0";
  assert.equal(validateProductDraft(exact, categories, []).ok, false);
});
