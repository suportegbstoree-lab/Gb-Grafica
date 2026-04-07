/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Admin from './pages/Admin';
import { Product, SiteConfig, CartItem, Order } from './types';
import { INITIAL_PRODUCTS, INITIAL_CONFIG, INITIAL_CATEGORIES } from './constants';
import { 
  db, auth, onAuthStateChanged, onSnapshot, collection, query, orderBy, where, doc, getDoc, setDoc, FirebaseUser, handleFirestoreError, OperationType 
} from './firebase';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [config, setConfig] = useState<SiteConfig>(INITIAL_CONFIG);
  const [categories, setCategories] = useState<string[]>([]);
  const [cart, setCart] = useState<CartItem[]>(() => {
    const saved = localStorage.getItem('gb_cart');
    return saved ? JSON.parse(saved) : [];
  });
  const [orders, setOrders] = useState<Order[]>([]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // Check Admin Role
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            setIsAdmin(userDoc.data().role === 'admin');
          } else {
            // Check if default admin
            const isDefaultAdmin = firebaseUser.email === 'ggarciapalermo@gmail.com' && firebaseUser.emailVerified;
            const role = isDefaultAdmin ? 'admin' : 'user';
            await setDoc(doc(db, 'users', firebaseUser.uid), {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              role: role
            });
            setIsAdmin(isDefaultAdmin);
          }
        } catch (error) {
          console.error("Error checking user role:", error);
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
    const unsubProducts = onSnapshot(query(collection(db, 'products'), orderBy('nome')), (snapshot) => {
      setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'products'));

    const unsubCategories = onSnapshot(query(collection(db, 'categories'), orderBy('nome')), (snapshot) => {
      setCategories(snapshot.docs.map(doc => doc.data().nome));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'categories'));

    const unsubConfig = onSnapshot(doc(db, 'config', 'main'), async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as SiteConfig;
        setConfig(data);
        // If logo_url is missing or empty, update it with the initial value if user is admin
        if (!data.logo_url && isAdmin) {
          try {
            await setDoc(doc(db, 'config', 'main'), { ...data, logo_url: INITIAL_CONFIG.logo_url }, { merge: true });
          } catch (error) {
            console.error("Error updating logo_url:", error);
          }
        }
      } else if (isAdmin) {
        // Bootstrap initial config if missing and user is admin
        try {
          await setDoc(doc(db, 'config', 'main'), INITIAL_CONFIG);
        } catch (error) {
          console.error("Error bootstrapping config:", error);
        }
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, 'config/main'));

    return () => {
      unsubProducts();
      unsubCategories();
      unsubConfig();
    };
  }, []);

  // Orders Listener (Only if logged in)
  useEffect(() => {
    if (!user) {
      setOrders([]);
      return;
    }
    const q = isAdmin 
      ? query(collection(db, 'orders'), orderBy('data', 'desc'))
      : query(collection(db, 'orders'), where('userId', '==', user.uid));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'orders'));

    return () => unsubscribe();
  }, [user, isAdmin]);

  // Sync Cart to LocalStorage
  useEffect(() => {
    localStorage.setItem('gb_cart', JSON.stringify(cart));
  }, [cart]);

  // Update Title and Favicon
  useEffect(() => {
    const title = "GB Gráfica | Impressão de Alta Qualidade";
    document.title = title;
    
    // Force title update for some browsers
    const titleElement = document.querySelector('title');
    if (titleElement) titleElement.innerText = title;

    const faviconUrl = config.logo_url || "/logo.png";
    
    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.getElementsByTagName('head')[0].appendChild(link);
    }
    link.href = faviconUrl;
  }, [config.logo_url]);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#060606] flex items-center justify-center">
        <div className="text-[#ff4d79] animate-pulse font-bold">Carregando...</div>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route 
          path="/" 
          element={
            <Home 
              products={products} 
              config={config} 
              categories={categories} 
              cart={cart}
              setCart={setCart}
              orders={orders}
              user={user}
              isAdmin={isAdmin}
            />
          } 
        />
        <Route 
          path="/admin" 
          element={
            isAdmin ? (
              <Admin 
                products={products} 
                config={config} 
                categories={categories}
                orders={orders}
              />
            ) : (
              <Home 
                products={products} 
                config={config} 
                categories={categories} 
                cart={cart}
                setCart={setCart}
                orders={orders}
                user={user}
                isAdmin={isAdmin}
              />
            )
          } 
        />
      </Routes>
    </Router>
  );
}



