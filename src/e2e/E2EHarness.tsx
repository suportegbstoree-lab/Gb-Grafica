import { createSalesAdminApi } from '../services/salesService';
import PersonalizationFontLoader from '../components/PersonalizationFontLoader';
import { fixtureWorkApi,fixtureDocumentApi,emptyPdfLibrary } from './workClient';
import StaffPdfFixture from './StaffPdfFixture';
import type { StaffPdfApi } from '../services/staffPdfService';
import { currentWorkTask } from '../services/workContext';
import { EMPTY_PROFILE } from '../lib/customerProfile';
import type { CustomerApi } from '../services/customerService';
import { fixtureEmailApi } from './emailClient';
import { operationsFixtureClient } from './operationsClient';
import { StoreThemeProvider } from '../components/StoreTheme';
import { pdfPreviewPages } from '../services/pdfPreview';
import PanelAccessGate from '../components/PanelAccessGate';
import { mayEnterPanel } from '../lib/panelAccess';
import { useStaffEntryFixture } from './StaffEntryFixture';
import { PDFDocument } from 'pdf-lib';
import type { OrderOperationsApi } from '../services/orderService';
import { legacyStatusForFulfillment } from '../lib/orderStatus';
import { DEFAULT_ROLE_PERMISSIONS, type StaffRoleId, type StaffRoleView } from '../lib/staffAccess';
import type { StaffAdministrationApi } from '../services/staffService';
import type { PrintProfile } from '../lib/printProfile';
import { validateAdminFontFile } from '../services/adminFontValidation';
import { adminFontFormat } from '../lib/adminAsset';
import type { PersonalizationDocument } from '../services/personalizationExport';
import {defaultPdfLayout} from '../lib/staffPdf';
import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { User as FirebaseUser } from 'firebase/auth';
import type { Anuncio, CartItem, Category, Order, Promocao, SiteConfig } from '../types';
import Home, { type PersonalizationModelStorage } from '../pages/Home';
import Admin, { type AdminAssetStorage, type AdminCatalogImageStorage, type AdminPersistence } from '../pages/Admin';

const productPdfLibraryFixture: StaffPdfApi = {
  ...emptyPdfLibrary,
  list: async () => ({
    bases: [
      { id: 'z'.repeat(32), name: 'Zebra.pdf', revision: 'a'.repeat(32), pageCount: 1, pages: [] },
      { id: 'b'.repeat(32), name: 'Álbum.pdf', revision: 'a'.repeat(32), pageCount: 1, pages: [] },
    ],
    layouts: [
      { id: 'c'.repeat(32), name: 'Zebra_template', revision: 'd'.repeat(32), layout: defaultPdfLayout() },
      { id: 'e'.repeat(32), name: 'Álbum_template', revision: 'd'.repeat(32), layout: defaultPdfLayout() },
    ],
    truncated: false,
  }),
  prepareProductCopy: async (productId, base) => {
    const response = await fetch('/__e2e/product-pdf-copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, base }),
    });
    if (!response.ok) throw new Error('Falha na fixture de vínculo.');
    return response.json();
  },
};

const FIXTURE_CONFIG: SiteConfig = {
  logo_url: '/logo.png',
  telefone1: '(16) 99937-6260',
  telefone2: '(16) 98801-6792',
  banner_principal: '/logo.png',
  banner_titulo: 'Impressão com Amor e Cuidado',
  banner_subtitulo: 'Produtos personalizados para eternizar os momentos mais especiais da sua vida.',
  banner_botao: 'Ver Produtos',
  beneficio1_titulo: 'ENVIO RÁPIDO',
  beneficio1_desc: 'EM ATÉ 2 DIAS ÚTEIS',
  beneficio2_titulo: 'PAGAMENTO SEGURO',
  beneficio2_desc: 'CARTÃO, PIX OU BOLETO',
  beneficio3_titulo: 'ALTA QUALIDADE',
  beneficio3_desc: 'IMPRESSÃO PREMIUM',
  razao_social: 'GB Gráfica Teste',
  documento_fiscal: '00.000.000/0001-00',
  endereco_comercial: 'Rua de Teste, 100, Franca/SP',
  email_atendimento: 'atendimento@example.com',
  email_privacidade: 'privacidade@example.com',
  prazo_producao: 'De 2 a 5 dias úteis após a aprovação da arte',
  fontes_personalizacao: [
    { id: 'arial', nome: 'Arial', cssFamily: 'Arial, Helvetica, sans-serif', ativo: true },
    { id: 'georgia', nome: 'Georgia', cssFamily: 'Georgia, serif', ativo: true },
  ],
};

