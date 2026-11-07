import test from "node:test";
import assert from "node:assert/strict";
import {
  automaticStaffBarcode,
  normalizeStaffBarcode,
  staffBarcodeBoxes,
  staffPdfDefaultFilename,
  staffTrackingBarcode,
} from "./staffPdfBarcode.js";
test("staff barcodes accept both tracking formats supplied and reject malformed data", () => {
  assert.equal(normalizeStaffBarcode(" br2684621549924 "), "BR2684621549924");
  assert.equal(staffTrackingBarcode("BR263172448223P"), true);
  assert.equal(staffTrackingBarcode("GBABCDEF0123456789"), false);
  assert.equal(
    normalizeStaffBarcode(automaticStaffBarcode("a".repeat(36))),
    "GBAAAAAAAAAAAAAAAA",
  );
  for (const value of ["BR123", "<script>", "BR1234567890123X", "", null])
    assert.throws(() => normalizeStaffBarcode(value));
});
test("barcode boxes match the desktop top/bottom margins without altering their size", () => {
  const boxes = staffBarcodeBoxes(595.5, 842.25);
  assert.equal(boxes[0].width, (412 * 72) / 300);
  assert.equal(boxes[0].height, (222 * 72) / 300);
  assert.ok(Math.abs(boxes[0].y - (842.25 - ((210 + 222) * 72) / 300)) < 1e-9);
  assert.equal(boxes[1].y, (210 * 72) / 300);
  assert.equal(boxes[0].x, boxes[1].x);
  assert.throws(() => staffBarcodeBoxes(40, 100));
  const name = staffPdfDefaultFilename(
    "Variação".repeat(30),
    "ANA".repeat(50),
    "BR2684621549924",
  );
  assert.ok(name.length <= 120);
  assert.ok(name.endsWith("BR2684621549924"));
});
