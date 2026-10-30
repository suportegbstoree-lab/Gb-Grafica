import type { PersonalizationDocument } from '../services/personalizationExport';
import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { User as FirebaseUser } from 'firebase/auth';
import type { Anuncio, CartItem, Category, Order, Promocao, SiteConfig } from '../types';
import Home, { type PersonalizationModelStorage } from '../pages/Home';
import Admin, { type AdminAssetStorage, type AdminCatalogImageStorage, type AdminPersistence } from '../pages/Admin';

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

const FIXTURE_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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
    imagem: FIXTURE_IMAGE,
    imagens: [],
    preco_base: '39,90',
    atributos: [],
    combinacoes: {},
    tipoInput: 'texto',
    labelTexto: 'Nome para personalização',
  },
];

FIXTURE_PRODUCTS.push({ id: 'caderno', nome: 'Caderno Personalizado', desc: 'Caderno com capa e contracapa.', categoria: 'Personalizados', imagem: FIXTURE_IMAGE, preco_base: '20.00', atributos: [], combinacoes: {}, tipoInput: 'arte' });

const FIXTURE_PROMOTIONS: Promocao[] = [
  {
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

const FIXTURE_USER = {
  uid: 'e2e-user',
  displayName: 'Cliente Teste',
  email: 'cliente@example.com',
  getIdToken: async () => 'e2e-id-token',
  getIdTokenResult: async () => ({ claims: { admin: true } }),
} as unknown as FirebaseUser;

const FixtureCatalog = React.createContext<{ products: Anuncio[]; setProducts: React.Dispatch<React.SetStateAction<Anuncio[]>>; config: SiteConfig; setConfig: React.Dispatch<React.SetStateAction<SiteConfig>> }>(null!);

async function fixtureOrderModelLoader(_orderId: string, item: CartItem): Promise<PersonalizationDocument> {
  const blob = new Blob([Uint8Array.from(atob(FIXTURE_IMAGE.split(',')[1]), character => character.charCodeAt(0))], { type: 'image/png' });
  return { title: item.nome, pages: [{ label: 'Capa', blob }, ...(item.contracapaPath ? [{ label: 'Contracapa' as const, blob }] : [])] };
}

function StoreFixture() {
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
    async uploadArtwork(file) { return { path: `artworks/e2e-user/pending/${crypto.randomUUID().replace(/-/g, '')}.png`, name: file.name }; },
  }), []);

  return (
    <div data-testid="e2e-store">
      <Home
        products={products}
        config={config}
        categories={FIXTURE_CATEGORIES}
        promotions={FIXTURE_PROMOTIONS}
        cart={cart}
        setCart={setCart}
        orders={FIXTURE_ORDERS}
        orderModelLoader={fixtureOrderModelLoader}
        user={FIXTURE_USER}
        isAdmin
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

function AdminFixture() {
  const { products, setProducts, config, setConfig } = React.useContext(FixtureCatalog);
  const [categories, setCategories] = React.useState(FIXTURE_CATEGORIES);
  const [promotions, setPromotions] = React.useState(FIXTURE_PROMOTIONS);
  const [lastAction, setLastAction] = React.useState('');

  const persistence = React.useMemo<AdminPersistence>(() => ({
    async setDocument(collectionName, documentId, value) {
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
      return {
        path,
        url: `https://example.com/${productId}/${uploadId}.png`,
        name: file.name,
      };
    },
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
    async uploadFont(fontId, file) {
      const uploadId = crypto.randomUUID().replace(/-/g, '');
      return {
        path: `catalog/fonts/${fontId}/${uploadId}.woff2`,
        url: `https://example.com/fonts/${fontId}/${uploadId}.woff2`,
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
        products={products}
        config={config}
        categories={categories}
        orders={FIXTURE_ORDERS}
        orderModelLoader={fixtureOrderModelLoader}
        ordersReady
        ordersError={null}
        promotions={promotions}
        persistence={persistence}
        catalogImageStorage={catalogImageStorage}
        adminAssetStorage={adminAssetStorage}
        onLogout={() => setLastAction('logout')}
      />
      <output hidden data-testid="e2e-admin-action">{lastAction}</output>
    </div>
  );
}

export default function E2EHarness() {
  const [products, setProducts] = React.useState(FIXTURE_PRODUCTS);
  const [config, setConfig] = React.useState(FIXTURE_CONFIG);
  return (
    <FixtureCatalog.Provider value={{ products, setProducts, config, setConfig }}>
    <BrowserRouter>
      <Routes>
        <Route path="/__e2e/store" element={<StoreFixture />} />
        <Route path="/__e2e/admin" element={<AdminFixture />} />
        <Route path="/admin" element={<AdminFixture />} />
        <Route path="*" element={<Navigate to="/__e2e/store" replace />} />
      </Routes>
    </BrowserRouter>
    </FixtureCatalog.Provider>
  );
}
