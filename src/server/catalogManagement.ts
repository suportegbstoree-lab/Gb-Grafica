import { variationReferenceUrls } from '../lib/productSales.js';
import { VARIATION_TYPES } from './salesAdmin.js';
import { verifyProductPdfBinding } from './productPdfBinding.js';
import { retainedAssetPath } from '../lib/catalogRetention.js';
import { prepareWorkActivity } from './workTracking.js';
import { parseBundle } from '../lib/bundles.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { getAdminServices } from './firebaseAdmin.js';
import { activityActor } from './staffActivity.js';
import { BRANDING_FIELDS, FONTS_FIELDS, SETTINGS_FIELDS, PRODUCT_IMAGE_FIELDS, PRODUCT_PERSONALIZATION_FIELDS, staffPermissions, type StaffPermission } from '../lib/staffAccess.js';
import { adminAccessRecordAllows } from '../lib/adminAccess.js';
import { validateCategoryDraft, validateProductDraft, validatePromotionDraft, validateSiteConfig } from '../lib/adminValidation.js';
import { OperationsError } from '../lib/operations.js';
import { prepareCatalogRetention } from './catalogRetention.js';
import type { Anuncio, Category, Promocao } from '../types.js';
type Services = ReturnType<typeof getAdminServices>;
export interface CatalogActor { uid: string; admin?: boolean; email?: string; name?: string; permissions: StaffPermission[]; claims?: Record<string, unknown>; }
const required: Record<string, StaffPermission> = { anuncios: 'products.manage', categories: 'categories.manage', promocoes: 'promotions.manage', config: 'settings.manage' };
const own = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (message: string, status = 422): never => { throw new OperationsError(message, status); };