const PRINT_PROFILE: PrintProfile = { widthMm: 100, heightMm: 150, bleedMm: 2, safeMarginMm: 5, targetDpi: 300 };
const PRINT_FIXTURE = new URLSearchParams(window.location.search).has('print');
const FIXTURE_IMAGE = '/__e2e/pixel.png';
const FIXTURE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const FIXTURE_CATEGORIES: Category[] = [
  { id: 'personalizados', nome: 'Personalizados', icon: '', ordem: 0 },
  { id: 'livros-de-receita', nome: 'Livros de Receita', icon: '', ordem: 1 },
];

const FIXTURE_PRODUCTS: Anuncio[] = [
  {
    id: '1yi50l93z',
    nome: 'Carimbo',
    desc: 'Carimbo personalizado',
    categoria: 'Personalizados',
    imagem: FIXTURE_IMAGE,
    imagens: [],
    preco_base: '8,40',
    atributos: [],
    combinacoes: {},
    tipoInput: 'nenhum',
  },
  {
    id: 'livro-receitas',
    nome: 'Livro de Receitas Personalizado',
    desc: 'Livro de receitas com capa dura e nome personalizado.',
    categoria: 'Livros de Receita',
    imagem: '/__e2e/cover.png',
    imagens: [],
    preco_base: '39,90',
    atributos: [],
    combinacoes: {},
    tipoInput: 'texto',
    labelTexto: 'Nome para personalização',
  },
];

FIXTURE_PRODUCTS.push({ id: 'caderno', nome: 'Caderno Personalizado', desc: 'Caderno com capa e contracapa.', categoria: 'Personalizados', imagem: FIXTURE_IMAGE, preco_base: '20.00', atributos: [], combinacoes: {}, tipoInput: 'arte' });
if(new URLSearchParams(window.location.search).has('variations')) {
 const id='caderneta-azul';
 FIXTURE_PRODUCTS.push({id,nome:'Caderneta Azul',desc:'Base e divulgação independentes',categoria:'Personalizados',imagem:FIXTURE_IMAGE,imagens:['/logo.png'],preco_base:'20.00',precificacao:'adicionais',tipoInput:'texto_arte',labelTexto:'Nome',combinacoes:{},atributos:[{nome:'Imagem',opcoes:['Com imagem','Sem imagem'],configuracao:{'Com imagem':{adicional:'10.00',imagem:true},'Sem imagem':{adicional:'5.00',imagem:false}}},{nome:'Nome',opcoes:['Com nome','Sem nome'],configuracao:{'Com nome':{adicional:'2.00',texto:true},'Sem nome':{adicional:'0',texto:false}}}],moldePdf:{revision:'a'.repeat(32),baseId:'b'.repeat(32),baseRevision:'c'.repeat(32),layoutId:'d'.repeat(32),layoutRevision:'e'.repeat(32),fonts:[],layout:{...defaultPdfLayout(),pos_x:100,pos_y:200,max_width_pixels:600,max_height_pixels:200,font_size:80,pos_x_landscape:100,pos_y_landscape:200,max_width_pixels_landscape:600,max_height_pixels_landscape:200},pdf:{id:'f'.repeat(32),path:`catalog/templates/${id}/${'f'.repeat(32)}.pdf`,name:'Caderneta.pdf',pages:Array.from({length:new URLSearchParams(window.location.search).get('variations')==='4'?4:2},()=>'/__e2e/cover.png')}}});
}


