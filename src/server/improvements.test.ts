import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { memoryFirestore } from '../../test/helpers/memoryFirestore';
import { createOrderWithDocuments, sendOrderEmail } from './orderDocuments';
import { saveProduction } from './productionEntries';
import { templateArtwork, pendingBackPdf } from './pdfTemplates';
import type { Order } from '../types';
const order: Order = { id: 'GB-D57408E74583428BAC07', userId: 'customer', data: new Date().toISOString(), itens: [{ id: 'i', productId: 'p', nome: 'Caderno', imagem: '', preco: '25.00', quantidade: 2, selecoes: {} }], total: '50.00', status: 'Pendente', metodoPagamento: 'pagbank', metodoEntrega: 'retirada', clienteNome: 'Cliente Teste', clienteEmail: 'customer@example.test', clienteTelefone: '16999999999', observacoes: 'Conferir nome na capa.' };
test('order and immutable PDF/mail jobs are created atomically without starting production', async () => {
  const { db, docs } = memoryFirestore(); await createOrderWithDocuments(db, order.id, order, 'merchant@example.test');
  assert.equal(docs.get(`orders/${order.id}`)?.status, 'Pendente');
  const bytes = docs.get(`_orderDocuments/${order.id}`)?.pdf as Buffer;
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  assert.equal(docs.get(`_orderEmails/${order.id}-customer`)?.recipient, 'customer@example.test');
  assert.equal(docs.get(`_orderEmails/${order.id}-merchant`)?.recipient, 'merchant@example.test');
  await assert.rejects(createOrderWithDocuments(db, order.id, { ...order, total: '1.00' }, 'other@example.test'));
  assert.equal(docs.get(`orders/${order.id}`)?.total, '50.00');
});
test('mail retries are locked and idempotent; old ambiguous attempts require review', async () => {
  const old = { key: process.env.RESEND_API_KEY, from: process.env.ORDER_EMAIL_FROM };
  process.env.RESEND_API_KEY = 'test-only'; process.env.ORDER_EMAIL_FROM = 'store@example.test';
  try {
    const { db, docs } = memoryFirestore(); await createOrderWithDocuments(db, order.id, order, 'merchant@example.test');
    const id = `${order.id}-customer`; let calls = 0, firstBody = '';
    const fetcher = async (_url: unknown, init?: RequestInit) => { calls++; const body = JSON.parse(String(init?.body)); firstBody = String(init?.body); assert.deepEqual(body.to, ['customer@example.test']); assert.ok(body.attachments[0].content); assert.equal(new Headers(init?.headers).get('Idempotency-Key'), `order-label-${id}`); return Response.json({ id: 'provider-id' }); };
    await Promise.all([sendOrderEmail(db, id, fetcher as typeof fetch), sendOrderEmail(db, id, fetcher as typeof fetch)]); assert.equal(calls, 1);
    assert.equal(await sendOrderEmail(db, id, fetcher as typeof fetch), 'accepted'); assert.equal(docs.get(`_orderEmails/${id}`)?.nextAttemptAt, undefined); assert.equal(calls, 1); assert.ok(firstBody.includes('Ficha') || firstBody.includes('ficha'));
    const oldJob = `${order.id}-merchant`; docs.set(`_orderEmails/${oldJob}`, { ...docs.get(`_orderEmails/${oldJob}`), attempts: 1, firstAttemptAt: Date.now() - 24 * 3600_000 });
    assert.equal(await sendOrderEmail(db, oldJob, fetcher as typeof fetch), 'needs_review'); assert.equal(docs.get(`_orderEmails/${oldJob}`)?.nextAttemptAt, undefined); assert.equal(calls, 1);
    assert.equal(docs.get(`orders/${order.id}`)?.status, 'Pendente');
  } finally { if (old.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = old.key; if (old.from === undefined) delete process.env.ORDER_EMAIL_FROM; else process.env.ORDER_EMAIL_FROM = old.from; }
});
test('purchase receipt replies use support and retain the initial sender and reply address on retry', async () => {
  const previous = { RESEND_API_KEY: process.env.RESEND_API_KEY, ORDER_EMAIL_FROM: process.env.ORDER_EMAIL_FROM, EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO };
  Object.assign(process.env, { RESEND_API_KEY: 'test-only', ORDER_EMAIL_FROM: 'store@example.test', EMAIL_REPLY_TO: 'suporte@example.test' });
  try {
    const { db } = memoryFirestore(); await createOrderWithDocuments(db, order.id, order, 'merchant@example.test');
    const bodies: string[] = [], fetcher: typeof fetch = async (_url, options) => { bodies.push(String(options?.body)); return bodies.length === 1 ? Response.json({}, { status: 503 }) : Response.json({ id: 'provider-id' }); };
    const id = `${order.id}-customer`, now = Date.now();
    assert.equal(await sendOrderEmail(db, id, fetcher, now), 'pending');
    process.env.ORDER_EMAIL_FROM = 'changed@example.test'; process.env.EMAIL_REPLY_TO = 'changed-support@example.test';
    assert.equal(await sendOrderEmail(db, id, fetcher, now + 16 * 60000), 'accepted');
    assert.equal(bodies[0], bodies[1]); assert.equal(JSON.parse(bodies[0]).reply_to, 'suporte@example.test');
  } finally { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value; }
});
test('production corrections use compare-and-swap and cancellation retains quantities/history', async () => {
  const { db, docs } = memoryFirestore(), id = '12345678-1234-4234-8234-123456789012', entry = { employeeId: 'worker', date: '2026-10-01', service: 'Impressão', unit: 'pecas' as const, completed: 12, rework: 0, loss: 0, reason: '', reference: '', notes: '' };
  await saveProduction(db, id, entry, 'admin'); await saveProduction(db, id, entry, 'admin');
  assert.equal(docs.get(`_productionEntries/${id}`)?.version, 1);
  const results = await Promise.allSettled([saveProduction(db, id, { ...entry, completed: 15 }, 'admin', 1), saveProduction(db, id, { ...entry, completed: 20 }, 'other-admin', 1)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  await saveProduction(db, id, entry, 'admin', 2, 'Lançamento em duplicidade');
  assert.equal(docs.get(`_productionEntries/${id}`)?.completed, 15);
  assert.equal(docs.get(`_productionEntries/${id}`)?.version, 3);
  assert.ok(docs.has(`_productionEntries/${id}/history/1`));
  await assert.rejects(saveProduction(db, id, entry, 'admin', 3));
});
test('catalog PDF lookup refuses arbitrary paths and validates generation/signature; custom backs must be owned', async () => {
  const id = 'a'.repeat(32), path = `catalog/templates/product/${id}.pdf`, product = { imagem: '/front.png', modelosPdf: [{ id, path, name: 'modelo.pdf', pages: ['/front.png'] }] };
  let reads = 0;
  const bucket = { file: () => ({ getMetadata: async () => { reads++; return [{ size: 100, generation: '42', contentType: 'application/pdf', metadata: { ownerId: 'customer' } }]; }, download: async () => [Buffer.from('%PDF-1.7')] }) } as any;
  await assert.rejects(templateArtwork(bucket, 'product', product, '../other')); assert.equal(reads, 0);
  const version = await templateArtwork(bucket, 'product', product, id); assert.equal(version?.generation, 42); assert.equal(version?.path, path);
  await assert.rejects(templateArtwork(bucket, 'another', product, id));
  await assert.rejects(pendingBackPdf(bucket, 'other-customer', `artworks/customer/pending/${id}.pdf`));
  assert.equal((await pendingBackPdf(bucket, 'customer', `artworks/customer/pending/${id}.pdf`))?.generation, 42);
});
