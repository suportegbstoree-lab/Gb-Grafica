import test from "node:test";
import assert from "node:assert/strict";
import { identifyProduct, missingLabelCategories, parseLabelPage } from "./staffLabelImport";

test("o SKU conserva os zeros e identifica o produto mesmo em outra variação; sem SKU, a variação diferencia o item", async () => {
  const product = { sku: "001a", description: "Caderneta", variation: "Verde" };
  const registered = await identifyProduct(product);
  assert.equal((await identifyProduct({ ...product, sku: "001A", variation: "Rosa" })).key, registered.key);
  assert.notEqual((await identifyProduct({ ...product, sku: "1a" })).key, registered.key);
  const other = await identifyProduct({ ...product, sku: "", variation: "Rosa" });
  assert.notEqual(other.key, (await identifyProduct({ ...product, sku: "" })).key);
  const pages = [
    { products: [registered, other] },
    { products: [registered] },
    { products: [], issue: "ilegível" },
  ];
  assert.equal(missingLabelCategories(pages, { [registered.key]: "caderneta" }), 2);
  assert.equal(missingLabelCategories(pages, { [registered.key]: "caderneta", [other.key]: "adesivos" }), 1);
  assert.ok(parseLabelPage([]).issue);
});