const CATALOG4 = new URLSearchParams(window.location.search).get('catalog') === '4';
if(CATALOG4) {
  Object.assign(FIXTURE_PRODUCTS[0],{tags:['presente','escritório'],destaque:true,lancamento:true});
  FIXTURE_PRODUCTS.push({id:'cards',nome:'Cartões de visita',desc:'Impressão em papel especial',categoria:'Personalizados',imagem:FIXTURE_IMAGE,preco_base:'45.00',tags:['negócio','presente'],atributos:[{nome:'Quantidade impressa',opcoes:['100','500']},{nome:'Material',opcoes:['A','B']}],combinacoes:{'100|A':'45.00','100|B':'55.00','500|A':'120.00','500|B':'150.00'},tipoInput:'nenhum'});
  FIXTURE_PRODUCTS.push({id:'kit',nome:'Kit escritório',desc:'Carimbo e cartões',categoria:'Personalizados',imagem:FIXTURE_IMAGE,preco_base:'52.56',atributos:[],combinacoes:{},tipoInput:'nenhum',pacote:{components:[{productId:'1yi50l93z',quantity:1,allowQuantity:false,configurable:false,selections:{}},{productId:'cards',quantity:1,allowQuantity:true,configurable:true,selections:{}}],allowQuantity:true,discountType:'percent',discountValue:10,revision:'a'.repeat(32)}});
}
if(CATALOG4) FIXTURE_PRODUCTS.push({id:'kit-fixo',nome:'Kit fixo',desc:'Opções fechadas pela loja',categoria:'Personalizados',imagem:FIXTURE_IMAGE,preco_base:'55.00',atributos:[],combinacoes:{},tipoInput:'nenhum',pacote:{components:[{productId:'cards',quantity:1,allowQuantity:false,configurable:false,selections:{'Quantidade impressa':'100',Material:'B'}}],allowQuantity:false,discountType:'none',discountValue:0,revision:'a'.repeat(32)}});
if(CATALOG4 && new URLSearchParams(window.location.search).has('bundleText')) FIXTURE_PRODUCTS.push({id:'kit-texto',nome:'Kit com texto',desc:'Livro personalizado incluído',categoria:'Livros de Receita',imagem:FIXTURE_IMAGE,preco_base:'39.90',atributos:[],combinacoes:{},tipoInput:'nenhum',pacote:{components:[{productId:'livro-receitas',quantity:1,allowQuantity:false,configurable:false,selections:{}}],allowQuantity:false,discountType:'none',discountValue:0,revision:'a'.repeat(32)}});
let fixtureProfile={...EMPTY_PROFILE};
const fixtureReviews: Record<string,any[]> = {};
const fixtureRatings: Record<string,any> = CATALOG4 ? {'1yi50l93z':{count:2,sum:9,average:4.5}} : {};
const fixtureCustomerApi: CustomerApi = {
  profile:async()=>({...fixtureProfile}),
  saveProfile:async profile=>{fixtureProfile={...profile,revision:crypto.randomUUID()};return {...fixtureProfile};},
  orders:async()=>structuredClone(FIXTURE_ORDERS),ratings:async()=>structuredClone(fixtureRatings),
  reviews:async id=>({reviews:structuredClone(fixtureReviews[id] || []),rating:fixtureRatings[id] || {count:0,sum:0,average:0}}),
  review:async(id,input)=>{fixtureReviews[id]=[{id:'review',rating:input.rating,comment:input.comment,authorName:'Cliente',verifiedPurchase:true,updatedAt:new Date().toISOString()}];fixtureRatings[id]={count:1,sum:input.rating,average:input.rating};},
};

const FLASH_FIXTURE = new URLSearchParams(window.location.search).has('flash');
const FIXTURE_PROMOTIONS: Promocao[] = [
  {
    ...(FLASH_FIXTURE ? { relampago: true, startsAt: Date.now() - 1000, endsAt: Date.now() + 60_000 } : {}),
    id: 'promo-teste',
    titulo: 'Promoção de teste',
    imagem: '/logo.png',
    link: '#produto-1yi50l93z',
    ativa: true,
    alvoTipo: 'produto',
    alvoId: '1yi50l93z',
    alvoNome: 'Carimbo',
    descontoTipo: 'percentual',
    descontoPercentual: 10,
  },
];

