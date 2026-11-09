import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createCatalogManagementRouter, type CatalogActor } from './catalogManagement';
import { createOperationsRouter } from './operationsRouter';
import { memoryFirestore } from '../../test/helpers/memoryFirestore';
import { defaultPdfLayout } from '../lib/staffPdf';
import { OperationsError } from '../lib/operations';

const product = { id: 'product', nome: 'Caderno', desc: 'Caderno de teste', categoria: 'Cadernos', imagem: 'https://example.test/old.png', preco_base: '20.00', atributos: [], combinacoes: {}, tipoInput: 'nenhum' };
async function scenario(run: (context: { call: (collection: string, id: string, mode: string, value?: unknown, removed?: string[]) => Promise<Response>; docs: Map<string, any>; actor: CatalogActor; services: any; activity: () => any[]; report: () => Promise<Response> }) => Promise<void>) {
  const memory = memoryFirestore([['anuncios/product', product], ['categories/category', { id: 'category', nome: 'Cadernos' }], ['_staffProfiles/employee', { name: 'Ana Designer' }], ['_staffAccess/employee', { schemaVersion: 1, roleId: 'custom-designer', enabled: true, epoch: 'a'.repeat(32) }], ['_staffRoles/custom-designer', { schemaVersion: 1, name: 'Arte e Design', enabled: true, revision: 'b'.repeat(32), permissions: ['products.images'] }]]);
  const actor: CatalogActor = { uid: 'employee', permissions: ['products.images'] };
  const services = { db: memory.db } as any;
  const app = express(); app.use(express.json({ limit: '800kb' })); app.use('/catalog', createCatalogManagementRouter({ services: () => services, authorize: async () => actor }));
  app.use('/ops', createOperationsRouter({ services: () => services, authorize: async req => { if (req.get('authorization') !== 'Bearer operations') throw new OperationsError('Acesso negado.', 403); return { uid: 'observer', admin: true }; } }));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as any, base = `http://127.0.0.1:${address.port}`;
  try { await run({ docs: memory.docs, actor, services, activity: () => [...memory.docs].filter(([key]) => key.startsWith('_operationsActivity/')).map(([, value]) => value), report: () => fetch(`${base}/ops/activity`, { headers: { Authorization: 'Bearer operations' } }), call: (collection, id, mode, value, removed) => fetch(`${base}/catalog/${collection}/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, value, removed, actor: 'forged-admin', action: 'forged-action' }) }) }); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

test('catalog changes and canonical employee activity commit together and feed operations', async () => scenario(async context => {
  const result = await context.call('anuncios', 'product', 'patch', { imagem: 'https://example.test/new.png' });
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  assert.equal(context.docs.get('anuncios/product').imagem, 'https://example.test/new.png');
  assert.equal(context.activity().length, 1);
  const event = context.activity()[0]; assert.equal(event.actor, 'employee'); assert.equal(event.actorName, 'Ana Designer'); assert.equal(event.actorRole, 'Arte e Design'); assert.equal(event.action, 'product.images'); assert.equal(event.entityId, 'product'); assert.equal(event.source, 'automatic'); assert.equal(event.timing, 'request'); assert.ok(event.durationMs >= 0); assert.equal(event.completedAt, event.at);
  const report = await (await context.report()).json(); assert.equal(report.summary.total, 1); assert.equal(report.summary.employees[0].name, 'Ana Designer');
  assert.equal((await context.call('anuncios', 'product', 'patch', { imagem: 'https://example.test/new.png' })).status, 200); assert.equal(context.activity().length, 1, 'no-op requests do not inflate activity');
}));
test('designer cannot alter price, name, delete products or mutate role/profile collections', async () => scenario(async context => {
  for (const patch of [{ preco_base: '1.00' }, { nome: 'Alterado' }]) assert.equal((await context.call('anuncios', 'product', 'patch', patch)).status, 403);
  assert.equal((await context.call('anuncios', 'product', 'delete')).status, 403);
  assert.equal((await context.call('_staffRoles', 'custom-designer', 'set', { permissions: ['operations.manage'] })).status, 422);
  assert.equal(context.docs.get('anuncios/product').preco_base, '20.00'); assert.equal(context.activity().length, 0);
}));
test('revoked or stale role policies are checked again inside the catalog transaction', async () => scenario(async context => {
  context.actor.claims = { uid: 'employee', staffRole: 'custom-designer', gbStaffEpoch: 'a'.repeat(32) };
  context.docs.set('_staffRoles/custom-designer', { ...context.docs.get('_staffRoles/custom-designer'), permissions: [] });
  assert.equal((await context.call('anuncios', 'product', 'patch', { imagem: 'https://example.test/new.png' })).status, 403);
  assert.equal(context.docs.get('anuncios/product').imagem, product.imagem); assert.equal(context.activity().length, 0);
}));
test('a failure recording activity rolls back the catalog write', async () => scenario(async context => {
  const transaction = context.services.db.runTransaction.bind(context.services.db);
  context.services.db = { ...context.services.db, runTransaction: (fn: any) => transaction((tx: any) => fn({ ...tx, create: () => { throw new Error('Audit unavailable'); } })) };
  assert.equal((await context.call('anuncios', 'product', 'patch', { imagem: 'https://example.test/new.png' })).status, 500);
  assert.equal(context.docs.get('anuncios/product').imagem, product.imagem); assert.equal(context.activity().length, 0);
}));
test('product managers generate separate category/product/promotion events with server-owned identity', async () => scenario(async context => {
  context.actor.permissions = ['products.manage', 'categories.manage', 'promotions.manage'];
  assert.equal((await context.call('categories', 'new-category', 'set', { id: 'new-category', nome: 'Novidades' })).status, 200);
  assert.equal((await context.call('anuncios', 'second', 'set', { ...product, id: 'second', nome: 'Outro caderno', categoria: 'Novidades' })).status, 200);
  const promotion = { titulo: 'Oferta', ativa: true, alvoTipo: 'produto', alvoId: 'second', alvoIds: ['second'], alvoNome: 'Outro caderno', descontoTipo: 'percentual', descontoPercentual: 10 };
  const response = await context.call('promocoes', 'offer', 'set', promotion); assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.deepEqual(context.activity().map(event => event.action), ['category.created', 'product.created', 'promotion.created']);
  assert.ok(context.activity().every(event => event.actor === 'employee'));
}));

test('bundle permission manages packages without granting ordinary product management or trusting client prices/revisions',async()=>scenario(async c=>{
 c.actor.permissions=['bundles.manage'];const pacote={components:[{productId:'product',quantity:2,allowQuantity:false,configurable:false,selections:{}}],allowQuantity:false,discountType:'percent',discountValue:10,revision:'forged'};
 const value={...product,id:'kit',nome:'Kit novo',preco_base:'0.01',pacote,tags:[' papel ','presente']};
 const response=await c.call('anuncios','kit','set',value);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const saved=c.docs.get('anuncios/kit');assert.equal(saved.preco_base,'36.00');assert.notEqual(saved.pacote.revision,'forged');assert.match(saved.pacote.revision,/^[a-f0-9]{32}$/);assert.deepEqual(saved.tags,['papel','presente']);
 assert.equal((await c.call('anuncios','product','patch',{nome:'Proibido'})).status,403);assert.equal((await c.call('anuncios','product','delete')).status,403);assert.equal((await c.call('anuncios','product','patch',{pacote})).status,422);
 const revision=saved.pacote.revision;assert.equal((await c.call('anuncios','kit','patch',{desc:'Nova descrição'})).status,200);assert.equal(c.docs.get('anuncios/kit').pacote.revision,revision);assert.equal((await c.call('anuncios','kit','patch',{pacote:{...pacote,discountValue:20}})).status,200);assert.notEqual(c.docs.get('anuncios/kit').pacote.revision,revision);
 c.actor.permissions=['products.manage'];assert.equal((await c.call('anuncios','kit','patch',{preco_base:'1.00'})).status,403);assert.equal((await c.call('anuncios','kit','delete')).status,403);c.actor.permissions=['bundles.manage'];assert.equal((await c.call('anuncios','kit','delete')).status,200);
}));

test('font managers can persist 400 fonts without truncation and cannot exceed the catalog bound or edit other settings', async () => scenario(async context => {
  const fonts = Array.from({ length: 400 }, (_, i) => ({ id: `fonte${i}`, nome: `Fonte ${i}`, cssFamily: `GBFont_${i}`, arquivoUrl: `https://example.test/${i}/${'a'.repeat(800)}.ttf`, arquivoFormato: 'ttf', ativo: true }));
  context.docs.set('config/main', { banner_principal: '/banner.png', fontes_personalizacao: [] });
  context.docs.get('_staffRoles/custom-designer').permissions = ['fonts.manage'];
  context.actor.permissions = ['fonts.manage'];
  const result = await context.call('config', 'main', 'patch', { fontes_personalizacao: fonts });
  assert.equal(result.status, 200, await result.text());
  assert.equal(context.docs.get('config/main').fontes_personalizacao.length, 400);
  assert.equal(context.docs.get('config/main').fontes_personalizacao[399].nome, 'Fonte 399');
  assert.equal((await context.call('config', 'main', 'patch', { banner_principal: '/forbidden.png' })).status, 403);
  const excess = Array.from({ length: 501 }, (_, i) => ({ id: `f${i}`, nome: `Fonte ${i}`, cssFamily: 'sans-serif', ativo: true }));
  assert.equal((await context.call('config', 'main', 'patch', { fontes_personalizacao: excess })).status, 422);
  assert.equal(context.docs.get('config/main').fontes_personalizacao.length, 400);
}));

test('option artwork validates ownership and workshop access and retains replaced assets', async () => scenario(async ({ actor, services, docs, call }) => {
  const bucket = 'option-test.firebasestorage.app';
  const url = (path: string) => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
  const imagePath = `catalog/products/product/${'1'.repeat(32)}.png`;
  const pdfId = '2'.repeat(32), baseId = '3'.repeat(32), layoutId = '4'.repeat(32), revision = '5'.repeat(32);
  const layout = defaultPdfLayout();
  const binding = {
    revision, baseId, baseRevision: revision, layoutId, layoutRevision: revision, layout, fonts: [],
    pdf: { id: pdfId, path: `catalog/templates/product/${pdfId}.pdf`, name: 'Capa.pdf', pages: [url(imagePath)] },
  };
  services.bucket = { name: bucket, file: () => ({
    getMetadata: async () => [{ contentType: 'application/pdf', md5Hash: 'matching', size: '100' }],
  }) };
  docs.set(`_staffPdfBases/${baseId}`, {
    status: 'ready', path: `staff-pdf-bases/${baseId}/original.pdf`,
    name: 'Capa.pdf', pageCount: 1, revision, pages: [],
  });
  docs.set(`_staffPdfLayouts/${layoutId}`, { enabled: true, revision, layout });
  const save = (config: unknown) => call('anuncios', 'product', 'patch', {
    precificacao: 'adicionais',
    atributos: [{ nome: 'Capa', opcoes: ['Própria', 'Padrão'], configuracao: { 'Própria': config } }],
  });

  assert.equal((await save({ imagemBase: url(imagePath) })).status, 403);
  actor.permissions = ['products.manage'];
  assert.equal((await save({ imagemBase: url(imagePath.replace('/product/', '/other/')) })).status, 422);
  assert.equal((await save({ moldePdf: binding })).status, 403);
  const image = await save({ imagemBase: url(imagePath) });
  assert.equal(image.status, 200, await image.text());
  actor.permissions.push('documents.generate');
  assert.equal((await save({ moldePdf: { ...binding, layout: { ...layout, pos_x: layout.pos_x + 1 } } })).status, 409);
  assert.equal((await save({ imagemBase: url(imagePath), moldePdf: binding })).status, 422);
  const linked = await save({ moldePdf: binding });
  assert.equal(linked.status, 200, await linked.text());
  assert.deepEqual(docs.get('anuncios/product').atributos[0].configuracao['Própria'].moldePdf, binding);
  assert.equal((await save({})).status, 200);
  const cleanup = [...docs].filter(([key]) => key.startsWith('_catalogAssetCleanup/')).map(([, record]) => record.path);
  assert.deepEqual(cleanup.sort(), [imagePath, binding.pdf.path].sort());
}));
