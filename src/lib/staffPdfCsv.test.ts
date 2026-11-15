import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultStaffPdfCsvColumns,
  createStaffSkuMatcher,
  expandStaffPdfQuantities,
  staffOrderColumn,
  staffSheetColumn,
  staffPdfQuantityColumn,
  parseStaffPdfCsv,
  resolveStaffPdfCsvModel,
} from "./staffPdfCsv.js";
import { selectedColumnsCsv } from "./spreadsheetCsv.js";
import { defaultPdfLayout, type StaffPdfBase } from "./staffPdf.js";

test("the office CSV accepts its desktop header, quoted delimiters and multiline names", () => {
  const csv =
    '\ufeffpedido_plataforma,barcode,af_clean,base,nome,prazo_envio\r\n00123,999,Ignorar,Teste,"Ana, \"\"Nina\"\"\nMaria",2026-10-10\r\n';
  const [header, row] = parseStaffPdfCsv(csv);
  assert.deepEqual(defaultStaffPdfCsvColumns(header), {
    reference: 0,
    template: 3,
    text: 4,
  });
  assert.equal(defaultStaffPdfCsvColumns(["af_clean", "nome"]).template, 0);
  assert.equal(row[0], "00123");
  assert.equal(row[4], 'Ana, "Nina"\nMaria');
  assert.deepEqual(
    parseStaffPdfCsv('"Nome";"Modelo"\r\n"Ana";"Kit"\r\n', ";"),
    [
      ["Nome", "Modelo"],
      ["Ana", "Kit"],
    ],
  );
  assert.throws(() => parseStaffPdfCsv('Nome;Modelo\n"Ana;Kit', ";"), /aspas/);
});

test("CSV resolves the longest whole-word model prefix with or without a name option", () => {
  const bases: StaffPdfBase[] = [
    { id: "generic", name: "Livro Receitas.pdf", pageCount: 2, revision: "v1", pages: [] },
    { id: "lemon", name: "Livro Receitas limão.pdf", pageCount: 2, revision: "v1", pages: [] },
    { id: "sicilian", name: "Livro Receitas Limão Siciliano.pdf", pageCount: 2, revision: "v1", pages: [] },
  ];
  const layouts = [
    { id: "generic", name: "Livro Receitas_template", revision: "v1", layout: defaultPdfLayout() },
    { id: "lemon", name: "livro Receitas limao_template", revision: "v1", layout: defaultPdfLayout() },
    { id: "sicilian", name: "Livro Receitas Limão Siciliano_template", revision: "v1", layout: defaultPdfLayout() },
  ];
  for (const label of [
    "livro de receita limao COM NOME",
    "LIVRO DE RECEITA LIMÃO sem nome",
    "Livro Receitas limão.pdf",
    "Livro de Receita Limão - Personalizado SEM NOME",
  ]) {
    assert.deepEqual(resolveStaffPdfCsvModel(label, bases, layouts), {
      baseId: "lemon",
      layoutId: "lemon",
    });
  }
  assert.deepEqual(
    resolveStaffPdfCsvModel("livro de receita limao siciliano COM NOME", bases, layouts),
    { baseId: "sicilian", layoutId: "sicilian" },
  );
  assert.equal(resolveStaffPdfCsvModel("kit livro de receita limao COM NOME", bases, layouts), undefined);
  assert.equal(resolveStaffPdfCsvModel("livro de receita limaozinho", [bases[1]], layouts), undefined);
  assert.equal(
    resolveStaffPdfCsvModel("livro de receita limao SEM NOME", [
      ...bases, { ...bases[1], name: "Livro da Receita Limão.pdf", id: "duplicate" },
    ], layouts),
    undefined,
  );
});

test("CSV model association honors four-page templates and leaves ambiguous bases for review", () => {
  const base: StaffPdfBase = {
    id: "base",
    name: "Álbum Floral.pdf",
    pageCount: 4,
    revision: "rev",
    pages: [],
    source: "internal",
  };
  const layouts = [
    {
      id: "portrait",
      name: "Álbum Floral_template",
      revision: "v1",
      layout: defaultPdfLayout(),
    },
    {
      id: "kit",
      name: "Álbum Floral_template__4p",
      revision: "v1",
      layout: defaultPdfLayout(),
    },
  ];
  assert.deepEqual(
    resolveStaffPdfCsvModel("ALBUM_FLORAL_template__4p", [base], layouts),
    { baseId: "base", layoutId: "kit" },
  );
  assert.equal(
    resolveStaffPdfCsvModel(
      "album floral",
      [base, { ...base, id: "another" }],
      layouts,
    ),
    undefined,
  );
  assert.equal(
    resolveStaffPdfCsvModel("Desconhecido", [base], layouts),
    undefined,
  );
});

