import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { User as FirebaseUser } from 'firebase/auth';
import type { Anuncio, CartItem, Category, Order, Promocao, SiteConfig } from '../types';
import Home from '../pages/Home';
import Admin, { type AdminPersistence } from '../pages/Admin';

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
};

const FIXTURE_CATEGORIES: Category[] = [
  { id: 'personalizados', nome: 'Personalizados', icon: '' },
  { id: 'livros-de-receita', nome: 'Livros de Receita', icon: '' },
];

const FIXTURE_PRODUCTS: Anuncio[] = [
  {
    id: '1yi50l93z',
    nome: 'Carimbo',
    desc: 'Carimbo personalizado',
    categoria: 'Personalizados',
    imagem: '/logo.png',
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
    imagem: '/logo.png',
    imagens: [],
    preco_base: '39,90',
    atributos: [],
    combinacoes: {},
    tipoInput: 'texto',
    labelTexto: 'Nome para personalização',
  },
];

const FIXTURE_PROMOTIONS: Promocao[] = [
  { id: 'promo-teste', titulo: 'Promoção de teste', imagem: '/logo.png', link: '#produtos', ativa: true },
];

const FIXTURE_ORDERS: Order[] = [
  {
    id: 'GB-E2E-PAGO',
    userId: 'e2e-user',
    data: '2026-09-02T00:00:00.000Z',
    itens: [{
      id: '1yi50l93z-e2e',
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

function StoreFixture() {
  const [cart, setCart] = React.useState<CartItem[]>([]);
  const [checkoutRedirect, setCheckoutRedirect] = React.useState('');

  return (
    <div data-testid="e2e-store">
      <Home
        products={FIXTURE_PRODUCTS}
        config={FIXTURE_CONFIG}
        categories={FIXTURE_CATEGORIES}
        promotions={FIXTURE_PROMOTIONS}
        cart={cart}
        setCart={setCart}
        orders={FIXTURE_ORDERS}
        user={FIXTURE_USER}
        isAdmin
        productsReady
        productsError={null}
        ordersReady
        ordersError={null}
        onCheckoutRedirect={setCheckoutRedirect}
      />
      <output hidden data-testid="e2e-checkout-redirect">{checkoutRedirect}</output>
    </div>
  );
}

function AdminFixture() {
  const [products, setProducts] = React.useState(FIXTURE_PRODUCTS);
  const [categories, setCategories] = React.useState(FIXTURE_CATEGORIES);
  const [promotions, setPromotions] = React.useState(FIXTURE_PROMOTIONS);
  const [config, setConfig] = React.useState(FIXTURE_CONFIG);
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

  return (
    <div data-testid="e2e-admin">
      <Admin
        products={products}
        config={config}
        categories={categories}
        orders={FIXTURE_ORDERS}
        ordersReady
        ordersError={null}
        promotions={promotions}
        persistence={persistence}
        onLogout={() => setLastAction('logout')}
      />
      <output hidden data-testid="e2e-admin-action">{lastAction}</output>
    </div>
  );
}

export default function E2EHarness() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/__e2e/store" element={<StoreFixture />} />
        <Route path="/__e2e/admin" element={<AdminFixture />} />
        <Route path="*" element={<Navigate to="/__e2e/store" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