const FIXTURE_ORDERS: Order[] = [
  {
    id: 'GB-E2E-PAGO',
    userId: 'e2e-user',
    data: '2026-09-02T00:00:00.000Z',
    itens: [{
      id: '1yi50l93z-e2e',
      modeloPath: 'artworks/e2e-user/orders/GB-E2E-PAGO/item/11111111111111111111111111111111.png',
      contracapaPath: 'artworks/e2e-user/orders/GB-E2E-PAGO/item/22222222222222222222222222222222.png',
      contracapaModo: 'automatic',
      productId: '1yi50l93z',
      nome: 'Carimbo',
      imagem: '/logo.png',
      preco: '8,40',
      selecoes: {},
      quantidade: 1,
    }],
    total: '8,40',
    totalCents: 840,
    status: 'Pago',
    paymentStatus: 'pago',
    fulfillmentStatus: 'pagamento_confirmado',
    metodoEntrega: 'retirada',
    metodoPagamento: 'pagbank',
    clienteNome: 'Cliente E2E',
    clienteEmail: 'cliente@example.com',
  },
];

if (new URLSearchParams(window.location.search).has('delivery')) FIXTURE_ORDERS.push({
  ...FIXTURE_ORDERS[0], id: 'GB-E2E-ENVIO', metodoEntrega: 'entrega', fulfillmentStatus: 'em_producao',
  shipping: { service_code: '03220', service_name: 'SEDEX', amount_cents: 1290, delivery_days: 3, home_delivery: true, saturday_delivery: false, origin_cep: '14400000', destination_cep: '01001000', quoted_at: '2026-10-30T10:00:00.000Z', parcels: [{ weightGrams: 500, lengthCm: 20, widthCm: 15, heightCm: 5 }] },
  enderecoEntrega: { cep: '01001000', rua: 'Praça da Sé', numero: '1', bairro: 'Sé', cidade: 'São Paulo', estado: 'SP' },
});
if (PRINT_FIXTURE) {
  FIXTURE_PRODUCTS.find(product => product.id === 'caderno')!.printProfile = PRINT_PROFILE;
  FIXTURE_ORDERS[0].itens[0].printProfile = { ...PRINT_PROFILE };
  FIXTURE_ORDERS[0].itens[0].aprovacaoArte = { version: 1, acceptedAt: '2026-10-30T10:00:00.000Z', userId: 'e2e-user', modelGeneration: 25, backGeneration: 26, designFingerprint: 'a'.repeat(64) };
}

const FIXTURE_USER = {
  uid: 'e2e-user',
  displayName: 'Cliente Teste',
  email: 'cliente@example.com',
  getIdToken: async () => 'e2e-id-token',
  getIdTokenResult: async () => ({ claims: { admin: true } }),
} as unknown as FirebaseUser;

const FixtureCatalog = React.createContext<{ products: Anuncio[]; setProducts: React.Dispatch<React.SetStateAction<Anuncio[]>>; config: SiteConfig; setConfig: React.Dispatch<React.SetStateAction<SiteConfig>> }>(null!);

async function fixtureOrderModelLoader(_orderId: string, item: CartItem): Promise<PersonalizationDocument> {
  let blob = new Blob([Uint8Array.from(atob(FIXTURE_PNG_BASE64), character => character.charCodeAt(0))], { type: 'image/png' });
  if (item.printProfile) {
    const canvas = document.createElement('canvas'); canvas.width = 1040; canvas.height = 1540;
    const context = canvas.getContext('2d')!; context.fillStyle = '#2563eb'; context.fillRect(0, 0, 1040, 1540);
    blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
  }
  return { title: item.nome, ...(item.printProfile ? { printProfile: item.printProfile } : {}), pages: [{ label: 'Capa', blob }, ...(item.contracapaPath ? [{ label: 'Contracapa' as const, blob }] : [])] };
}