test("CSV retains blank cells and expands each quantity into independent unit rows", () => {
  const input = [
    ["001", "0001", "Floral azul", "", "2.0"],
    ["001", "0001", "Floral rosa", "", "1.0"],
    ["002", "0002", "Floral azul", "", "2,00"],
    ["003", "0003", "Floral azul", "", ""],
  ];
  const headers = ["pedido_plataforma", "barcode", "af_clean", "nome", "Qtd. do Produto"];
  const rows = expandStaffPdfQuantities(input, staffPdfQuantityColumn(headers));
  const csv = selectedColumnsCsv(rows, [0, 1, 2, 3, 4], ",");
  assert.deepEqual(parseStaffPdfCsv(csv), [
    ["001", "0001", "Floral azul", "", "1"],
    ["001", "0001", "Floral azul", "", "1"],
    ["001", "0001", "Floral rosa", "", "1.0"],
    ["002", "0002", "Floral azul", "", "1"],
    ["002", "0002", "Floral azul", "", "1"],
    ["003", "0003", "Floral azul", "", ""],
  ]);
  rows[0][3] = "Ana";
  assert.equal(rows[1][3], "");
  assert.equal(input[0][4], "2.0");
  assert.throws(() => expandStaffPdfQuantities([["1.5"]], 0), /quantidade inteira/);
  assert.throws(() => expandStaffPdfQuantities([["10001"]], 0), /10.000 registros/);
  assert.deepEqual(parseStaffPdfCsv("A,B,C\n,,\n1,,3\n"), [
    ["A", "B", "C"],
    ["", "", ""],
    ["1", "", "3"],
  ]);
});

test("staff workbook mapping uses explicit letters or headers and cleans SKUs against known molds", () => {
  const headers = ["Nº de Pedido da Plataforma", "SKU", "Notas do Comprador"];
  assert.equal(staffSheetColumn("B", headers.length, headers), 1);
  assert.equal(
    staffSheetColumn("notas do comprador", headers.length, headers),
    2,
  );
  assert.equal(staffSheetColumn("AF", 32, []), 31);
  assert.equal(staffSheetColumn("AF", 31, []), -1);
  assert.equal(staffOrderColumn(headers), 0);
  assert.equal(staffOrderColumn(["Nº de Rastreio"]), -1);
  const match = createStaffSkuMatcher([
    {
      id: "a",
      name: "Floral_template",
      revision: "v1",
      layout: defaultPdfLayout(),
    },
    {
      id: "b",
      name: "Floral Xadrez_template__4p",
      revision: "v1",
      layout: defaultPdfLayout(),
    },
  ]);
  assert.equal(match("KIT-Floral Xadrez-A5"), "Floral Xadrez");
  assert.equal(match("Floral Xadrez SEM NOME"), "Floral Xadrez SEM NOME");
  assert.equal(match("Desconhecido"), "Desconhecido");
});

test("CSV supports two explicitly named molds associated with one PDF", () => {
  const base: StaffPdfBase = {
    id: "base",
    name: "Floral.pdf",
    pageCount: 4,
    revision: "rev",
    pages: [],
  };
  const layout = { ...defaultPdfLayout(), base_pdf_name: "Floral.pdf" };
  const layouts = [
    { id: "a", name: "Floral Nome em Cima", revision: "v1", layout },
    { id: "b", name: "Floral Nome embaixo", revision: "v1", layout },
  ];
  assert.equal(
    resolveStaffPdfCsvModel(layouts[0].name, [base], layouts)?.layoutId,
    "a",
  );
  assert.equal(
    resolveStaffPdfCsvModel(layouts[1].name, [base], layouts)?.layoutId,
    "b",
  );
});

test("explicit base association disambiguates identical PDF names in different categories", () => {
  const a: StaffPdfBase = {
    id: "a",
    name: "Kit.pdf",
    category: "Cadernetas",
    revision: "a",
    pageCount: 2,
    pages: [],
  };
  const b = { ...a, id: "b", category: "Agendas" };
  const layouts = [
    {
      id: "x",
      name: "Caderneta Personalizada",
      revision: "x",
      layout: { ...defaultPdfLayout(), base_pdf_name: "Kit.pdf", base_id: "a" },
    },
    {
      id: "y",
      name: "Agenda Personalizada",
      revision: "y",
      layout: { ...defaultPdfLayout(), base_pdf_name: "Kit.pdf", base_id: "b" },
    },
  ];
  assert.equal(
    resolveStaffPdfCsvModel(layouts[0].name, [a, b], layouts)?.baseId,
    "a",
  );
  assert.equal(
    resolveStaffPdfCsvModel(layouts[1].name, [a, b], layouts)?.baseId,
    "b",
  );
});
