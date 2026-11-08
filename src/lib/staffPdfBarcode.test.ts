import test from "node:test";
import assert from "node:assert/strict";
import {
  automaticStaffBarcode,
  normalizeStaffBarcode,
  staffBarcodeBoxes,
  staffBarcodeImageWidth,
  staffPdfDefaultFilename,
  staffTrackingBarcode,
} from "./staffPdfBarcode.js";

test("Code128 accepts complete tracking payloads without trimming suffixes or changing case", () => {
  for (const code of [
    "BR263172448223P",
    "BR264979796804XSPXLM14002828",
    "BR0123456789ABC",
    "SPXLM14002828",
    "ML-123/abc",
    automaticStaffBarcode("a".repeat(36)),
  ]) {
    assert.equal(normalizeStaffBarcode(` ${code} `), code);
    assert.equal(staffTrackingBarcode(code), true);
  }
  for (const value of ["", "  ", "A".repeat(81), "á", "ABC\nDEF", null])
    assert.throws(() => normalizeStaffBarcode(value));
});

test("new barcode widths follow the Python baseline and capped horizontal placement", () => {
  assert.equal(staffBarcodeImageWidth("A".repeat(15)), 650);
  assert.equal(staffBarcodeImageWidth("A".repeat(30)), 1300);
  assert.equal(staffBarcodeImageWidth("A".repeat(60)), 2600);
  const boxes = staffBarcodeBoxes(595.5, 842.25, "BR263172448223P");
  assert.equal(boxes[0].width, (1170 * 72) / 300);
  assert.equal(boxes[0].height, (222 * 72) / 300);
  assert.ok(Math.abs(boxes[0].y - (842.25 - ((210 + 222) * 72) / 300)) < 1e-9);
  assert.equal(boxes[1].y, (210 * 72) / 300);
  assert.equal(boxes[0].x, boxes[1].x);
  assert.throws(() => staffBarcodeBoxes(10, 100));
});

test("previous batch recipes retain their original barcode geometry", () => {
  assert.equal(staffBarcodeImageWidth("BR263172448223P", 1), 412);
  assert.equal(
    staffBarcodeBoxes(595.5, 842.25, "BR263172448223P", 1)[0].width,
    (412 * 72) / 300,
  );
  const name = staffPdfDefaultFilename(
    "Variação".repeat(30),
    "ANA".repeat(50),
    "ML-123/abc",
  );
  assert.ok(name.length <= 120);
  assert.ok(name.endsWith("ML-123_abc"));
});
