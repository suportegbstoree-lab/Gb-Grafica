import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createCatalogManagementRouter, type CatalogActor } from './catalogManagement';
import { createOperationsRouter } from './operationsRouter';
import { memoryFirestore } from '../../test/helpers/memoryFirestore';
import { OperationsError } from '../lib/operations';

const product = { id: 'product', nome: 'Caderno', desc: 'Caderno de teste', categoria: 'Cadernos', imagem: 'https://example.test/old.png', preco_base: '20.00', atributos: [], combinacoes: {}, tipoInput: 'nenhum' };
async function scenario(run: (context: { call: (collection: string, id: string, mode: string, value?: unknown, removed?: string[]) => Promise<Response>; docs: Map<string, any>; actor: CatalogActor; services: any; activity: () => any[]; report: () => Promise<Response> }) => Promise<void>) {
  const memory = memoryFirestore([['anuncios/product', product], ['categories/category', { id: 'category', nome: 'Cadernos' }], ['_staffProfiles/employee', { name: 'Ana Designer' }], ['_staffAccess/employee', { schemaVersion: 1, roleId: 'custom-designer', enabled: true, epoch: 'a'.repeat(32) }], ['_staffRoles/custom-designer', { schemaVersion: 1, name: 'Arte e Design', enabled: true, revision: 'b'.repeat(32), permissions: ['products.images'] }]]);
  const actor: CatalogActor = { uid: 'employee', permissions: ['products.images'] };
  const services = { db: memory.db } as any;
  const app = express(); app.use(express.json()); app.use('/catalog', createCatalogManagementRouter({ services: () => services, authorize: async () => actor }));
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
