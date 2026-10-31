import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { createProductionLabel, productionLabelFingerprint } from './productionLabel';
import type { Order } from '../types';
const order = { data: '2026-10-30T12:00:00Z', clienteNome: 'João de teste', metodoEntrega: 'retirada', itens: [{ nome: 'Caderno com personalização', quantidade: 2, selecoes: { Cor: 'Azul', Tamanho: 'A5' }, textoPersonalizado: 'Primeira linha\nSegunda linha 🎨', printProfile: { widthMm: 148, heightMm: 210, bleedMm: 3, safeMarginMm: 5, targetDpi: 300 } }] } as unknown as Order;
test('production PDF has A6 dimensions, handles Unicode and paginates instead of clipping long orders', async () => {
  const pdf = await PDFDocument.load(await createProductionLabel('GB-TEST', order));
  assert.ok(Math.abs(pdf.getPage(0).getWidth() - 105 * 72 / 25.4) < 0.01); assert.ok(Math.abs(pdf.getPage(0).getHeight() - 148 * 72 / 25.4) < 0.01);
  const long = await PDFDocument.load(await createProductionLabel('GB-TEST', { ...order, itens: Array.from({ length: 30 }, () => order.itens[0]) }));
  assert.ok(long.getPageCount() > 1); assert.equal(order.itens[0].textoPersonalizado, 'Primeira linha\nSegunda linha 🎨');
});
test('label identity preserves production stage changes while detecting modified order contents', () => {
  const data = order as unknown as Record<string, unknown>;
  assert.equal(productionLabelFingerprint(data), productionLabelFingerprint({ ...data, fulfillmentStatus: 'em_producao' }));
  assert.notEqual(productionLabelFingerprint(data), productionLabelFingerprint({ ...data, clienteNome: 'Outro cliente' }));
});