function StoreFixture({ panelAccess, panelAccessNeedsCheck = false }: { panelAccess?: boolean; panelAccessNeedsCheck?: boolean }) {
  const { products, config } = React.useContext(FixtureCatalog);
  const [cart, setCart] = React.useState<CartItem[]>([]);
  const [checkoutRedirect, setCheckoutRedirect] = React.useState('');
  const modelBlobs = React.useRef(new Map<string, Blob>());
  const personalizationModelStorage = React.useMemo<PersonalizationModelStorage>(() => ({
    async uploadModel(model, name) {
      const uploadId = crypto.randomUUID().replace(/-/g, '');
      const path = `artworks/e2e-user/pending/${uploadId}.png`;
      modelBlobs.current.set(path, model.blob);
      return { path, name };
    },
    async deleteModel(path) { modelBlobs.current.delete(path); },
    async readModel(path) { const blob = modelBlobs.current.get(path); if (!blob) throw new Error('Modelo de teste ausente'); return blob; },
    async uploadArtwork(file) { const path = `artworks/e2e-user/pending/${crypto.randomUUID().replace(/-/g, '')}.${file.type === 'application/pdf' ? 'pdf' : 'png'}`; modelBlobs.current.set(path, file); return { path, name: file.name }; },
  }), []);

  return (
    <div data-testid="e2e-store">
      <output hidden data-testid="e2e-cart">{JSON.stringify(cart)}</output>
      <Home
        emailApi={fixtureEmailApi}
        customerApi={fixtureCustomerApi}
        products={products}
        config={config}
        categories={FIXTURE_CATEGORIES}
        promotions={FIXTURE_PROMOTIONS}
        cart={cart}
        setCart={setCart}
        orders={FIXTURE_ORDERS}
        orderModelLoader={fixtureOrderModelLoader}
        user={FIXTURE_USER}
        canAccessPanel={panelAccess ?? true}
        panelAccessNeedsCheck={panelAccessNeedsCheck}
        productsReady
        productsError={null}
        ordersReady
        ordersError={null}
        onCheckoutRedirect={setCheckoutRedirect}
        personalizationModelStorage={personalizationModelStorage}
      />
      <output hidden data-testid="e2e-checkout-redirect">{checkoutRedirect}</output>
    </div>
  );
}