/** Catalog mutations and their activity entry commit together; clients cannot post fabricated activity. */
export function createCatalogManagementRouter(deps: { services: () => Services; authorize: (req: express.Request) => Promise<CatalogActor> }) {
  const router = express.Router();
  router.post('/:collection/:id', (req, res, next) => { void (async () => {
    const actor = await deps.authorize(req), services = deps.services(), db = services.db;
    const { collection, id } = req.params, mode = req.body?.mode;
    if (!Object.hasOwn(required, collection) || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || (collection === 'config' && id !== 'main') || !['set', 'patch', 'delete'].includes(mode)) fail('Cadastro inválido.');
    const available = collection === 'anuncios' ? ['products.manage', 'products.images', 'products.personalization', 'bundles.manage'] : collection === 'config' ? ['branding.manage', 'fonts.manage', 'settings.manage'] : [required[collection]];
    if (!actor.admin && !available.some(permission => actor.permissions.includes(permission as StaffPermission))) fail('Sua função não permite esta alteração.', 403);
    const value = req.body?.value || {}, removed: unknown = req.body?.removed || [];
    if (!own(value) || !Array.isArray(removed) || removed.some(key => typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) || Object.keys(value).some(key => !/^[A-Za-z][A-Za-z0-9_]*$/.test(key))) fail('Campos inválidos.');
    const [categoriesSnapshot, productsSnapshot] = await Promise.all([db.collection('categories').limit(10001).get(), db.collection('anuncios').limit(10001).get()]);
    if (categoriesSnapshot.size > 10000 || productsSnapshot.size > 10000) fail('O catálogo excede o limite de validação. Entre em contato com a administração.');
    const categories = categoriesSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Category));
    const products = productsSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Anuncio));
    const who = await activityActor(db, actor), target = db.collection(collection).doc(id);
    await db.runTransaction(async tx => {
      let permissions = actor.permissions, admin = actor.admin === true;
      if (actor.claims) {
        const access = (await tx.get(db.collection(admin ? '_adminAccess' : '_staffAccess').doc(actor.uid))).data();
        if (admin) { if (!adminAccessRecordAllows(access, actor.claims)) fail('Seu acesso foi revogado.', 403); }
        else {
          const policy = typeof access?.roleId === 'string' ? (await tx.get(db.collection('_staffRoles').doc(access.roleId))).data() : null;
          permissions = staffPermissions(access, policy, actor.claims);
        }
      }
      const old = (await tx.get(target)).data();
      if (mode === 'patch' && !old) fail('Cadastro não encontrado.', 404);
      const next = mode === 'delete' ? null : mode === 'patch' ? { ...old, ...value } : { ...value };
      if (next) for (const key of removed as string[]) delete next[key];
      const keys = [...new Set([...Object.keys(old || {}), ...Object.keys(next || {})])].filter(key => !isDeepStrictEqual(old?.[key], next?.[key]));
      const can = (permission: StaffPermission) => admin || permissions.includes(permission);
      if (collection === 'anuncios') {
        if(old && next && Boolean(old.pacote) !== Boolean(next.pacote)) fail('Crie um novo cadastro para trocar entre produto e pacote.');
        const allowed = [...(can('products.images') ? PRODUCT_IMAGE_FIELDS : []), ...(can('products.personalization') ? PRODUCT_PERSONALIZATION_FIELDS : [])];
        if ((old?.pacote || next?.pacote) && !can('bundles.manage') && (!old || !next || keys.some(key => !allowed.includes(key as any)))) fail('Sua função não permite gerenciar pacotes.', 403);
        if (!can('products.manage') && !((old?.pacote || next?.pacote) && can('bundles.manage')) && (!allowed.length || !old || !next || keys.some(key => !allowed.includes(key as any)))) fail('Sua função não permite alterar estes campos do produto.', 403);
      } else if (collection === 'config') {
        const allowed = [...(can('branding.manage') ? BRANDING_FIELDS : []), ...(can('fonts.manage') ? FONTS_FIELDS : []), ...(can('settings.manage') ? SETTINGS_FIELDS : [])];
        if (!admin && (!allowed.length || !old || !next || keys.some(key => !allowed.includes(key as any)))) fail('Sua função não permite alterar estas configurações.', 403);
      } else if (!can(required[collection])) fail('Sua função não permite esta alteração.', 403);
      if (!keys.length) return;
      let action = `${collection === 'anuncios' ? 'product' : collection === 'categories' ? 'category' : collection === 'promocoes' ? 'promotion' : 'settings'}.${!old ? 'created' : !next ? 'deleted' : 'updated'}`;
      if (collection === 'anuncios' && old && next) {
        if (keys.every(key => PRODUCT_IMAGE_FIELDS.includes(key as any))) action = 'product.images';
        else if (keys.every(key => PRODUCT_PERSONALIZATION_FIELDS.includes(key as any))) action = 'product.personalization';
      }
      if (collection === 'config') action = keys.every(key => FONTS_FIELDS.includes(key as any)) ? 'fonts.updated' : keys.every(key => BRANDING_FIELDS.includes(key as any)) ? 'branding.updated' : 'settings.updated';
      if(collection==='anuncios' && next) {
        if (keys.includes('atributos') && Array.isArray(next.atributos)) {
          if (next.atributos.length > Math.max(2, old?.atributos?.length || 0)) {
            fail('Cadastre até duas variações por produto.');
          }
          for (const attribute of next.atributos) {
            if (!attribute?.tipoId || (old?.atributos || []).some((previous: any) =>
              previous.tipoId === attribute.tipoId && previous.nome === attribute.nome)) continue;
            if (typeof attribute.tipoId !== 'string' || !/^[a-f0-9]{32}$/.test(attribute.tipoId)) fail('Tipo de variação inválido.');
            const type = (await tx.get(db.collection(VARIATION_TYPES).doc(attribute.tipoId))).data();
            if (type?.name !== attribute.nome) fail('O tipo de variação mudou. Atualize a lista e selecione novamente.', 409);
          }
        }
        if(next.imagemBase && !retainedAssetPath(next.imagemBase,services.bucket.name)?.startsWith(`catalog/products/${id}/`)) fail('Envie a arte-base para o Storage deste produto.');
        if(next.moldePdf && !isDeepStrictEqual(old?.moldePdf,next.moldePdf)) {
          if(!admin && !permissions.some(p=>['documents.generate','documents.templates.manage'].includes(p))) fail('Sua função não permite vincular bases da oficina.',403);
          await verifyProductPdfBinding(services,tx,id,next.moldePdf);
        }
      }
      const retain = await prepareCatalogRetention(db, tx, `${collection}/${id}`, old, next, services.bucket?.name || '');
      const audit=await prepareWorkActivity(db,who,action,id,tx);
      if (next) {
        if (next.id !== undefined && next.id !== id) fail('Identificador inconsistente.');
        const result = collection === 'anuncios' ? validateProductDraft({ ...next, id } as Anuncio, categories, products)
          : collection === 'categories' ? validateCategoryDraft(next as Category, categories, id)
          : collection === 'promocoes' ? validatePromotionDraft(next as Promocao, products, categories) : validateSiteConfig(next as any);
        if (!result.ok) fail((result as { message: string }).message);
        if (collection === 'anuncios') {
          if (next.pacote) {
            const parsed = parseBundle(next.pacote)!; const previous = parseBundle(old?.pacote);
            const same = previous && isDeepStrictEqual({ ...parsed, revision: '' }, { ...previous, revision: '' });
            next.pacote = { ...parsed, revision: same ? previous.revision : randomUUID().replaceAll('-', '') };
            next.preco_base = (result as any).value.preco_base;
          }
          if (keys.includes('atributos')) {
            next.atributos = (result as any).value.atributos;
            for (const url of variationReferenceUrls(next as Anuncio)) {
              if (!retainedAssetPath(url, services.bucket?.name || '')?.startsWith(`catalog/products/${id}/`)) {
                fail('Envie as referências das variações para o Storage deste produto.');
              }
            }
          }
          if (keys.includes('sku')) {
            delete next.sku;
            if ((result as any).value.sku) next.sku = (result as any).value.sku;
          }
          if (keys.includes('skuPorCombinacao')) {
            delete next.skuPorCombinacao;
            if ((result as any).value.skuPorCombinacao) next.skuPorCombinacao = (result as any).value.skuPorCombinacao;
          }
          if (next.tags) next.tags = (result as any).value.tags;
        }
        // Keep fields outside this patch intact; validators check the resulting document.
        tx.set(target, collection === 'config' ? next : { ...next, id });
      } else tx.delete(target);
      retain();
      audit.write(tx);
    });
    res.json({ saved: true });
  })().catch(next); });
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof OperationsError ? error.status : typeof (error as any)?.status === 'number' ? (error as any).status : 500;
    res.status(status >= 400 && status <= 599 ? status : 500).json({ error: status < 500 ? error instanceof Error ? error.message : 'Acesso negado.' : 'Não foi possível salvar o cadastro.' });
  });
  return router;
}
