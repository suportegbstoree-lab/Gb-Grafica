import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultPdfLayout,
  normalizePdfLayout,
  parsePdfLayoutMap,
  matchPdfLayout,
  normalizeStaffPdfJob,
  newPdfLine,
  fixedStaffPdfMain,
  STAFF_PDF_SYSTEM_FONT,
  DEFAULT_PDF_TEXT_EFFECTS,
  staffPdfOutputName,
  layoutFont,
} from "./staffPdf";
import { selectedColumnsCsv, safeCsvCell, excelColumn } from "./spreadsheetCsv";
import { editedStaffPdfPage } from "../services/staffPdfRender";
const fonts = [
  { id: "mono", nome: "FreeMono", cssFamily: "monospace", ativo: true },
];
test("legacy maps preserve 300-DPI portrait and landscape coordinates, fonts and alignment", () => {
  const [row] = parsePdfLayoutMap({
    Astronauta_template__4p: {
      pos_x: 745,
      pos_y: 745,
      max_width_pixels: 1031,
      max_height_pixels: 261,
      pos_x_landscape: 1430,
      pos_y_landscape: 592,
      max_width_pixels_landscape: 701,
      max_height_pixels_landscape: 241,
      font_size: 290,
      font_name: "FreeMono.otf",
      color: "#8CACD5",
      align: "center",
      imagem_full_page: false,
    },
  });
  assert.equal(row.layout.pos_x_landscape, 1430);
  assert.equal(row.layout.font_name, "FreeMono.otf");
  assert.equal(row.layout.color, "#8cacd5");
  assert.equal(layoutFont(row.layout, fonts)?.id, "mono");
  assert.equal(
    matchPdfLayout("Astronauta.pdf", 4, [
      { ...row, id: "a".repeat(32), revision: "b".repeat(32) },
    ])?.name,
    row.name,
  );
  assert.equal(
    matchPdfLayout("Astronauta.pdf", 2, [
      { ...row, id: "a".repeat(32), revision: "b".repeat(32) },
    ]),
    undefined,
  );
});
test("beta maps use portrait fallbacks and discard unrelated serial-number settings", () => {
  const layout = normalizePdfLayout({
    pos_x: 300,
    pos_y: 500,
    max_width_pixels: 1000,
    font_name: "FreeMono.otf",
    serial_number: { enabled: true },
  });
  assert.equal(layout.pos_x_landscape, 300);
  assert.equal(layout.max_height_pixels_landscape, 400);
  assert.equal((layout as any).serial_number, undefined);
  assert.equal(normalizePdfLayout({ color: "#fff" }).color, "#ffffff");
  for (const value of [
    { pos_x: NaN },
    { font_size: 0 },
    { align: "html" },
    { color: "red" },
    { font_name: "../font.ttf" },
  ])
    assert.throws(() => normalizePdfLayout(value));
  assert.throws(() => parsePdfLayoutMap(JSON.parse('{"__proto__":{}}')));
});
test("each staff line has its own geometry and frozen recipe accepts only active registered fonts", () => {
  const layout = { ...defaultPdfLayout(), font_name: "FreeMono.otf" },
    line = newPdfLine(layout, fonts);
  line.text = "Nome";
  const job = {
    schemaVersion: 1,
    baseId: "a".repeat(32),
    baseRevision: "b".repeat(32),
    layoutId: "c".repeat(32),
    layoutRevision: "d".repeat(32),
    lines: [line],
  };
  const parsed = normalizeStaffPdfJob(job, fonts);
  line.portrait.x = 999;
  assert.equal(parsed.lines[0].portrait.x, 200);
  assert.throws(() =>
    normalizeStaffPdfJob(
      { ...job, lines: [{ ...line, fontId: "unregistered" }] },
      fonts,
    ),
  );
  const effects = {
    ...DEFAULT_PDF_TEXT_EFFECTS,
    bold: true,
    opacity: 65,
    outline: true,
    curve: -30,
    letterSpacing: 20,
  };
  const formatted = normalizeStaffPdfJob(
    {
      ...job,
      outputName: "Pedido 00123",
      lines: [{ ...line, text: "one\ntwo", effects }],
    },
    fonts,
  );
  assert.equal(formatted.lines[0].text, "one\ntwo");
  assert.deepEqual(formatted.lines[0].effects, effects);
  assert.equal(formatted.outputName, "Pedido 00123");
  assert.equal(staffPdfOutputName("  Nº 123/456.pdf  "), "Nº 123_456");
  assert.throws(() =>
    normalizeStaffPdfJob({ ...job, outputName: "../Outro" }, fonts),
  );
  assert.throws(() =>
    normalizeStaffPdfJob(
      { ...job, lines: [{ ...line, effects: { opacity: 150 } }] },
      fonts,
    ),
  );
  assert.throws(() =>
    normalizeStaffPdfJob(
      { ...job, lines: [{ ...line, text: "one\r\ntwo" }] },
      fonts,
    ),
  );

  assert.throws(() =>
    normalizeStaffPdfJob({ ...job, lines: [line, line] }, fonts),
  );
});
test("four-page files edit fronts 1/3 only; longer PDFs preserve all other pages", () => {
  assert.deepEqual(
    Array.from({ length: 4 }, (_, i) => editedStaffPdfPage(i, 4)),
    ["portrait", null, "landscape", null],
  );
  assert.deepEqual(
    Array.from({ length: 6 }, (_, i) => editedStaffPdfPage(i, 6)),
    ["portrait", null, null, null, null, null],
  );
});
test("XLSX CSV export preserves selected column order, quotes, newlines, zeros and Unicode", () => {
  assert.equal(excelColumn(0), "A");
  assert.equal(excelColumn(25), "Z");
  assert.equal(excelColumn(26), "AA");
  assert.equal(
    selectedColumnsCsv(
      [
        ["Nome", "Código", "Ignorar"],
        ['Ana; "B"', "00123", "secreto"],
      ],
      [1, 0],
    ),
    '\ufeff"Código";"Nome"\r\n"00123";"Ana; ""B"""\r\n',
  );
  assert.equal(safeCsvCell('=HYPERLINK("evil")'), '"\'=HYPERLINK(""evil"")"');
  assert.equal(safeCsvCell(" \t@SUM(1)"), '"\' \t@SUM(1)"');
  assert.equal(safeCsvCell("-12.5"), '"-12.5"');
  assert.throws(() => selectedColumnsCsv([], []));
  assert.throws(() => selectedColumnsCsv([], [-1]));
});

test("staff molds can use inactive fonts and fall back to the system font", () => {
  const layout = { ...defaultPdfLayout(), font_name: "FreeMono.otf" };
  assert.equal(
    newPdfLine(layout, [{ ...fonts[0], ativo: false }]).fontId,
    "mono",
  );
  assert.equal(newPdfLine(layout, []).fontId, STAFF_PDF_SYSTEM_FONT.id);
  const line = newPdfLine(layout, fonts);
  const restored = fixedStaffPdfMain(layout, {
    ...line,
    text: "ANA",
    color: "#990000",
    fontSize: 120,
    effects: DEFAULT_PDF_TEXT_EFFECTS,
    portrait: { ...line.portrait, x: 0 },
  });
  assert.equal(restored.text, "ANA");
  assert.equal(restored.fontSize, 120);
  assert.equal(restored.color, layout.color);
  assert.equal(restored.portrait.x, layout.pos_x);
  assert.equal(restored.effects, undefined);
});
