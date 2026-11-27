import test from "node:test";
import assert from "node:assert/strict";
import {
  identifyProduct,
  incompleteLabelReading,
  labelBaseIdentity,
  missingLabelCategories,
  parseLabelPage,
} from "./staffLabelImport";

test("o SKU conserva os zeros e identifica o produto mesmo em outra variação; sem SKU, a variação diferencia o item", async () => {
  const product = { sku: "001a", description: "Caderneta", variation: "Verde" };
  const registered = await identifyProduct(product);
  assert.equal(
    (await identifyProduct({ ...product, sku: "001A", variation: "Rosa" })).key,
    registered.key,
  );
  assert.notEqual((await identifyProduct({ ...product, sku: "1a" })).key, registered.key);
  const other = await identifyProduct({ ...product, sku: "", variation: "Rosa" });
  assert.notEqual(other.key, (await identifyProduct({ ...product, sku: "" })).key);
  const pages = [
    { products: [registered, other] },
    { products: [registered] },
    { products: [], issue: "ilegível" },
  ];
  assert.equal(missingLabelCategories(pages, { [registered.key]: "caderneta" }), 1);
  assert.equal(
    missingLabelCategories(pages, { [registered.key]: "caderneta", [other.key]: "adesivos" }),
    0,
  );
  assert.equal(pages.filter(incompleteLabelReading).length, 1);
  const excluded = pages.map(page => ({...page,excluded:true}));
  assert.equal(missingLabelCategories(excluded, {}), 0);
  assert.equal(excluded.filter(incompleteLabelReading).length, 0);
  assert.ok(parseLabelPage([]).issue);
});

function table(rows: Array<[string, string, string]>, total = "2") {
  const fragments: Array<{str:string;transform:number[];width:number}> = [];
  const add = (str:string,x:number,y:number) => {
    if(str) fragments.push({str,transform:[8,0,0,8,x,y],width:str.length*4});
  };
  const xs = [15,40,120,300,400];
  ["Nº","SKU","DESCRIÇÃO","VARIAÇÃO","QTD"].forEach((value,i)=>add(value,xs[i],300));
  rows.forEach(([sku,description,quantity],i)=>{
    [String(i+1),sku,description,"",quantity].forEach((value,j)=>add(value,xs[j],286-i*16));
  });
  add("Total",306,286-rows.length*16);
  add(total,400,286-rows.length*16);
  return fragments;
}

test("quantidades ausentes ou ilegíveis não apagam os produtos nem viram erro de leitura", () => {
  for (const quantity of ["", "?", "1,5", "0", "10001"]) {
    const result = parseLabelPage(table([["001","Planner",quantity]]));
    assert.equal(result.issue,undefined);
    assert.match(result.warning!,/quantidade/);
    assert.equal(result.products.length,1);
    assert.equal(result.products[0].sku,"001");
    assert.equal(result.products[0].description,"Planner");
    assert.equal(result.products[0].quantity,undefined);
  }
});

test("o leitor aceita quantidade inteira com decimal ou unidade e mantém itens com total divergente", () => {
  for (const quantity of ["2", "2.0", "2,00", "2 un", "2 unidades", "2x"]) {
    const result=parseLabelPage(table([["001","Planner",quantity]]));
    assert.equal(result.products[0].quantity,2);
    assert.equal(result.issue,undefined);
    assert.equal(result.warning,undefined);
  }
  const mismatch=parseLabelPage(table([["001","Planner","1"],["002","Adesivo","2"]],"2"));
  assert.equal(mismatch.products.length,2);
  assert.equal(mismatch.issue,undefined);
  assert.match(mismatch.warning!,/total/);
});

test("um produto realmente não identificado mantém o bloqueio sem apagar os demais", () => {
  const result=parseLabelPage(table([["001","Planner","1"],["","","1"]]));
  assert.match(result.issue!,/identificar todos/);
  assert.equal(result.products.length,1);
  assert.equal(result.products[0].sku,"001");
});

test("o vínculo da base distingue variações do mesmo SKU e mantém a identidade da categoria", async () => {
  const product = { sku: "001a", description: "Caderneta", variation: "Rosa" };
  assert.equal(
    labelBaseIdentity(product),
    labelBaseIdentity({ ...product, sku: "001A", variation: " rosa " }),
  );
  assert.notEqual(labelBaseIdentity(product), labelBaseIdentity({ ...product, variation: "Azul" }));
  assert.notEqual(labelBaseIdentity(product), labelBaseIdentity({ ...product, sku: "1A" }));
  assert.equal(
    (await identifyProduct(product)).key,
    (await identifyProduct({ ...product, variation: "Azul" })).key,
  );
});