function AdminFixture({ permissionOverride }: { permissionOverride?: import('../lib/staffAccess').StaffPermission[] }) {
  const activityApi = React.useMemo<import('../services/staffActivityService').AdminActivityApi>(() => ({ orders: async orderId => { await fetch('/api/admin/activity/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId }) }); }, exportArtwork: async (orderId, itemId, format) => { await fetch('/api/admin/activity/artwork', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, itemId, format }) }); } }), []);
  const [selectedRole] = React.useState(() => new URLSearchParams(window.location.search).get('role'));
  const fixtureRole = selectedRole === 'designer' || selectedRole === 'product-manager' ? selectedRole : 'administrator';
  const salesApi = React.useMemo(() => createSalesAdminApi(async () => `e2e-sales-${permissionOverride === undefined ? fixtureRole : 'employee'}`, '/__e2e/sales'), [fixtureRole, permissionOverride]);
  const workClient = React.useMemo(()=>fixtureWorkApi(permissionOverride===undefined?fixtureRole:'employee'),[fixtureRole,permissionOverride]);
  const documentApi = React.useMemo(()=>fixtureDocumentApi(permissionOverride===undefined?fixtureRole:'employee'),[fixtureRole,permissionOverride]);
  const fixturePermissions = permissionOverride ?? (fixtureRole === 'administrator' ? [] : DEFAULT_ROLE_PERMISSIONS[fixtureRole]);
  const rolePolicies = React.useRef(new Map<StaffRoleId, StaffRoleView>((['designer', 'product-manager'] as const).map(id => [id, { id, schemaVersion: 1, configured: true, enabled: true, revision: (id === 'designer' ? 'a' : 'b').repeat(32), permissions: [...DEFAULT_ROLE_PERMISSIONS[id]], updatedAt: '', updatedBy: '' }])));
  const members = React.useRef([{ uid: 'fixture-admin', email: 'admin@example.com', name: 'Administrador Teste', role: 'administrator' as import('../lib/staffAccess').AssignedRole, enabled: true }]);
  const staffApi = React.useMemo<StaffAdministrationApi>(() => ({
    async load() { return { roles: structuredClone([...rolePolicies.current.values()].filter(value => !value.deleted)), members: structuredClone(members.current), emailConfigured: false, truncated: false }; },
    async deleteRole(id, expectedRevision) {
      const value = rolePolicies.current.get(id); if (!value || value.revision !== expectedRevision) throw new Error('Este cargo mudou. Atualize a lista antes de excluir.');
      rolePolicies.current.set(id, { ...value, enabled: false, deleted: true, permissions: [] });
      members.current = members.current.map(member => member.role === id ? { ...member, role: 'none' } : member);
    },
    async saveRole(id, permissions, _revision, name) { const value: StaffRoleView = { id, schemaVersion: 1, configured: true, enabled: true, updatedAt: '', updatedBy: '', ...rolePolicies.current.get(id), name, permissions, revision: crypto.randomUUID().replaceAll('-', '') }; rolePolicies.current.set(id, value); return structuredClone(value); },
    async assign(email, role, name) {
      if (!['admin@example.com', 'designer@example.com', 'manager@example.com'].includes(email)) throw new Error('Este e-mail ainda não possui uma conta cadastrada na loja.');
      if (email === 'admin@example.com' && role !== 'administrator') throw new Error('Sua própria função administrativa não pode ser removida por esta tela.');
      members.current = [...members.current.filter(member => member.email !== email), ...(role === 'none' ? [] : [{ uid: email, email, name: name || email, role, enabled: true }])];
      return { changed: true, uid: email, email, role, notification: { id: crypto.randomUUID(), status: 'not_configured' } };
    },
    async saveName(uid, name) { members.current = members.current.map(member => member.uid === uid ? { ...member, name } : member); },
    async retryNotification() { return { status: 'not_configured' }; },
  }), []);
  const { products, setProducts, config, setConfig } = React.useContext(FixtureCatalog);
  const [categories, setCategories] = React.useState(FIXTURE_CATEGORIES);
  const [promotions, setPromotions] = React.useState(FIXTURE_PROMOTIONS);
  const [lastAction, setLastAction] = React.useState('');
  const [orders, setOrders] = React.useState(FIXTURE_ORDERS);
  const orderOperations = React.useMemo<OrderOperationsApi>(() => ({
    async updateFulfillment(id, status, code) {
      setOrders(current => current.map(order => order.id === id ? { ...order, fulfillmentStatus: status, status: legacyStatusForFulfillment(status) as Order['status'], ...(code ? { tracking: { provider: 'correios', code, status: 'Aguardando consulta', updatedAt: new Date().toISOString() } } : {}) } : order));
    },
    async productionLabel(id) { const pdf = await PDFDocument.create(); pdf.addPage([297.64, 419.53]); const blob = new Blob([await pdf.save() as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }); setOrders(current => current.map(order => order.id === id && order.fulfillmentStatus === 'pagamento_confirmado' ? { ...order, fulfillmentStatus: 'em_producao', status: 'Processando' } : order)); return blob; },
    async refreshTracking(id) { setOrders(current => current.map(order => order.id === id ? { ...order, fulfillmentStatus: 'entregue', status: 'Entregue', tracking: { ...order.tracking!, status: 'Objeto entregue ao destinatário', eventAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } : order)); },
  }), []);

  const catalogState = React.useRef({ products, categories, promotions, config }); catalogState.current = { products, categories, promotions, config };
  const saveCatalogFixture = async (collection: string, id: string, mode: string, value?: unknown) => {
    const task = await currentWorkTask();
    const response = await fetch(`/__e2e/catalog/${collection}/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-E2E-Role': fixtureRole, ...(task?{'X-Work-Task':task}:{}) }, body: JSON.stringify({ mode, value, seed: catalogState.current }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
  };
  const persistence = React.useMemo<AdminPersistence>(() => ({
    async setDocument(collectionName, documentId, value) {
      await saveCatalogFixture(collectionName, documentId, 'set', value);
      if (collectionName === 'anuncios') {
        const product = value as Anuncio;
        setProducts(current => [...current.filter(item => item.id !== documentId), product]);
      } else if (collectionName === 'categories') {
        const category = value as Category;
        setCategories(current => [...current.filter(item => item.id !== documentId), category]);
      } else if (collectionName === 'promocoes') {
        const promotion = value as Promocao;
        setPromotions(current => [...current.filter(item => item.id !== documentId), promotion]);
      } else if (collectionName === 'config') {
        setConfig(value as SiteConfig);
      }
      setLastAction(`set:${collectionName}:${documentId}`);
    },
    async deleteDocument(collectionName, documentId) {
      await saveCatalogFixture(collectionName, documentId, 'delete');
      if (collectionName === 'anuncios') setProducts(current => current.filter(item => item.id !== documentId));
      if (collectionName === 'categories') setCategories(current => current.filter(item => item.id !== documentId));
      if (collectionName === 'promocoes') setPromotions(current => current.filter(item => item.id !== documentId));
      setLastAction(`delete:${collectionName}:${documentId}`);
    },
  }), []);

  const catalogImageStorage = React.useMemo<AdminCatalogImageStorage>(() => ({
    async uploadImage(productId, file) {
      const uploadId = crypto.randomUUID().replace(/-/g, '');
      const path = `catalog/products/${productId}/${uploadId}.png`;
      const response = await fetch(`/__e2e/uploads/${uploadId}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      const local = (await response.json()).url;
      return {
        path,
        url: file.name.startsWith('ref-') ? `https://firebasestorage.googleapis.com/v0/b/demo-sales.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media` : local,
        name: file.name,
      };
    },
    async uploadPdf(productId, file, maxPages=2) { const pages = await pdfPreviewPages(file,maxPages), id = crypto.randomUUID().replaceAll('-', ''), images = []; for (const page of pages) { const uid = crypto.randomUUID().replaceAll('-', ''); const response = await fetch(`/__e2e/uploads/${uid}`, { method: 'POST', headers: { 'Content-Type': page.type }, body: page }); images.push({ path: `catalog/products/${productId}/${uid}.png`, url: (await response.json()).url, name: page.name }); } return { template: { id, path: `catalog/templates/${productId}/${id}.pdf`, name: file.name, pages: images.map(image => image.url) }, images }; },
    async deletePdf() {},
    async deleteImage() {},
    pathFromUrl() {
      return null;
    },
  }), []);

  const adminAssetStorage = React.useMemo<AdminAssetStorage>(() => ({
    async uploadImage(scope, ownerId, file) {
      const uploadId = crypto.randomUUID().replace(/-/g, '');
      return {
        path: `catalog/${scope}/${ownerId}/${uploadId}.png`,
        url: `https://example.com/${scope}/${ownerId}/${uploadId}.png`,
        name: file.name,
      };
    },
    async uploadFont(fontId, file, onProgress) {
      const delay = Math.min(1000, Math.max(0, Number(new URLSearchParams(window.location.search).get('font-upload-delay')) || 0));
      if (delay) { onProgress?.(25); await new Promise(resolve => setTimeout(resolve, delay)); }
      const format = adminFontFormat(await validateAdminFontFile(file));
      const uploadId = crypto.randomUUID().replace(/-/g, '');
      return {
        path: `catalog/fonts/${fontId}/${uploadId}.${format}`,
        url: `/__e2e/fonts/editor-font.${format}`,
        name: file.name,
      };
    },
    async deleteAsset() {},
    pathFromUrl() {
      return null;
    },
  }), []);

  return (
    <div data-testid="e2e-admin">
      <Admin
        salesApi={salesApi}
        workClient={workClient}
        documentApi={documentApi}
        pdfLibraryApi={new URLSearchParams(window.location.search).has('pdf-binding') ? productPdfLibraryFixture : emptyPdfLibrary}
        emailApi={fixtureEmailApi}
        activityApi={activityApi}
        operationsClient={operationsFixtureClient}
        fullAdmin={permissionOverride === undefined && fixtureRole === 'administrator'}
        permissions={fixturePermissions}
        staffApi={staffApi}
        products={products}
        config={config}
        categories={categories}
        orders={permissionOverride === undefined || permissionOverride.includes('orders.read') ? orders : []}
        orderOperations={orderOperations}
        orderModelLoader={fixtureOrderModelLoader}
        ordersReady
        ordersError={null}
        promotions={promotions}
        persistence={persistence}
        catalogImageStorage={catalogImageStorage}
        adminAssetStorage={adminAssetStorage}
        onLogout={() => setLastAction('logout')}
      />
      <output hidden data-testid="e2e-products">{JSON.stringify(products)}</output>
      <output hidden data-testid="e2e-admin-action">{lastAction}</output>
    </div>
  );
}

function AdminFixtureRedirect() { const location = useLocation(); return <Navigate to={`/admin${location.search}`} replace />; }

export default function E2EHarness() {
  const entry = useStaffEntryFixture();
  const teamPanel = <PanelAccessGate user={entry.signedIn ? FIXTURE_USER : null} ready={entry.access.ready} allowed={mayEnterPanel(false, entry.permissions)} issue={entry.access.issue} onSignIn={entry.signIn} onSignOut={entry.signOut} onRetry={entry.retry}><AdminFixture permissionOverride={entry.permissions} /></PanelAccessGate>;
  const teamStore = <StoreFixture panelAccess={mayEnterPanel(false, entry.permissions)} panelAccessNeedsCheck={entry.access.assigned && Boolean(entry.access.issue)} />;
  const [products, setProducts] = React.useState(FIXTURE_PRODUCTS);
  const [config, setConfig] = React.useState(() => {
    const count = Number(new URLSearchParams(window.location.search).get('font-count'));
    return Number.isInteger(count) && count > 0 && count <= 500
      ? { ...FIXTURE_CONFIG, fontes_personalizacao: Array.from({ length: count }, (_, i) => ({ id: `bulk${i}`, nome: `Fonte bulk ${i}`, cssFamily: `BulkFont_${i}`, arquivoUrl: `/__e2e/fonts/editor-font.ttf?sample=${i}`, arquivoFormato: 'ttf' as const, ativo: true })) }
      : FIXTURE_CONFIG;
  });
  return (
    <FixtureCatalog.Provider value={{ products, setProducts, config, setConfig }}>
    <PersonalizationFontLoader fonts={config.fontes_personalizacao || []} />
    <BrowserRouter>
      <StoreThemeProvider><Routes>
        <Route path="/__e2e/staff-pdf" element={<StaffPdfFixture />} />
        <Route path="/__e2e/store" element={<StoreFixture />} />
        <Route path="/__e2e/admin" element={<AdminFixtureRedirect />} />
        <Route path="/__e2e/team" element={teamStore} />
        <Route path="/__e2e/team/admin" element={teamPanel} />
        <Route path="/admin/*" element={entry.active ? teamPanel : <AdminFixture />} />
        <Route path="/" element={entry.active ? teamStore : <StoreFixture />} />
        <Route path="/categoria/:categoryId" element={<StoreFixture />} />
        <Route path="/produto/:productId" element={<StoreFixture />} />
        <Route path="/pacotes" element={<StoreFixture />} />
        <Route path="/destaques" element={<StoreFixture />} />
        <Route path="/promocoes" element={<StoreFixture />} />
        <Route path="/lancamentos" element={<StoreFixture />} />
        <Route path="/minha-conta" element={<StoreFixture />} />
        <Route path="*" element={<Navigate to="/__e2e/store" replace />} />
      </Routes></StoreThemeProvider>
    </BrowserRouter>
    </FixtureCatalog.Provider>
  );
}
