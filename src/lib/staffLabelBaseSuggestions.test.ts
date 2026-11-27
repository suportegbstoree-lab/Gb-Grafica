import test from "node:test";
import assert from "node:assert/strict";
import { suggestLabelBases } from "./staffLabelBaseSuggestions";

const product = { sku: "10588006940", description: "Caderneta de vacinação saúde personalizada com nome", variation: "Gatinhas Brancas" };
const bases = [
  { id: "rosa", name: "Gatinha Rosa.pdf", category: "Caderneta de saúde" },
  { id: "branca", name: "Gatinha Branca.pdf", category: "Caderneta de saúde" },
  { id: "mar", name: "Fundo do Mar Menina.pdf", category: "Caderneta de saúde" },
];

test("prioriza a variação correta apesar de acentos, plural, caixa e descrição genérica", () => {
  const result = suggestLabelBases(product, bases);
  assert.equal(result[0].id, "branca");
  assert.match(result[0].reason, /Variação em comum/);
  assert.ok(!result.some(item => item.id === "rosa"));
  assert.ok(!result.some(item => item.id === "mar"));
});

test("o SKU completo é uma evidência forte, conserva zeros e não corresponde a um prefixo numérico", () => {
  const result = suggestLabelBases(product, [
    ...bases,
    { id: "sku", name: "Pedido 10588006940.pdf" },
    { id: "prefixo", name: "Pedido 105880069401.pdf" },
  ]);
  assert.equal(result[0].id, "sku");
  assert.match(result[0].reason, /SKU encontrado/);
  assert.ok(!result.some(item => item.id === "prefixo"));
  const coded = { ...product, sku: "001-A", description: "", variation: "" };
  assert.equal(suggestLabelBases(coded, [{id:"certa",name:"PDF 001A.pdf"}])[0].id,"certa");
  assert.deepEqual(suggestLabelBases(coded, [{id:"outra",name:"PDF 1A.pdf"}]),[]);
  assert.deepEqual(suggestLabelBases({...coded,sku:"12"},[{id:"numero",name:"PDF 12.pdf"}]),[]);
});

test("extrai termos de um SKU descritivo concatenado e reconhece nomes em CamelCase", () => {
  const result = suggestLabelBases({sku:"10xjardimdasborboletas",description:"Sacolinhas personalizadas",variation:""},[
    {id:"flores",name:"Jardim Flores.pdf",category:"Sacolinhas"},
    {id:"borboletas",name:"JardimBorboletas.pdf",category:"Sacolinhas"},
  ]);
  assert.equal(result[0].id,"borboletas");
  assert.match(result[0].reason,/Termos do SKU/);
  assert.equal(suggestLabelBases({...product,variation:"Carrossel Azul"},[
    {id:"carrossel",name:"CarrosselAzul_template__2p.pdf"},
  ])[0].id,"carrossel");
});

test("considera o nome original de uma base renomeada e a pasta de letras já cadastrada", () => {
  const result = suggestLabelBases({sku:"",description:"Livro de Receitas",variation:"Limão"},[
    {id:"atual",name:"Base renomeada.pdf",sourceName:"Livro Receitas LIMÃO.pdf"},
    {id:"pasta",name:"Capa 2.pdf",initialFolderName:"Receitas Limão"},
    {id:"outro",name:"Livro Receitas Morango.pdf"},
  ]);
  assert.equal(result.length,2);
  assert.ok(result.some(item=>item.id==="atual"));
  assert.ok(result.some(item=>item.id==="pasta"));
});

test("tolera um erro de digitação em palavra longa sem confundir códigos ou palavras curtas", () => {
  assert.equal(suggestLabelBases({...product,variation:"Jardim das Borbletas"},[
    {id:"jardim",name:"Jardim Borboletas.pdf"},
  ])[0].id,"jardim");
  assert.deepEqual(suggestLabelBases({sku:"",description:"",variation:"Maya"},[
    {id:"maia",name:"Maia.pdf"},
  ]),[]);
  assert.deepEqual(suggestLabelBases({sku:"",description:"",variation:"Limão"},[
    {id:"outro",name:"Limaozinho.pdf"},
  ]),[]);
});

test("não apresenta sugestões baseadas apenas na categoria ou em palavras genéricas", () => {
  assert.deepEqual(suggestLabelBases({...product,variation:"Tema livre com nome"},bases),[]);
  assert.deepEqual(suggestLabelBases({sku:"",description:"Kit personalizado com nome",variation:""},bases),[]);
  assert.deepEqual(suggestLabelBases(product,[]),[]);
});

test("ordena empates de forma estável, limita sugestões e não modifica as bases", () => {
  const options = ["D","C","B","A"].map(id=>({id,name:`Capa ${id} Rosa.pdf`}));
  const before = structuredClone(options);
  const query = {sku:"",description:"",variation:"Rosa"};
  assert.deepEqual(suggestLabelBases(query,options).map(item=>item.id),["A","B","C"]);
  assert.deepEqual(suggestLabelBases(query,[...options].reverse()),suggestLabelBases(query,options));
  assert.equal(suggestLabelBases(query,options,1).length,1);
  assert.deepEqual(options,before);
});
