import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultStaffPdfCsvColumns,
  parseStaffPdfCsv,
  resolveStaffPdfCsvModel,
} from "./staffPdfCsv.js";
import { defaultPdfLayout, type StaffPdfBase } from "./staffPdf.js";

test("the office CSV accepts its desktop header, quoted delimiters and multiline names", () => {
  const csv =
    '\ufeffpedido_plataforma,barcode,af_clean,nome,prazo_envio\r\n00123,999,Teste,"Ana, \"\"Nina\"\"\nMaria",2026-10-10\r\n';
  const [header, row] = parseStaffPdfCsv(csv);
  assert.deepEqual(defaultStaffPdfCsvColumns(header), {
    reference: 0,
    template: 2,
    text: 3,
  });
  assert.equal(row[0], "00123");
  assert.equal(row[3], 'Ana, "Nina"\nMaria');
  assert.deepEqual(
    parseStaffPdfCsv('"Nome";"Modelo"\r\n"Ana";"Kit"\r\n', ";"),
    [
      ["Nome", "Modelo"],
      ["Ana", "Kit"],
    ],
  );
  assert.throws(() => parseStaffPdfCsv('Nome;Modelo\n"Ana;Kit', ";"), /aspas/);
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
