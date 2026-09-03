/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import Home from './pages/Home';
import { Anuncio, SiteConfig, CartItem, Order, Category, Promocao } from './types';
import { INITIAL_CONFIG } from './constants';
import {
  db, auth, onAuthStateChanged, onSnapshot, collection, query, orderBy, where, doc, getDoc, setDoc, FirebaseUser, handleFirestoreError, OperationType
} from './firebase';
import { LEGAL_ROUTES, type LegalDocumentId } from './lib/legal';
import { DEFAULT_LOGO_URL, resolvePublicImage } from './lib/seo';

const Admin = lazy(() => import('./pages/Admin'));
const LegalPage = lazy(() => import('./pages/LegalPage'));
const NotFound = lazy(() => import('./pages/NotFound'));

function restoreCart(): CartItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('gb_cart') || '[]');
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is CartItem => (
      typeof item === 'object' && item !== null &&
      typeof item.id === 'string' &&
      typeof item.productId === 'string' &&
      typeof item.nome === 'string' &&
      typeof item.preco === 'string' &&
      Number.isInteger(item.quantidade) && item.quantidade > 0
    ));
  } catch {
    localStorage.removeItem('gb_cart');
    return [];
  }
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#060606] flex items-center justify-center" role="status">
      <div className="text-[#ff4d79] animate-pulse font-bold">Carregando...</div>
    </div>
  );
}

function LegalRoute({ documentId, config }: { documentId: LegalDocumentId; config: SiteConfig }) {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <LegalPage documentId={documentId} config={config} />
    </Suspense>
  );
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const [products, setProducts] = useState<Anuncio[]>([]);
  const [productsReady, setProductsReady] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [config, setConfig] = useState<SiteConfig>(INITIAL_CONFIG);
  const [configExists, setConfigExists] = useState<boolean | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [promotions, setPromotions] = useState<Promocao[]>([]);
  const [cart, setCart] = useState<CartItem[]>(restoreCart);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersReady, setOrdersReady] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const previousUserId = useRef<string | null>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        let hasAdminClaim = false;
        try {
          const token = await firebaseUser.getIdTokenResult();
          hasAdminClaim = token.claims.admin === true;
        } catch (error) {
          console.error('Não foi possível verificar as permissões do token:', error);
        }
        // Check Admin Role
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            setIsAdmin(hasAdminClaim || userDoc.data().role === 'admin');
          } else {
            const role = hasAdminClaim ? 'admin' : 'user';
            setIsAdmin(hasAdminClaim);
            await setDoc(doc(db, 'users', firebaseUser.uid), {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              role: role
            });
            setIsAdmin(hasAdminClaim);
          }
        } catch (error) {
          console.error('Não foi possível verificar o perfil do usuário:', error);
          setIsAdmin(hasAdminClaim);
        }
      } else {
        setIsAdmin(false);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Listeners
  useEffect(() => {
    const unsubProducts = onSnapshot(query(collection(db, 'anuncios'), orderBy('nome')), (snapshot) => {
      setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Anuncio)));
      setProductsError(null);
      setProductsReady(true);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'anuncios');
      setProductsError('Não foi possível carregar os produtos agora. Tente atualizar a página.');
      setProductsReady(true);
    });

    const unsubCategories = onSnapshot(query(collection(db, 'categories'), orderBy('nome')), (snapshot) => {
      setCategories(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'categories'));

    const unsubPromotions = onSnapshot(query(collection(db, 'promocoes'), orderBy('titulo')), (snapshot) => {
      setPromotions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Promocao)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'promocoes'));

    const unsubConfig = onSnapshot(doc(db, 'config', 'main'), async (docSnap) => {
      setConfigExists(docSnap.exists());
      if (docSnap.exists()) {
        const data = docSnap.data() as Partial<SiteConfig>;
        setConfig({ ...INITIAL_CONFIG, ...data });
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, 'config/main'));

    return () => {
      unsubProducts();
      unsubCategories();
      unsubPromotions();
      unsubConfig();
    };
  }, []);

  useEffect(() => {
    if (!isAdmin || configExists !== false) return;

    setDoc(doc(db, 'config', 'main'), INITIAL_CONFIG)
      .catch((error) => handleFirestoreError(error, OperationType.CREATE, 'config/main'));
  }, [configExists, isAdmin]);

  // Orders Listener (Only if logged in)
  useEffect(() => {
    if (!user) {
      setOrders([]);
      setOrdersReady(true);
      setOrdersError(null);
      return;
    }
    setOrdersReady(false);
    setOrdersError(null);
    const q = isAdmin
      ? query(collection(db, 'orders'), orderBy('data', 'desc'))
      : query(collection(db, 'orders'), where('userId', '==', user.uid));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const nextOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
      nextOrders.sort((first, second) => {
        const firstDate = Date.parse(first.data) || 0;
        const secondDate = Date.parse(second.data) || 0;
        return secondDate - firstDate;
      });
      setOrders(nextOrders);
      setOrdersReady(true);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'orders');
      setOrdersError('Não foi possível carregar os pedidos agora.');
      setOrdersReady(true);
    });

    return () => unsubscribe();
  }, [user, isAdmin]);

  // Sync Cart to LocalStorage
  useEffect(() => {
    localStorage.setItem('gb_cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    const nextUserId = user?.uid || null;
    if (previousUserId.current && previousUserId.current !== nextUserId) {
      setCart([]);
    }
    previousUserId.current = nextUserId;
  }, [user?.uid]);

  // Update favicon. Each public document controls its own page title.
  useEffect(() => {
    const faviconUrl = resolvePublicImage(config.logo_url || DEFAULT_LOGO_URL);

    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.getElementsByTagName('head')[0].appendChild(link);
    }
    link.href = faviconUrl;
  }, [config.logo_url]);

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={
            isAuthReady ? <Home
              products={products}
              config={config}
              categories={categories}
              promotions={promotions}
              cart={cart}
              setCart={setCart}
              orders={orders}
              user={user}
              isAdmin={isAdmin}
              productsReady={productsReady}
              productsError={productsError}
              ordersReady={ordersReady}
              ordersError={ordersError}
            /> : <LoadingScreen />
          }
        />
        <Route
          path="/admin"
          element={
            !isAuthReady ? <LoadingScreen /> : isAdmin ? (
              <Suspense fallback={<LoadingScreen />}>
                <Admin
                  products={products}
                  config={config}
                  categories={categories}
                  orders={orders}
                  ordersReady={ordersReady}
                  ordersError={ordersError}
                  promotions={promotions}
                />
              </Suspense>
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route path={LEGAL_ROUTES.about} element={<LegalRoute documentId="about" config={config} />} />
        <Route path={LEGAL_ROUTES.privacy} element={<LegalRoute documentId="privacy" config={config} />} />
        <Route path={LEGAL_ROUTES.terms} element={<LegalRoute documentId="terms" config={config} />} />
        <Route path={LEGAL_ROUTES.exchanges} element={<LegalRoute documentId="exchanges" config={config} />} />
        <Route path={LEGAL_ROUTES.production} element={<LegalRoute documentId="production" config={config} />} />
        <Route path={LEGAL_ROUTES.artwork} element={<LegalRoute documentId="artwork" config={config} />} />
        <Route path={LEGAL_ROUTES.lgpd} element={<LegalRoute documentId="lgpd" config={config} />} />
        <Route path="*" element={<Suspense fallback={<LoadingScreen />}><NotFound /></Suspense>} />
      </Routes>
    </Router>
  );
}
