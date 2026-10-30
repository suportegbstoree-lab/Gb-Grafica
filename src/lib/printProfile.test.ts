import assert from 'node:assert/strict';
import test from 'node:test';
import { isInsideSafeArea, parsePrintProfile, printGeometry, printImageQuality, printProfileKey } from './printProfile';

const profile = { widthMm: 100, heightMm: 150, bleedMm: 2, safeMarginMm: 5, targetDpi: 300 };

test('formato exige números finitos, limites e uma área segura existente', () => {
  assert.deepEqual(parsePrintProfile(profile), profile);
  for (const value of [null, [], {}, { ...profile, widthMm: '100' }, { ...profile, bleedMm: -1 }, { ...profile, heightMm: Infinity }, { ...profile, targetDpi: 0 }, { ...profile, safeMarginMm: 50 }, { ...profile, widthMm: 9.99 }]) assert.equal(parsePrintProfile(value), null);
  assert.deepEqual(parsePrintProfile({ ...profile, widthMm: 100.001, secret: true }), profile);
  assert.ok(parsePrintProfile({ ...profile, bleedMm: 0, safeMarginMm: 0 }));
});

test('sangria aumenta as medidas externas e a margem segura começa dentro do corte', () => {
  const geometry = printGeometry(profile);
  assert.equal(geometry.widthMm, 104); assert.equal(geometry.heightMm, 154);
  assert.equal(geometry.trim.x, 2 / 104 * 100);
  assert.equal(geometry.safe.x, 7 / 104 * 100);
  assert.equal(geometry.safe.width, 90 / 104 * 100);
  assert.equal(isInsideSafeArea(profile, { x: 10, y: 10, width: 20, height: 20 }), true);
  assert.equal(isInsideSafeArea(profile, { x: 1, y: 10, width: 20, height: 20 }), false);
});

test('resolução efetiva considera o tamanho físico com sangria e preserva pixels', () => {
  const result = printImageQuality(profile, 1040, 1540);
  assert.equal(result.ratioMatches, true); assert.ok(Math.abs(result.dpi - 254) < 1e-8);
  assert.equal(result.belowTarget, true);
  assert.equal(result.recommendedWidth, 1229); assert.equal(result.recommendedHeight, 1819);
  assert.equal(printImageQuality(profile, 2080, 3080).belowTarget, false);
  assert.equal(printImageQuality(profile, 1040, 1040).ratioMatches, false);
  assert.equal(printImageQuality(profile, 0, 0).ratioMatches, false);
  assert.equal(printImageQuality(profile, NaN, 1).dpi, 0);
});

test('orientação depende das medidas e o identificador muda quando o formato muda', () => {
  const landscape = { ...profile, widthMm: 150, heightMm: 100 };
  assert.equal(printImageQuality(landscape, 1540, 1040).ratioMatches, true);
  assert.notEqual(printProfileKey(profile), printProfileKey(landscape));
  assert.equal(printProfileKey(undefined), '');
  assert.equal(printProfileKey(parsePrintProfile({ ...profile, irrelevant: true })), printProfileKey(profile));
});
