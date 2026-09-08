import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ShoppingCart, Phone, Settings, CheckCircle2, ChevronRight, X, Trash2, Package, Clock, LogIn, LogOut, Loader2, Share2, Facebook, Twitter, MessageCircle, CreditCard, QrCode, AlertCircle, Upload, FileText, Pause, Play } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Anuncio, SiteConfig, CartItem, Order, Category, Promocao } from '../types';
import { cn } from '../lib/utils';
import { loginWithGoogle, logout, FirebaseUser } from '../firebase';
import { createCartItemId, formatBrazilianPhone, formatCpf, formatMoney, isHttpUrl, isValidBrazilianPhone, isValidCpf, parseMoneyToCents } from '../lib/commerce';
import { fulfillmentStatusLabel, legacyFulfillmentStatus } from '../lib/orderStatus';
import { removePendingArtwork, requestArtworkUrl, uploadArtwork, type UploadedArtwork } from '../services/artworkService';
import { currentLegalAcceptance, LEGAL_ROUTES } from '../lib/legal';
import { validateCheckoutForm } from '../lib/checkoutForm';
import { createHostedCheckout, isTrustedPagBankPaymentUrl } from '../services/checkoutService';
import { buildStoreStructuredData, DEFAULT_LOGO_URL, resolvePublicImage, usePageMetadata, useStructuredData } from '../lib/seo';
import { apiErrorMessage, type ApiErrorPayload } from '../lib/apiError';

type Notice = { type: 'success' | 'error' | 'info'; message: string };

function openExternal(url: string) {
  const openedWindow = window.open(url, '_blank', 'noopener,noreferrer');
  if (openedWindow) openedWindow.opener = null;
}

function whatsappNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
}

function formatOrderDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function paymentStatusLabel(order: Order): string {
  const labels: Record<NonNullable<Order['paymentStatus']>, string> = {
    pago: 'Pagamento confirmado',
    pendente: 'Aguardando pagamento',
    em_analise: 'Pagamento em análise',
    recusado: 'Pagamento recusado',
    cancelado: 'Pagamento cancelado',
    expirado: 'Checkout expirado',
    erro: 'Falha ao criar pagamento',
  };
  return order.paymentStatus ? labels[order.paymentStatus] : order.status;
}

function paymentStatusClass(status?: Order['paymentStatus']): string {
  if (status === 'pago') return 'bg-green-50 text-green-700';
  if (status === 'recusado' || status === 'cancelado' || status === 'erro') return 'bg-red-50 text-red-700';
  if (status === 'expirado') return 'bg-gray-100 text-gray-600';
  return 'bg-amber-50 text-amber-700';
}

function trustedStoredPaymentLink(value: unknown): value is string {
  return typeof value === 'string' && isTrustedPagBankPaymentUrl(value);
}

interface ShippingInfo {
  address: string;
  price: number;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

interface HomeProps {
  products: Anuncio[];
  config: SiteConfig;
  categories: Category[];
  promotions: Promocao[];
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  orders: Order[];
  user: FirebaseUser | null;
  isAdmin: boolean;
  productsReady: boolean;
  productsError: string | null;
  ordersReady: boolean;
  ordersError: string | null;
  onCheckoutRedirect?: (url: string) => void;
}

export default function Home({ products, config, categories, promotions, cart, setCart, orders, user, isAdmin, productsReady, productsError, ordersReady, ordersError, onCheckoutRedirect }: HomeProps) {
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isOrdersOpen, setIsOrdersOpen] = useState(false);
  const [isHowToBuyOpen, setIsHowToBuyOpen] = useState(false);
  const [cep, setCep] = useState('');
  const [shippingInfo, setShippingInfo] = useState<ShippingInfo | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState<'retirada' | 'entrega'>('entrega');
  const [customerName, setCustomerName] = useState('');
  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState('');
  const [addressStreet, setAddressStreet] = useState('');
  const [addressNeighborhood, setAddressNeighborhood] = useState('');
  const [addressNumber, setAddressNumber] = useState('');
  const [addressComplement, setAddressComplement] = useState('');
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isCarouselPaused, setIsCarouselPaused] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [shippingError, setShippingError] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [acceptedLegalTerms, setAcceptedLegalTerms] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const checkoutLock = useRef(false);
  const shouldReduceMotion = useReducedMotion();

  const storeStructuredData = useMemo(() => buildStoreStructuredData(config), [config]);
  usePageMetadata({
    title: 'GB Gráfica | Loja Online Oficial',
    description: config.banner_subtitulo || 'Produtos gráficos e personalizados da GB Gráfica, com pagamento seguro pelo PagBank.',
    path: '/',
    image: config.banner_principal || config.logo_url,
  });
  useStructuredData('gb-store-structured-data', storeStructuredData);

  const slides = useMemo(() => {
    const availableSlides = [
      { image: config.banner_principal, title: config.banner_titulo, link: '' },
      ...promotions.filter(promotion => promotion.ativa).map(promotion => ({
        image: promotion.imagem,
        title: promotion.titulo,
        link: promotion.link || '',
      })),
    ].filter(slide => Boolean(slide.image?.trim()));

    return availableSlides.length > 0
      ? availableSlides
      : [{ image: DEFAULT_LOGO_URL, title: config.banner_titulo, link: '' }];
  }, [config.banner_principal, config.banner_titulo, promotions]);

  const visibleProducts = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase('pt-BR');
    return products.filter(product => {
      const matchesCategory = !activeCategory || product.categoria === activeCategory;
      const haystack = `${product.nome} ${product.desc} ${product.categoria}`.toLocaleLowerCase('pt-BR');
      return matchesCategory && (!normalizedSearch || haystack.includes(normalizedSearch));
    });
  }, [activeCategory, products, searchTerm]);

  const subtotalCents = useMemo(() => cart.reduce((total, item) => {
    const unitAmount = parseMoneyToCents(item.preco);
    return unitAmount === null ? total : total + unitAmount * item.quantidade;
  }, 0), [cart]);
  const hasInvalidCartPrice = cart.some(item => parseMoneyToCents(item.preco) === null);
  const totalCents = subtotalCents + (deliveryMethod === 'entrega' ? Math.round((shippingInfo?.price || 0) * 100) : 0);

  React.useEffect(() => {
    if (slides.length <= 1) {
      setCurrentSlide(0);
      return undefined;
    }

    setCurrentSlide(previous => Math.min(previous, slides.length - 1));
    if (isCarouselPaused || shouldReduceMotion) return undefined;
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [isCarouselPaused, shouldReduceMotion, slides.length]);

  React.useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  React.useEffect(() => {
    if (user?.displayName) setCustomerName(user.displayName);
  }, [user?.uid, user?.displayName]);

  const calculateShipping = async () => {
    if (cep.length !== 8) return;
    setIsCalculating(true);
    setShippingError(null);
    try {
      const response = await fetch('/api/shipping-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cep }),
      });
      const data = await response.json().catch(() => ({})) as {
        address?: unknown;
        amount_cents?: unknown;
        street?: unknown;
        neighborhood?: unknown;
        city?: unknown;
        state?: unknown;
      } & ApiErrorPayload;
      if (!response.ok) throw new Error(apiErrorMessage(data, 'Não foi possível calcular o frete.'));
      if (typeof data.address !== 'string' || typeof data.amount_cents !== 'number') {
        throw new Error('A cotação de frete retornou dados inválidos.');
      }
      if (
        typeof data.street !== 'string' || typeof data.neighborhood !== 'string' ||
        typeof data.city !== 'string' || typeof data.state !== 'string'
      ) {
        throw new Error('A cotação não retornou o endereço completo.');
      }
      setShippingInfo({
        address: data.address,
        price: data.amount_cents / 100,
        street: data.street,
        neighborhood: data.neighborhood,
        city: data.city,
        state: data.state,
      });
      setAddressStreet(data.street);
      setAddressNeighborhood(data.neighborhood);
    } catch (error) {
      console.error('Erro ao calcular frete:', error);
      setShippingInfo(null);
      setShippingError(error instanceof Error ? error.message : 'Não foi possível calcular o frete.');
    } finally {
      setIsCalculating(false);
    }
  };

  const addToCart = (item: CartItem) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) {
        return prev.map(i => i.id === item.id ? { ...i, quantidade: i.quantidade + 1 } : i);
      }
      return [...prev, item];
    });
    setIsCartOpen(true);
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = Math.min(999, Math.max(1, item.quantidade + delta));
        return { ...item, quantidade: newQty };
      }
      return item;
    }));
  };

  const removeFromCart = (id: string) => {
    const item = cart.find(candidate => candidate.id === id);
    setCart(prev => prev.filter(i => i.id !== id));
    if (item?.arquivoPath?.includes('/pending/')) {
      void removePendingArtwork(item.arquivoPath).catch(error => {
        console.error('Não foi possível remover a arte temporária:', error);
      });
    }
  };

  const openOrderArtwork = async (orderId: string, itemId: string) => {
    try {
      const url = await requestArtworkUrl(orderId, itemId);
      openExternal(url);
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível abrir a arte.',
      });
    }
  };

  const scrollToProducts = () => {
    document.getElementById('produtos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const selectCategory = (category: string | null) => {
    setActiveCategory(current => current === category ? null : category);
    window.requestAnimationFrame(scrollToProducts);
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    scrollToProducts();
  };

  const checkout = async () => {
    if (checkoutLock.current || isCheckingOut || cart.length === 0) return;
    if (!user) {
      setNotice({ type: 'info', message: 'Faça login para finalizar o pedido.' });
      await handleLogin();
      return;
    }
    const formResult = validateCheckoutForm({
      acceptedLegalTerms,
      customerName,
      cpf,
      phone,
      deliveryMethod,
      hasShippingQuote: Boolean(shippingInfo),
      addressStreet,
      addressNeighborhood,
      addressNumber,
      hasInvalidCartPrice,
    });
    if (formResult.ok === false) {
      setNotice({ type: 'error', message: formResult.message });
      return;
    }

    checkoutLock.current = true;
    setIsCheckingOut(true);

    try {
      const idToken = await user.getIdToken();
      const checkoutResult = await createHostedCheckout({
        items: cart.map(item => ({
          productId: item.productId,
          quantidade: item.quantidade,
          selecoes: item.selecoes,
          arquivoPath: item.arquivoPath || '',
          arquivoNome: item.arquivoNome || '',
          artePendente: item.artePendente === true,
          textoPersonalizado: item.textoPersonalizado || '',
        })),
        requestId: crypto.randomUUID(),
        customerName: formResult.customerName,
        cpf: formResult.cpf,
        phone: formResult.phone,
        deliveryMethod,
        cep: deliveryMethod === 'entrega' ? cep : undefined,
        addressNumber: deliveryMethod === 'entrega' ? addressNumber.trim() : undefined,
        addressComplement: deliveryMethod === 'entrega' ? addressComplement.trim() : undefined,
        addressStreet: deliveryMethod === 'entrega' ? addressStreet.trim() : undefined,
        addressNeighborhood: deliveryMethod === 'entrega' ? addressNeighborhood.trim() : undefined,
        legalAcceptance: currentLegalAcceptance(),
      }, idToken);

      if (checkoutResult.orderId) localStorage.setItem('gb_pending_order', checkoutResult.orderId);
      setCart([]);
      setAcceptedLegalTerms(false);
      setIsCartOpen(false);
      if (onCheckoutRedirect) onCheckoutRedirect(checkoutResult.initPoint);
      else window.location.assign(checkoutResult.initPoint);
    } catch (error: unknown) {
      console.error('Checkout error:', error);
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível iniciar o pagamento. Tente novamente.',
      });
    } finally {
      checkoutLock.current = false;
      setIsCheckingOut(false);
    }
  };

  // O retorno do PagBank não confirma pagamento. A confirmação real chega pelo webhook.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pagbankReturn = params.get('pagbank') === 'return';
    const orderId = params.get('orderId');

    if (pagbankReturn && orderId) {
      setCart([]);
      setIsOrdersOpen(true);
      localStorage.removeItem('gb_pending_order');
      setNotice({ type: 'info', message: 'Retorno recebido. O pagamento será confirmado automaticamente pelo PagBank.' });
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [fallbackError, setFallbackError] = useState(false);

  React.useEffect(() => {
    setLogoError(false);
    setFallbackError(false);
  }, [config.logo_url]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      await loginWithGoogle();
      return true;
    } catch (error: unknown) {
      console.error('Login error:', error);
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      if (code === 'auth/popup-blocked') {
        setNotice({ type: 'error', message: 'O navegador bloqueou o login. Permita pop-ups para este site e tente novamente.' });
      } else if (code === 'auth/cancelled-popup-request' || code === 'auth/popup-closed-by-user') {
        // User closed the popup, no need to alert
      } else if (code === 'auth/unauthorized-domain') {
        setNotice({ type: 'error', message: 'Este domínio ainda não está autorizado no Firebase Authentication.' });
      } else if (code === 'auth/internal-error' || code === 'auth/network-request-failed') {
        setNotice({ type: 'error', message: 'Não foi possível carregar o login do Google. Atualize a página e tente novamente.' });
      } else {
        setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Não foi possível entrar.' });
      }
      return false;
    } finally {
      setIsLoggingIn(false);
    }
  };

  const openOrders = async () => {
    if (!user) {
      setNotice({ type: 'info', message: 'Entre com sua conta para consultar os pedidos.' });
      const loggedIn = await handleLogin();
      if (loggedIn) setIsOrdersOpen(true);
      return;
    }
    setIsOrdersOpen(true);
  };

  const handleLogout = async () => {
    const pendingArtworks = cart
      .map(item => item.arquivoPath)
      .filter((path): path is string => Boolean(path?.includes('/pending/')));
    await Promise.allSettled(pendingArtworks.map(removePendingArtwork));
    setCart([]);
    localStorage.removeItem('gb_pending_order');
    await logout();
  };

  const activeSlide = slides[currentSlide] || slides[0];
  const handleBannerAction = () => {
    if (activeSlide.link && isHttpUrl(activeSlide.link)) {
      const target = new URL(activeSlide.link);
      if (target.origin === window.location.origin) window.location.assign(target.href);
      else openExternal(target.href);
      return;
    }
    scrollToProducts();
  };

  return (
    <div className="min-h-screen bg-[#fcfcfd] text-gray-900 font-sans selection:bg-pink-100 relative overflow-hidden">
      <a
        href="#produtos"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[120] focus:rounded-full focus:bg-gray-900 focus:px-5 focus:py-3 focus:text-xs focus:font-black focus:uppercase focus:tracking-widest focus:text-white"
      >
        Ir para os produtos
      </a>
      {/* Background Glows (Subtle) */}
      <div className="fixed top-[-10%] left-[-10%] w-[70%] h-[70%] bg-pink-100/30 blur-[180px] rounded-full pointer-events-none z-0"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[70%] h-[70%] bg-purple-100/30 blur-[180px] rounded-full pointer-events-none z-0"></div>

      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            role={notice.type === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={cn(
              'fixed top-4 left-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-start gap-3 rounded-2xl border px-5 py-4 text-sm font-semibold shadow-2xl',
              notice.type === 'error' && 'border-red-200 bg-red-50 text-red-700',
              notice.type === 'success' && 'border-green-200 bg-green-50 text-green-700',
              notice.type === 'info' && 'border-pink-200 bg-white text-gray-700',
            )}
          >
            {notice.type === 'error' ? <AlertCircle size={18} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
            <span className="flex-grow">{notice.message}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso" className="shrink-0 opacity-60 hover:opacity-100">
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Micro Top Bar */}
      <div className="bg-[#d14d8c] px-4 md:px-12 py-3 flex flex-wrap justify-between items-center gap-2 text-[11px] text-white relative z-40">
        <div className="flex flex-wrap gap-4 md:gap-8">
          <a href={`https://wa.me/${whatsappNumber(config.telefone1)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-pink-100 transition-colors cursor-pointer font-bold"><Phone size={14} /> {config.telefone1}</a>
          <a href={`https://wa.me/${whatsappNumber(config.telefone2)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-pink-100 transition-colors cursor-pointer font-bold"><Phone size={14} /> {config.telefone2}</a>
        </div>
        <div className="flex flex-wrap justify-end gap-x-8 gap-y-2 items-center">
          {isAdmin && (
            <Link to="/admin" className="hover:text-pink-100 flex items-center gap-2 transition-colors font-bold">
              <Settings size={14} /> Área Admin
            </Link>
          )}
          {user && (
            <button type="button" onClick={openOrders} className="hover:text-pink-100 transition-colors flex items-center gap-2 font-bold">
              <Package size={14} /> Meus Pedidos
            </button>
          )}
          {user ? (
            <button type="button" onClick={handleLogout} className="hover:text-pink-100 transition-colors flex items-center gap-2 font-bold">
              <LogOut size={14} /> Sair ({user.displayName?.split(' ')[0]})
            </button>
          ) : (
            <button
              onClick={handleLogin}
              disabled={isLoggingIn}
              className="hover:text-pink-100 transition-colors flex items-center gap-2 font-bold disabled:opacity-50"
            >
              {isLoggingIn ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
              {isLoggingIn ? 'Entrando...' : 'Entrar'}
            </button>
          )}
        </div>

        {/* Smooth Wave Bottom */}
        <div className="absolute bottom-[-15px] left-0 w-full overflow-hidden leading-[0] z-50 pointer-events-none">
          <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="relative block w-[calc(100%+1.3px)] h-[25px] fill-[#d14d8c]">
            <path d="M0,0V46.29c47.79,22.2,103.59,32.17,158,28,70.36-5.37,136.33-33.31,206.8-37.5C438.64,32.43,512.34,53.67,583,72.05c69.27,18,138.3,24.88,209.4,13.08,36.15-6,69.85-17.84,104.45-29.34C989.49,25,1113-14.29,1200,52.47V0Z" opacity=".25"></path>
            <path d="M0,0V15.81C13,36.92,27.64,56.86,47.69,72.05,99.41,111.27,165,111,224.58,91.58c31.15-10.15,60.09-26.07,89.67-39.8,40.92-19,84.73-46,130.83-49.67,36.26-2.85,70.9,9.42,98.6,31.56,31.77,25.39,62.32,62,103.63,73,40.44,10.79,81.35-6.69,119.13-24.28s75.16-39,116.92-43.05c59.73-5.85,113.28,22.88,168.9,38.84,30.2,8.66,59,6.17,87.09-7.5,22.43-10.89,48-26.93,60.65-49.24V0Z" opacity=".5"></path>
            <path d="M0,0V5.63C149.93,59,314.09,71.32,475.83,42.57c43-7.64,84.23-20.12,127.61-26.46,59-8.63,112.48,12.24,165.56,35.4C827.93,77.22,886,95.24,951.2,90c86.53-7,172.46-45.71,248.8-84.81V0Z"></path>
          </svg>
        </div>
      </div>

      {/* Header */}
      <header className="bg-[#fffdd6] px-4 md:px-12 py-12 flex flex-col md:flex-row justify-between items-center gap-8 relative overflow-hidden z-20">
        <div className="flex items-center group">
          {config.logo_url && config.logo_url.trim() !== "" && !logoError ? (
            <img
              src={resolvePublicImage(config.logo_url)}
              alt="GB Gráfica"
              className="h-24 w-auto object-contain transition-transform group-hover:scale-105"
              referrerPolicy="no-referrer"
              decoding="async"
              onError={() => setLogoError(true)}
            />
          ) : !fallbackError ? (
            <img
              src={DEFAULT_LOGO_URL}
              alt="GB Gráfica"
              className="h-24 w-auto object-contain transition-transform group-hover:scale-105"
              referrerPolicy="no-referrer"
              decoding="async"
              onError={() => setFallbackError(true)}
            />
          ) : (
            <div className="flex flex-col">
              <div className="text-4xl font-black tracking-tighter text-[#d14d8c] leading-none">GB</div>
              <div className="text-4xl font-black tracking-tighter text-[#5dc1c1] leading-none">GRÁFICA</div>
            </div>
          )}
        </div>

        <form onSubmit={submitSearch} role="search" className="flex w-full md:w-1/2 max-w-xl relative group">
          <label htmlFor="store-search" className="sr-only">Buscar produtos</label>
          <input
            id="store-search"
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value.slice(0, 100))}
            placeholder="Buscar produtos"
            className="w-full bg-white border-2 border-gray-100 rounded-full px-8 py-4 outline-none focus:border-pink-300 transition-all text-sm shadow-sm"
          />
          <button type="submit" aria-label="Buscar" className="absolute right-4 top-1/2 -translate-y-1/2 text-[#5dc1c1] hover:scale-110 transition-transform">
            <Search size={28} />
          </button>
        </form>

        <div className="flex gap-12 items-center">
          <button type="button" onClick={openOrders} className="flex items-center gap-3 group">
            <div className="w-16 h-16 rounded-full border-2 border-[#d14d8c]/30 flex items-center justify-center bg-white group-hover:border-[#d14d8c] transition-all shadow-sm">
              <Package size={28} className="text-[#d14d8c]" />
            </div>
            <span className="text-[11px] font-black uppercase tracking-widest text-[#d14d8c]">Meus Pedidos</span>
          </button>

          <button type="button" onClick={() => setIsCartOpen(true)} className="flex items-center gap-3 group relative">
            <div className="w-16 h-16 rounded-full border-2 border-[#5dc1c1]/30 flex items-center justify-center bg-white group-hover:border-[#5dc1c1] transition-all shadow-sm">
              <ShoppingCart size={28} className="text-[#5dc1c1]" />
            </div>
            <div className="flex flex-col items-start">
              <span className="text-[11px] font-black uppercase tracking-widest text-[#5dc1c1]">Meu</span>
              <span className="text-[11px] font-black uppercase tracking-widest text-[#5dc1c1] mt-[-4px]">Carrinho</span>
            </div>
            {cart.length > 0 && (
              <span className="absolute top-0 left-12 bg-pink-500 text-white text-[10px] w-6 h-6 rounded-full flex items-center justify-center shadow-lg border-2 border-white font-black">
                {cart.reduce((acc, i) => acc + i.quantidade, 0)}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Navigation */}
      <nav aria-label="Categorias de produtos" className="bg-white px-4 md:px-12 py-4 flex flex-wrap justify-center gap-x-8 md:gap-x-12 gap-y-4 relative z-30 shadow-sm">
        {categories.map((cat) => (
          <motion.button
            type="button"
            key={cat.id}
            onClick={() => selectCategory(cat.nome)}
            aria-pressed={activeCategory === cat.nome}
            whileHover={{ scale: 1.05 }}
            className="flex items-center gap-2 group transition-all"
          >
            <div className="w-8 h-8 flex items-center justify-center transition-all">
              {cat.icon ? (
                <img src={cat.icon} alt="" className="w-full h-full object-contain grayscale group-hover:grayscale-0 opacity-60 group-hover:opacity-100 transition-all" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              ) : (
                <Package size={20} className="text-gray-400 group-hover:text-[#d14d8c]" />
              )}
            </div>
            <span className={cn('text-[10px] font-black uppercase tracking-tight text-gray-400 group-hover:text-[#d14d8c] transition-colors leading-none', activeCategory === cat.nome && 'text-[#d14d8c]')}>
              {cat.nome.split(' ').map((word, i) => (
                <span key={i} className={cn("block", i === 0 && word.length < 10 ? "inline" : "block")}>
                  {word} {i === 0 && word.length < 10 && ' '}
                </span>
              ))}
            </span>
          </motion.button>
        ))}

        {/* Smooth Wave Bottom for Nav */}
        <div className="absolute bottom-[-15px] left-0 w-full overflow-hidden leading-[0] z-50 pointer-events-none">
          <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="relative block w-[calc(100%+1.3px)] h-[25px] fill-white">
            <path d="M0,0V46.29c47.79,22.2,103.59,32.17,158,28,70.36-5.37,136.33-33.31,206.8-37.5C438.64,32.43,512.34,53.67,583,72.05c69.27,18,138.3,24.88,209.4,13.08,36.15-6,69.85-17.84,104.45-29.34C989.49,25,1113-14.29,1200,52.47V0Z" opacity=".25"></path>
            <path d="M0,0V15.81C13,36.92,27.64,56.86,47.69,72.05,99.41,111.27,165,111,224.58,91.58c31.15-10.15,60.09-26.07,89.67-39.8,40.92-19,84.73-46,130.83-49.67,36.26-2.85,70.9,9.42,98.6,31.56,31.77,25.39,62.32,62,103.63,73,40.44,10.79,81.35-6.69,119.13-24.28s75.16-39,116.92-43.05c59.73-5.85,113.28,22.88,168.9,38.84,30.2,8.66,59,6.17,87.09-7.5,22.43-10.89,48-26.93,60.65-49.24V0Z" opacity=".5"></path>
            <path d="M0,0V5.63C149.93,59,314.09,71.32,475.83,42.57c43-7.64,84.23-20.12,127.61-26.46,59-8.63,112.48,12.24,165.56,35.4C827.93,77.22,886,95.24,951.2,90c86.53-7,172.46-45.71,248.8-84.81V0Z"></path>
          </svg>
        </div>
      </nav>

      {/* Promo Bar */}
      <div className="bg-[#5dc1c1] py-4 text-center relative z-20">
        <span className="text-white font-black uppercase tracking-[0.3em] text-[11px]">
          {promotions.find(promotion => promotion.ativa)?.titulo || 'PERSONALIZADOS FEITOS COM CUIDADO PARA VOCÊ'}
        </span>
        {/* Smooth Wave Bottom for Promo */}
        <div className="absolute bottom-[-15px] left-0 w-full overflow-hidden leading-[0] z-50 pointer-events-none">
          <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="relative block w-[calc(100%+1.3px)] h-[25px] fill-[#5dc1c1]">
            <path d="M0,0V46.29c47.79,22.2,103.59,32.17,158,28,70.36-5.37,136.33-33.31,206.8-37.5C438.64,32.43,512.34,53.67,583,72.05c69.27,18,138.3,24.88,209.4,13.08,36.15-6,69.85-17.84,104.45-29.34C989.49,25,1113-14.29,1200,52.47V0Z" opacity=".25"></path>
            <path d="M0,0V15.81C13,36.92,27.64,56.86,47.69,72.05,99.41,111.27,165,111,224.58,91.58c31.15-10.15,60.09-26.07,89.67-39.8,40.92-19,84.73-46,130.83-49.67,36.26-2.85,70.9,9.42,98.6,31.56,31.77,25.39,62.32,62,103.63,73,40.44,10.79,81.35-6.69,119.13-24.28s75.16-39,116.92-43.05c59.73-5.85,113.28,22.88,168.9,38.84,30.2,8.66,59,6.17,87.09-7.5,22.43-10.89,48-26.93,60.65-49.24V0Z" opacity=".5"></path>
            <path d="M0,0V5.63C149.93,59,314.09,71.32,475.83,42.57c43-7.64,84.23-20.12,127.61-26.46,59-8.63,112.48,12.24,165.56,35.4C827.93,77.22,886,95.24,951.2,90c86.53-7,172.46-45.71,248.8-84.81V0Z"></path>
          </svg>
        </div>
      </div>

      {/* Banner Carousel */}
      <section className="w-full h-[500px] overflow-hidden relative group z-10" aria-roledescription="carrossel" aria-label="Destaques" aria-live={isCarouselPaused ? 'polite' : 'off'}>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentSlide}
            initial={{ opacity: 0, scale: 1.1 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="absolute inset-0"
          >
            <img
              src={activeSlide.image}
              alt={activeSlide.title || `Destaque ${currentSlide + 1}`}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              fetchPriority="high"
              decoding="async"
              onError={(event) => {
                const image = event.currentTarget;
                if (!image.dataset.fallbackApplied) {
                  image.dataset.fallbackApplied = 'true';
                  image.src = DEFAULT_LOGO_URL;
                  image.classList.add('object-contain', 'p-12');
                }
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-gray-50/90 via-transparent to-white/10"></div>
          </motion.div>
        </AnimatePresence>

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center space-y-6 px-4 max-w-4xl">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-gray-900 leading-none">
                {activeSlide.title ? (
                  <>
                    {activeSlide.title.split('<br/>').map((line, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <br/>}
                        {line.includes('**') ? (
                          <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-500">
                            {line.replace(/\*\*/g, '')}
                          </span>
                        ) : line}
                      </React.Fragment>
                    ))}
                  </>
                ) : (
                  <>
                    Impressão com <br/>
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-500">Amor e Cuidado</span>
                  </>
                )}
              </h1>
            </motion.div>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-gray-600 max-w-xl mx-auto text-base md:text-lg font-medium"
            >
              {config.banner_subtitulo || "Produtos personalizados para eternizar os momentos mais especiais da sua vida."}
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
            >
              <button type="button" onClick={handleBannerAction} className="bg-gray-900 text-white px-12 py-5 rounded-full font-black text-sm uppercase tracking-widest hover:bg-pink-500 transition-all shadow-2xl shadow-pink-100 hover:scale-105 active:scale-95">
                {activeSlide.link && isHttpUrl(activeSlide.link) ? 'Ver promoção' : (config.banner_botao || 'Ver Produtos')}
              </button>
            </motion.div>
          </div>
        </div>

        {/* Carousel Indicators */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 z-20">
          {slides.length > 1 && !shouldReduceMotion && (
            <button
              type="button"
              onClick={() => setIsCarouselPaused(previous => !previous)}
              aria-label={isCarouselPaused ? 'Retomar rotação dos destaques' : 'Pausar rotação dos destaques'}
              aria-pressed={isCarouselPaused}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/80 text-gray-700 shadow-sm transition-colors hover:bg-white"
            >
              {isCarouselPaused ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}
            </button>
          )}
          {slides.map((slide, idx) => (
            <button
              type="button"
              key={idx}
              onClick={() => setCurrentSlide(idx)}
              aria-label={`Mostrar ${slide.title || `destaque ${idx + 1}`}`}
              aria-current={currentSlide === idx}
              className={cn(
                "h-1.5 transition-all duration-500 rounded-full",
                currentSlide === idx ? "w-8 bg-pink-500" : "w-2 bg-gray-300 hover:bg-gray-400"
              )}
            />
          ))}
        </div>
      </section>

      {/* Benefits */}
      <section className="bg-white/40 backdrop-blur-sm px-4 md:px-12 py-12 flex flex-wrap justify-center gap-12 md:gap-24 border-b border-gray-100 relative z-10">
        <BenefitItem icon="🚚" title={config.beneficio1_titulo} desc={config.beneficio1_desc} />
        <BenefitItem icon="💳" title={config.beneficio2_titulo} desc={config.beneficio2_desc} />
        <BenefitItem icon="✨" title={config.beneficio3_titulo} desc={config.beneficio3_desc} />
      </section>

      {/* Main Content */}
      <main id="produtos" className="max-w-7xl mx-auto px-4 md:px-12 py-16 flex flex-col md:flex-row gap-12">
        {/* Sidebar */}
        <aside className="w-full md:w-72 flex-shrink-0">
          <div className="bg-white/60 backdrop-blur-sm rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
            <div className="p-6 border-b border-gray-100 bg-gray-50/30">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-400">Categorias</h3>
            </div>
            <div className="flex flex-col">
              {categories.map((cat) => (
                <button
                  type="button"
                  key={cat.id}
                  onClick={() => selectCategory(cat.nome)}
                  className={cn(
                    'p-5 text-[13px] font-bold uppercase tracking-wider text-gray-500 border-l-4 border-transparent hover:border-pink-400 hover:bg-pink-50/20 hover:text-pink-600 transition-all flex justify-between items-center group',
                    activeCategory === cat.nome && 'border-pink-400 bg-pink-50/30 text-pink-600',
                  )}
                >
                  {cat.nome} <ChevronRight size={16} className="text-pink-400 opacity-0 group-hover:opacity-100 transition-all translate-x-[-10px] group-hover:translate-x-0" />
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Content */}
        <section className="flex-grow" aria-labelledby="products-heading">
          <div className="flex items-center gap-4 mb-10">
            <h2 id="products-heading" className="text-3xl font-black uppercase tracking-tighter text-gray-900">
              {activeCategory ? (
                <>Categoria <span className="text-pink-500">{activeCategory}</span></>
              ) : searchTerm.trim() ? (
                <>Produtos <span className="text-pink-500">encontrados</span></>
              ) : (
                <>Mais <span className="text-pink-500">Vendidos</span></>
              )}
            </h2>
            <div className="h-px flex-grow bg-gradient-to-r from-gray-100 to-transparent"></div>
          </div>

          {productsError ? (
            <div role="alert" className="rounded-3xl border border-red-100 bg-red-50 p-8 text-center text-sm font-semibold text-red-700">
              <p>{productsError}</p>
              <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-full bg-red-700 px-5 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-red-800">
                Tentar novamente
              </button>
            </div>
          ) : !productsReady ? (
            <div role="status" className="rounded-3xl border border-gray-100 bg-white p-12 text-center text-gray-500">
              <Loader2 className="mx-auto mb-3 animate-spin text-pink-500" /> Carregando produtos...
            </div>
          ) : visibleProducts.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-gray-200 bg-white/70 p-12 text-center">
              <Search className="mx-auto mb-4 text-gray-300" size={36} />
              <p className="font-bold text-gray-700">Nenhum produto encontrado.</p>
              <button type="button" onClick={() => { setSearchTerm(''); setActiveCategory(null); }} className="mt-4 text-sm font-bold text-pink-500 hover:underline">
                Limpar filtros
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-10">
              {visibleProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  user={user}
                  onRequireLogin={handleLogin}
                  onAddToCart={addToCart}
                  onNotify={setNotice}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-100 py-20 px-4 md:px-12">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
          <div className="space-y-6">
            <div className="text-2xl font-black tracking-tighter text-gray-900">
              GB <span className="text-pink-500">GRÁFICA</span>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed font-medium">
              Sua parceira ideal para impressões de alta qualidade, brindes e materiais promocionais.
            </p>
          </div>
          <div>
            <h4 className="text-gray-900 font-black mb-6 uppercase text-xs tracking-widest">Atendimento</h4>
            <ul className="space-y-4 text-gray-500 text-sm font-medium">
              <li><a href={`https://wa.me/${whatsappNumber(config.telefone1)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-pink-500 transition-colors cursor-pointer"><Phone size={14} /> {config.telefone1}</a></li>
              <li><a href={`https://wa.me/${whatsappNumber(config.telefone2)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-pink-500 transition-colors cursor-pointer"><Phone size={14} /> {config.telefone2}</a></li>
              <li><button type="button" onClick={() => setIsHowToBuyOpen(true)} className="hover:text-pink-500 transition-colors cursor-pointer">Como Comprar</button></li>
              <li className="hover:text-pink-500 transition-colors cursor-pointer">Segunda a Sexta: 08h às 18h</li>
            </ul>
          </div>
          <div>
            <h4 className="text-gray-900 font-black mb-6 uppercase text-xs tracking-widest">Institucional</h4>
            <ul className="space-y-4 text-gray-500 text-sm font-medium">
              <li><Link to={LEGAL_ROUTES.about} className="hover:text-pink-500 transition-colors">Sobre Nós</Link></li>
              <li><Link to={LEGAL_ROUTES.privacy} className="hover:text-pink-500 transition-colors">Política de Privacidade</Link></li>
              <li><Link to={LEGAL_ROUTES.terms} className="hover:text-pink-500 transition-colors">Termos de Uso</Link></li>
              <li><Link to={LEGAL_ROUTES.exchanges} className="hover:text-pink-500 transition-colors">Trocas e Reembolsos</Link></li>
              <li><Link to={LEGAL_ROUTES.production} className="hover:text-pink-500 transition-colors">Prazos de Produção</Link></li>
              <li><Link to={LEGAL_ROUTES.artwork} className="hover:text-pink-500 transition-colors">Artes Personalizadas</Link></li>
              <li><Link to={LEGAL_ROUTES.lgpd} className="hover:text-pink-500 transition-colors">LGPD</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-gray-900 font-black mb-6 uppercase text-xs tracking-widest">Pagamento</h4>
            <div className="flex gap-4 opacity-50 grayscale hover:grayscale-0 hover:opacity-100 transition-all">
              <PaymentLogo src="https://logodownload.org/wp-content/uploads/2014/07/visa-logo-1.png" label="Visa" className="h-4" />
              <PaymentLogo src="https://logodownload.org/wp-content/uploads/2014/07/mastercard-logo.png" label="Mastercard" className="h-6" />
              <PaymentLogo src="https://logodownload.org/wp-content/uploads/2019/06/pix-logo-1.png" label="Pix" className="h-6" />
            </div>
          </div>
        </div>
        <div className="text-center pt-12 border-t border-gray-100 text-gray-400 text-[10px] uppercase tracking-widest space-y-2 font-black">
          <p>© {new Date().getFullYear()} GB Gráfica. Todos os direitos reservados.</p>
          {(config.razao_social || config.documento_fiscal) && (
            <p>{[config.razao_social, config.documento_fiscal].filter(Boolean).join(' · ')}</p>
          )}
          {config.endereco_comercial && <p>{config.endereco_comercial}</p>}
          {config.email_atendimento && (
            <p><a href={`mailto:${config.email_atendimento}`} className="hover:text-pink-500 transition-colors">{config.email_atendimento}</a></p>
          )}
          <p className="opacity-30">Build: 20260407-0307</p>
        </div>
      </footer>

      {/* Modals */}
      <AnimatePresence>
        {isCartOpen && (
          <Modal title="Meu Carrinho" onClose={() => setIsCartOpen(false)}>
            {cart.length === 0 ? (
              <div className="py-12 text-center text-gray-500">Seu carrinho está vazio.</div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-4 pr-2">
                  {cart.map((item) => (
                    <div key={item.id} className="flex gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
                      <img
                        src={item.imagem || DEFAULT_LOGO_URL}
                        alt={item.nome}
                        className="w-16 h-16 object-cover rounded"
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        onError={event => {
                          const image = event.currentTarget;
                          if (!image.dataset.fallbackApplied) {
                            image.dataset.fallbackApplied = 'true';
                            image.src = DEFAULT_LOGO_URL;
                          }
                        }}
                      />
                      <div className="flex-grow">
                        <div className="flex justify-between items-start">
                          <h4 className="font-bold text-sm">{item.nome}</h4>
                          <button type="button" aria-label={`Remover ${item.nome} do carrinho`} onClick={() => removeFromCart(item.id)} className="text-gray-500 hover:text-red-500">
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="text-[10px] text-gray-400 mt-1">
                          {Object.entries(item.selecoes).map(([k, v]) => `${k}: ${v}`).join(' | ')}
                        </div>
                        <div className="flex justify-between items-center mt-2">
                          <div className="flex items-center gap-2 bg-gray-50 rounded-lg border border-gray-100 p-1">
                            <button
                              type="button"
                              aria-label={`Diminuir quantidade de ${item.nome}`}
                              onClick={() => updateQuantity(item.id, -1)}
                              className="w-6 h-6 flex items-center justify-center hover:bg-gray-200 rounded transition-colors"
                            >
                              -
                            </button>
                            <span className="text-xs w-4 text-center font-bold">{item.quantidade}</span>
                            <button
                              type="button"
                              aria-label={`Aumentar quantidade de ${item.nome}`}
                              onClick={() => updateQuantity(item.id, 1)}
                              className="w-6 h-6 flex items-center justify-center hover:bg-gray-200 rounded transition-colors"
                            >
                              +
                            </button>
                          </div>
                          <span className="font-bold text-pink-500">{formatMoney(((parseMoneyToCents(item.preco) || 0) * item.quantidade) / 100)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-gray-100 pt-6 space-y-4">
                  {/* Forma de Entrega */}
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <label className="text-[10px] uppercase tracking-widest text-gray-400 block mb-3 font-black">Forma de Entrega</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        aria-pressed={deliveryMethod === 'entrega'}
                        onClick={() => setDeliveryMethod('entrega')}
                        className={cn(
                          "px-4 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all flex flex-col items-center gap-2",
                          deliveryMethod === 'entrega'
                            ? "bg-white border-pink-400 text-pink-500 shadow-sm"
                            : "bg-white border-gray-100 text-gray-400"
                        )}
                      >
                        <Package size={16} /> Entregar
                      </button>
                      <button
                        type="button"
                        aria-pressed={deliveryMethod === 'retirada'}
                        onClick={() => setDeliveryMethod('retirada')}
                        className={cn(
                          "px-4 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all flex flex-col items-center gap-2",
                          deliveryMethod === 'retirada'
                            ? "bg-white border-pink-400 text-pink-500 shadow-sm"
                            : "bg-white border-gray-100 text-gray-400"
                        )}
                      >
                        <Settings size={16} /> Retirar na Loja
                      </button>
                    </div>
                  </div>

                  {/* Pagamento hospedado */}
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <label className="text-[10px] uppercase tracking-widest text-gray-400 block mb-3 font-black">Pagamento</label>
                    <div className="flex items-center gap-3 text-gray-900">
                      <div className="flex gap-2 text-pink-500">
                        <CreditCard size={18} />
                        <QrCode size={18} />
                      </div>
                      <div>
                        <p className="text-xs font-black uppercase tracking-widest">Checkout seguro PagBank</p>
                        <p className="text-[11px] text-gray-500 mt-1">Cartão, Pix ou boleto na próxima etapa.</p>
                      </div>
                    </div>
                  </div>

                  {/* Shipping Calculator */}
                  {deliveryMethod === 'entrega' && (
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                      <label htmlFor="shipping-cep" className="text-[10px] uppercase tracking-widest text-gray-400 block mb-2 font-black">Calcular frete</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          id="shipping-cep"
                          placeholder="00000000"
                          inputMode="numeric"
                          autoComplete="postal-code"
                          value={cep}
                          onChange={(e) => {
                            setCep(e.target.value.replace(/\D/g, '').slice(0, 8));
                            setShippingInfo(null);
                            setAddressStreet('');
                            setAddressNeighborhood('');
                            setAddressNumber('');
                            setAddressComplement('');
                          }}
                          className="flex-grow bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-pink-400"
                        />
                        <button
                          type="button"
                          onClick={calculateShipping}
                          disabled={isCalculating || cep.length !== 8}
                          className="bg-gray-900 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-pink-500 disabled:opacity-50 transition-colors"
                        >
                          {isCalculating ? '...' : 'OK'}
                        </button>
                      </div>
                      {shippingInfo && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="mt-3 text-[11px] text-gray-500"
                        >
                          <p className="mb-1">{shippingInfo.address}</p>
                          <div className="flex justify-between text-gray-900 font-bold">
                            <span>Frete</span>
                            <span className="text-pink-500">R$ {shippingInfo.price.toFixed(2)}</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                            <div className="sm:col-span-2">
                              <label htmlFor="shipping-street" className="text-[10px] uppercase tracking-widest text-gray-400 block mb-1 font-black">Rua</label>
                              <input
                                id="shipping-street"
                                type="text"
                                value={addressStreet}
                                onChange={event => setAddressStreet(event.target.value.slice(0, 160))}
                                autoComplete="address-line1"
                                placeholder="Rua ou avenida"
                                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-pink-400"
                              />
                            </div>
                            <div>
                              <label htmlFor="shipping-neighborhood" className="text-[10px] uppercase tracking-widest text-gray-400 block mb-1 font-black">Bairro</label>
                              <input
                                id="shipping-neighborhood"
                                type="text"
                                value={addressNeighborhood}
                                onChange={event => setAddressNeighborhood(event.target.value.slice(0, 60))}
                                autoComplete="address-level3"
                                placeholder="Bairro"
                                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-pink-400"
                              />
                            </div>
                            <div>
                              <label htmlFor="shipping-number" className="text-[10px] uppercase tracking-widest text-gray-400 block mb-1 font-black">Número</label>
                              <input
                                id="shipping-number"
                                type="text"
                                value={addressNumber}
                                onChange={event => setAddressNumber(event.target.value.slice(0, 20))}
                                autoComplete="address-line2"
                                placeholder="123"
                                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-pink-400"
                              />
                            </div>
                            <div>
                              <label htmlFor="shipping-complement" className="text-[10px] uppercase tracking-widest text-gray-400 block mb-1 font-black">Complemento</label>
                              <input
                                id="shipping-complement"
                                type="text"
                                value={addressComplement}
                                onChange={event => setAddressComplement(event.target.value.slice(0, 40))}
                                autoComplete="address-line3"
                                placeholder="Apto, bloco..."
                                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-pink-400"
                              />
                            </div>
                          </div>
                        </motion.div>
                      )}
                      {shippingError && <p role="alert" className="mt-3 text-[11px] font-semibold text-red-600">{shippingError}</p>}
                    </div>
                  )}

                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <label htmlFor="checkout-name" className="text-[10px] uppercase tracking-widest text-gray-400 block mb-2 font-black">Nome completo</label>
                    <input
                      id="checkout-name"
                      type="text"
                      placeholder="Seu nome completo"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value.slice(0, 100))}
                      autoComplete="name"
                      className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-pink-400 mb-4"
                    />
                    <label htmlFor="checkout-cpf" className="text-[10px] uppercase tracking-widest text-gray-400 block mb-2 font-black">CPF do pagador (obrigatório no PagBank)</label>
                    <input
                      id="checkout-cpf"
                      type="text"
                      placeholder="000.000.000-00"
                      inputMode="numeric"
                      value={cpf}
                      onChange={(e) => {
                        setCpf(formatCpf(e.target.value));
                      }}
                      className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-pink-400"
                    />
                    <label htmlFor="checkout-phone" className="text-[10px] uppercase tracking-widest text-gray-400 block mb-2 mt-4 font-black">Telefone para contato</label>
                    <input
                      id="checkout-phone"
                      type="tel"
                      placeholder="(11) 99999-9999"
                      inputMode="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={event => setPhone(formatBrazilianPhone(event.target.value))}
                      className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-pink-400"
                    />
                  </div>

                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 space-y-3">
                    <p className="text-[11px] leading-relaxed text-gray-600">
                      <strong className="text-gray-900">Prazo de produção:</strong>{' '}
                      {config.prazo_producao?.trim() || 'a confirmar com a GB Gráfica antes do pagamento'}.
                      O prazo de entrega é adicional.
                    </p>
                    <div className="flex items-start gap-3">
                      <input
                        id="checkout-legal-acceptance"
                        type="checkbox"
                        checked={acceptedLegalTerms}
                        onChange={event => setAcceptedLegalTerms(event.target.checked)}
                        aria-describedby="checkout-legal-documents"
                        className="mt-1 h-4 w-4 accent-pink-500"
                      />
                      <div id="checkout-legal-documents" className="text-[11px] leading-relaxed text-gray-600">
                        <label htmlFor="checkout-legal-acceptance" className="font-bold text-gray-900 cursor-pointer">
                          Li e aceito as condições da compra.
                        </label>{' '}
                        Consulte os{' '}
                        <Link to={LEGAL_ROUTES.terms} target="_blank" rel="noopener noreferrer" className="font-bold text-pink-600 hover:underline">Termos de Uso</Link>, a{' '}
                        <Link to={LEGAL_ROUTES.privacy} target="_blank" rel="noopener noreferrer" className="font-bold text-pink-600 hover:underline">Política de Privacidade</Link> e a{' '}
                        <Link to={LEGAL_ROUTES.exchanges} target="_blank" rel="noopener noreferrer" className="font-bold text-pink-600 hover:underline">Política de Trocas e Reembolsos</Link>.
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-sm text-gray-500">
                      <span>Subtotal</span>
                      <span>{formatMoney(subtotalCents / 100)}</span>
                    </div>
                    {deliveryMethod === 'entrega' && shippingInfo && (
                      <div className="flex justify-between items-center text-sm text-gray-500">
                        <span>Frete</span>
                        <span>R$ {shippingInfo.price.toFixed(2)}</span>
                      </div>
                    )}
                    {deliveryMethod === 'retirada' && (
                      <div className="flex justify-between items-center text-sm text-green-600 font-bold italic">
                        <span>Retirada na Gráfica</span>
                        <span>Grátis</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                      <span className="text-gray-500 font-medium">Total</span>
                      <span className="text-2xl font-black text-gray-900">
                        {formatMoney(totalCents / 100)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={checkout}
                    disabled={
                      isCheckingOut || isCalculating || hasInvalidCartPrice ||
                      (deliveryMethod === 'entrega' && (
                        !shippingInfo || !addressStreet.trim() || !addressNeighborhood.trim() || !addressNumber.trim()
                      )) ||
                      !isValidCpf(cpf) || !isValidBrazilianPhone(phone) ||
                      customerName.trim().split(/\s+/).filter(Boolean).length < 2 ||
                      !acceptedLegalTerms
                    }
                    className="w-full bg-gray-900 text-white font-black py-4 rounded-xl hover:bg-pink-500 transition-all shadow-xl shadow-gray-100 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isCheckingOut ? <><Loader2 className="animate-spin" size={18} /> REDIRECIONANDO...</> : "IR PARA O PAGBANK"}
                  </button>
                </div>

              </div>
            )}
          </Modal>
        )}

        {isOrdersOpen && (
          <Modal title="Meus Pedidos" onClose={() => setIsOrdersOpen(false)}>
            {!ordersReady ? (
              <div className="py-12 text-center text-gray-500" role="status"><Loader2 className="mx-auto mb-3 animate-spin text-pink-500" /> Carregando pedidos...</div>
            ) : ordersError ? (
              <div className="py-12 text-center text-red-600" role="alert">{ordersError}</div>
            ) : orders.length === 0 ? (
              <div className="py-12 text-center text-gray-500">Você ainda não possui pedidos.</div>
            ) : (
              <div className="space-y-6 pr-2">
                {orders.map((order) => (
                  <div key={order.id} className="bg-gray-50 p-6 rounded-2xl border border-gray-100 space-y-4">
                    <div className="flex justify-between items-center border-b border-gray-200 pb-4">
                      <div>
                        <div className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Pedido #{order.id}</div>
                        <div className="text-xs text-gray-500 mt-1 flex items-center gap-1"><Clock size={12} /> {formatOrderDate(order.data)}</div>
                        {order.metodoEntrega && (
                          <div className="text-[9px] text-pink-400 mt-1.5 font-black uppercase tracking-[0.1em] flex items-center gap-1.5">
                            {order.metodoEntrega === 'retirada' ? (
                              <><Settings size={10} className="stroke-[2.5px]" /> Retirada na Gráfica</>
                            ) : (
                              <><Package size={10} className="stroke-[2.5px]" /> Entrega</>
                            )}
                          </div>
                        )}
                        {order.metodoPagamento && (
                          <div className="text-[9px] text-gray-400 mt-1 font-black uppercase tracking-[0.1em] flex items-center gap-1.5">
                            {order.metodoPagamento === 'pagbank' ? (
                              <><CreditCard size={10} className="stroke-[2.5px]" /> PagBank: cartão, Pix ou boleto</>
                            ) : order.metodoPagamento === 'pix' ? (
                              <><QrCode size={10} className="stroke-[2.5px]" /> Pago via PIX</>
                            ) : (
                              <><CreditCard size={10} className="stroke-[2.5px]" /> Cartão / Boleto</>
                            )}
                          </div>
                        )}
                      </div>
                      <div className={cn('px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest', paymentStatusClass(order.paymentStatus))}>
                        {paymentStatusLabel(order)}
                      </div>
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-purple-600">
                      Produção: {fulfillmentStatusLabel(
                        order.fulfillmentStatus || legacyFulfillmentStatus(order.status, order.paymentStatus),
                      )}
                    </div>
                    <div className="space-y-2">
                      {order.itens.map((item) => (
                        <div key={item.id} className="text-xs space-y-1">
                          <div className="flex justify-between">
                            <span className="text-gray-600 font-medium">{item.quantidade}x {item.nome}</span>
                            <span className="text-gray-900 font-bold">{formatMoney(((parseMoneyToCents(item.preco) || 0) * item.quantidade) / 100)}</span>
                          </div>
                          {item.textoPersonalizado && (
                            <div className="text-[9px] text-pink-500 font-black uppercase tracking-wider">
                              Personalização: {item.textoPersonalizado}
                            </div>
                          )}
                          {item.arquivoPath && (
                            <button
                              type="button"
                              onClick={() => openOrderArtwork(order.id, item.id)}
                              className="text-[9px] text-green-600 flex items-center gap-1 font-black uppercase tracking-wider hover:underline"
                            >
                              <FileText size={10} /> Abrir arte enviada
                            </button>
                          )}
                          {item.artePendente && (
                            <div className="text-[9px] text-amber-600 flex items-center gap-1 font-black uppercase tracking-wider">
                              <Clock size={10} /> Arte será enviada depois
                            </div>
                          )}
                          {item.arquivoUrl && !item.arquivoPath && (
                            <div className="text-[9px] text-amber-600 flex items-center gap-1 font-black uppercase tracking-wider">
                              <AlertCircle size={10} /> Arte de pedido antigo: confirme pelo WhatsApp
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between items-center pt-4 border-t border-dashed border-gray-200">
                      <span className="text-sm font-black text-gray-900 uppercase tracking-widest">Total</span>
                      <span className="text-lg font-black text-pink-500">{formatMoney(order.total)}</span>
                    </div>
                    {order.paymentStatus !== 'pago' &&
                      trustedStoredPaymentLink(order.pagbankPayUrl) &&
                      (!order.checkoutExpiresAt || Date.parse(order.checkoutExpiresAt) > Date.now()) && (
                        <button
                          type="button"
                          onClick={() => window.location.assign(order.pagbankPayUrl!)}
                          className="w-full bg-gray-900 text-white py-3 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-pink-500 transition-colors"
                        >
                          Continuar pagamento
                        </button>
                      )}
                  </div>
                ))}
              </div>
            )}
          </Modal>
        )}

        {isHowToBuyOpen && (
          <Modal title="Como Comprar" onClose={() => setIsHowToBuyOpen(false)}>
            <div className="space-y-6 text-sm text-gray-600 leading-relaxed">
              <div className="space-y-2">
                <h4 className="font-black text-pink-500 flex items-center gap-2 uppercase tracking-widest text-xs">1. Escolha seu Produto</h4>
                <p>Navegue pelas categorias ou use a busca para encontrar o material gráfico que deseja.</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-black text-pink-500 flex items-center gap-2 uppercase tracking-widest text-xs">2. Configure as Opções</h4>
                <p>Selecione as variações como quantidade, tipo de papel e acabamento. O preço será atualizado automaticamente.</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-black text-pink-500 flex items-center gap-2 uppercase tracking-widest text-xs">3. Adicione ao Carrinho</h4>
                <p>Clique em "Adicionar ao Carrinho" para salvar sua escolha. Você pode continuar comprando ou finalizar o pedido.</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-black text-pink-500 flex items-center gap-2 uppercase tracking-widest text-xs">4. Finalize o Pedido</h4>
                <p>No carrinho, informe seus dados, escolha entrega ou retirada e siga para o checkout seguro do PagBank. A confirmação aparece automaticamente após o pagamento.</p>
              </div>
              <div className="pt-6 border-t border-gray-100 flex justify-center">
                <button
                  onClick={() => setIsHowToBuyOpen(false)}
                  className="bg-gray-900 text-white px-12 py-4 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-pink-500 transition-all shadow-xl shadow-gray-100"
                >
                  ENTENDI
                </button>
              </div>
            </div>
          </Modal>
        )}

      </AnimatePresence>

      {/* Floating Chat Button */}
      <motion.button
        type="button"
        aria-label="Falar com a GB Gráfica pelo WhatsApp"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => openExternal(`https://wa.me/${whatsappNumber(config.telefone1)}`)}
        className="fixed bottom-8 right-8 z-40 bg-[#25D366] text-white p-4 rounded-full shadow-2xl flex items-center justify-center group"
      >
        <Phone size={24} />
        <span className="max-w-0 overflow-hidden group-hover:max-w-xs group-hover:ml-2 transition-all duration-300 font-bold text-sm whitespace-nowrap">
          Falar no WhatsApp
        </span>
      </motion.button>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const titleId = React.useId();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable: HTMLElement[] = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter(element => !element.hasAttribute('hidden'));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.button
        type="button"
        aria-label={`Fechar ${title}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-white/60 backdrop-blur-sm"
      />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="relative bg-white border border-gray-100 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden"
      >
        <div className="px-5 sm:px-8 py-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <h3 id={titleId} className="text-xl font-black text-gray-900 tracking-tight">{title}</h3>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label={`Fechar ${title}`} className="text-gray-400 hover:text-pink-500 transition-colors">
            <X size={24} />
          </button>
        </div>
        <div className="p-5 sm:p-8 overflow-y-auto max-h-[calc(90vh-80px)] custom-scrollbar">
          {children}
        </div>
      </motion.div>
    </div>
  );
}

function BenefitItem({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center text-center group">
      <div className="text-3xl mb-4 transform group-hover:scale-125 transition-transform duration-300 drop-shadow-[0_0_15px_rgba(244,114,182,0.3)]">{icon}</div>
      <span className="font-black text-xs uppercase tracking-[0.2em] text-gray-900 mb-2">{title}</span>
      <span className="text-[10px] text-gray-400 font-medium max-w-[150px]">{desc}</span>
    </div>
  );
}

function PaymentLogo({ src, label, className }: { src: string; label: string; className: string }) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return <span className="text-[9px] font-black uppercase tracking-tight text-gray-600">{label}</span>;
  }

  return (
    <img
      src={src}
      alt={label}
      className={cn(className, 'object-contain')}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
    />
  );
}

function ProductCard({
  product,
  user,
  onRequireLogin,
  onAddToCart,
  onNotify,
}: {
  product: Anuncio;
  user: FirebaseUser | null;
  onRequireLogin: () => Promise<boolean>;
  onAddToCart: (item: CartItem) => void;
  onNotify: (notice: Notice) => void;
  key?: string;
}) {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [uploadedArtwork, setUploadedArtwork] = useState<UploadedArtwork | null>(null);
  const [sendArtworkLater, setSendArtworkLater] = useState(false);
  const [isUploadingArtwork, setIsUploadingArtwork] = useState(false);
  const [customText, setCustomText] = useState("");
  const [activeImage, setActiveImage] = useState(product.imagem);
  const customTextId = React.useId();

  const allImages = Array.from(new Set([product.imagem, ...(product.imagens || [])].filter(Boolean)));
  const attributeSignature = JSON.stringify(product.atributos);

  // Sincroniza a imagem ativa se o produto mudar (ex: edição no admin)
  React.useEffect(() => {
    setActiveImage(product.imagem);
  }, [product.imagem]);

  React.useEffect(() => {
    setSelections({});
  }, [product.id, attributeSignature]);

  const handleSelect = (attrName: string, option: string) => {
    const attributeIndex = product.atributos.findIndex(attribute => attribute.nome === attrName);
    setSelections(previous => {
      const nextSelections: Record<string, string> = {};
      product.atributos.slice(0, Math.max(attributeIndex, 0)).forEach(attribute => {
        if (previous[attribute.nome]) nextSelections[attribute.nome] = previous[attribute.nome];
      });
      nextSelections[attrName] = option;
      return nextSelections;
    });
  };

  const handleArtworkFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!user) {
      const loggedIn = await onRequireLogin();
      if (!loggedIn) return;
    }

    setIsUploadingArtwork(true);
    try {
      const nextArtwork = await uploadArtwork(file);
      const previousArtwork = uploadedArtwork;
      setUploadedArtwork(nextArtwork);
      setSendArtworkLater(false);
      if (previousArtwork) void removePendingArtwork(previousArtwork.path).catch(() => undefined);
      onNotify({ type: 'success', message: 'Arte enviada com segurança.' });
    } catch (error) {
      onNotify({
        type: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível enviar a arte.',
      });
    } finally {
      setIsUploadingArtwork(false);
    }
  };

  const removeArtwork = () => {
    if (uploadedArtwork) void removePendingArtwork(uploadedArtwork.path).catch(() => undefined);
    setUploadedArtwork(null);
  };

  const isFullySelected = product.atributos.every(attr => selections[attr.nome]);

  const currentPrice = () => {
    if (!isFullySelected) return null;
    if (product.atributos.length === 0) return product.preco_base;
    const key = product.atributos.map(attr => selections[attr.nome]).join('|');
    return product.combinacoes[key] || null;
  };

  const price = currentPrice();
  const priceCents = parseMoneyToCents(price);
  const customizationReady = product.tipoInput === 'arte'
    ? Boolean(uploadedArtwork || sendArtworkLater)
    : product.tipoInput === 'texto'
      ? Boolean(customText.trim())
      : true;

  const handleAdd = () => {
    if (!isFullySelected || !price || priceCents === null || priceCents <= 0) return;
    if (product.tipoInput === 'arte' && !uploadedArtwork && !sendArtworkLater) {
      onNotify({ type: 'error', message: 'Envie sua arte ou marque que enviará pelo WhatsApp depois.' });
      return;
    }

    const normalizedText = customText.trim();
    if (product.tipoInput === 'texto' && !normalizedText) {
      onNotify({ type: 'error', message: 'Informe o texto da personalização.' });
      return;
    }
    const artworkFingerprint = uploadedArtwork?.path || (sendArtworkLater ? 'send-later' : '');
    const cartId = createCartItemId(product.id, selections, normalizedText, artworkFingerprint);
    onAddToCart({
      id: cartId,
      productId: product.id,
      nome: product.nome,
      imagem: product.imagem,
      preco: (priceCents / 100).toFixed(2),
      selecoes: { ...selections },
      quantidade: 1,
      arquivoPath: uploadedArtwork?.path,
      arquivoNome: uploadedArtwork?.name,
      artePendente: product.tipoInput === 'arte' && sendArtworkLater,
      textoPersonalizado: normalizedText,
    });

    // Reset after adding
    setUploadedArtwork(null);
    setSendArtworkLater(false);
    setCustomText("");
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="bg-white/60 backdrop-blur-sm border border-gray-100 rounded-[2.5rem] p-8 flex flex-col lg:flex-row gap-10 hover:border-pink-200 transition-all group shadow-sm hover:shadow-md"
    >
      <div className="w-full lg:w-80 flex-shrink-0 flex flex-col gap-4">
        <div className="aspect-square bg-gray-50 rounded-2xl overflow-hidden border border-gray-100 relative group-hover:shadow-[0_0_30px_rgba(244,114,182,0.1)] transition-all">
          <img
            key={activeImage}
            src={activeImage}
            alt={product.nome}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={(e) => {
              const image = e.currentTarget;
              if (!image.dataset.fallbackApplied) {
                image.dataset.fallbackApplied = 'true';
                image.src = DEFAULT_LOGO_URL;
                image.classList.add('object-contain', 'p-8');
              }
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-pink-50/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
        </div>

        {allImages.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {allImages.map((img, idx) => (
              <button
                type="button"
                key={idx}
                onClick={() => setActiveImage(img)}
                aria-label={`Mostrar imagem ${idx + 1} de ${product.nome}`}
                aria-pressed={activeImage === img}
                className={cn(
                  "w-16 h-16 rounded-lg overflow-hidden border-2 flex-shrink-0 transition-all",
                  activeImage === img ? "border-pink-400 scale-105 shadow-md" : "border-transparent opacity-60 hover:opacity-100"
                )}
              >
                <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-grow flex flex-col">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-2xl font-black text-gray-900 tracking-tight">{product.nome}</h3>
          <div className="bg-pink-50 text-pink-500 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">Novo</div>
        </div>
        <p className="text-sm text-gray-500 mb-8 leading-relaxed max-w-2xl font-medium">{product.desc}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 mb-10">
          {product.atributos.map((attr, idx) => {
            const isEnabled = idx === 0 || product.atributos.slice(0, idx).every(a => selections[a.nome]);

            return (
              <div key={attr.nome} className={cn("flex flex-col transition-all", !isEnabled && "opacity-20 pointer-events-none grayscale")}>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4">{attr.nome}</span>
                <div className="flex flex-col gap-2">
                  {attr.opcoes.map(option => (
                    <button
                      type="button"
                      key={option}
                      onClick={() => handleSelect(attr.nome, option)}
                      aria-pressed={selections[attr.nome] === option}
                      className={cn(
                        "text-left px-4 py-3 rounded-xl border text-xs font-bold transition-all",
                        selections[attr.nome] === option
                          ? "bg-gradient-to-r from-pink-400 to-purple-500 border-transparent text-white shadow-lg shadow-pink-100"
                          : "bg-gray-50 border-gray-100 text-gray-500 hover:border-pink-200 hover:text-pink-600"
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Personalization Section */}
          <div className="flex flex-col gap-8">
            {product.tipoInput === 'arte' && (
              <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4">Sua arte</span>
                {uploadedArtwork ? (
                  <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-xs text-green-800">
                    <div className="flex items-center gap-2 font-bold">
                      <FileText size={16} />
                      <span className="min-w-0 truncate">{uploadedArtwork.name}</span>
                    </div>
                    <button type="button" onClick={removeArtwork} className="mt-2 text-[10px] font-black uppercase tracking-widest text-red-600 hover:underline">
                      Remover arquivo
                    </button>
                  </div>
                ) : (
                  <label className={cn(
                    "flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-4 text-xs font-bold transition-colors",
                    isUploadingArtwork
                      ? "cursor-wait border-gray-200 bg-gray-100 text-gray-400"
                      : "border-pink-200 bg-pink-50 text-pink-600 hover:border-pink-400",
                  )}>
                    {isUploadingArtwork ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                    {isUploadingArtwork ? 'Enviando...' : 'Selecionar arquivo'}
                    <input
                      type="file"
                      accept="application/pdf,image/png,image/jpeg,image/webp"
                      onChange={handleArtworkFile}
                      disabled={isUploadingArtwork}
                      className="sr-only"
                    />
                  </label>
                )}
                <p className="mt-2 text-[9px] text-gray-400 leading-tight">PDF, PNG, JPG ou WebP, até 15 MB. O arquivo fica privado e vinculado ao pedido.</p>
                <label className="mt-3 flex items-start gap-2 text-[10px] text-gray-500">
                  <input
                    type="checkbox"
                    checked={sendArtworkLater}
                    onChange={event => {
                      const checked = event.target.checked;
                      setSendArtworkLater(checked);
                      if (checked) removeArtwork();
                    }}
                    className="mt-0.5"
                  />
                  Vou enviar a arte pelo WhatsApp após a compra
                </label>
              </div>
            )}

            {product.tipoInput === 'texto' && (
              <div className="flex flex-col">
                <label htmlFor={customTextId} className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4">{product.labelTexto || "Personalização"}</label>
                <input
                  id={customTextId}
                  type="text"
                  value={customText}
                  onChange={e => setCustomText(e.target.value)}
                  maxLength={500}
                  placeholder="Ex: Nome do bebê, data..."
                  className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-4 text-xs outline-none focus:border-pink-400 text-gray-900 transition-all"
                />
              </div>
            )}
          </div>
        </div>

        <div className="mt-auto pt-8 border-t border-gray-100 flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row justify-between items-end sm:items-center gap-6">
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Preço</span>
              <div className="text-3xl font-black text-gray-900">
                {price && priceCents !== null && priceCents > 0 ? (
                  <span className="flex items-center gap-1">
                    <span className="text-sm font-normal text-gray-400">R$</span> {formatMoney(price).replace(/^R\$\s*/, '')}
                  </span>
                ) : (
                  <span className="text-sm text-pink-500 font-bold uppercase tracking-widest animate-pulse">
                    {isFullySelected ? 'Preço não configurado' : (product.preco_base || 'Selecione as opções')}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 bg-gray-50/50 p-1.5 rounded-2xl border border-gray-100">
              <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest px-2">Compartilhar</span>
              <button
                type="button"
                onClick={() => {
                  const text = `Confira esse produto: ${product.nome} - ${window.location.origin}`;
                  openExternal(`https://wa.me/?text=${encodeURIComponent(text)}`);
                }}
                className="p-2 text-green-500 hover:scale-110 transition-transform"
                title="WhatsApp"
                aria-label={`Compartilhar ${product.nome} no WhatsApp`}
              >
                <MessageCircle size={16} />
              </button>
              <button
                type="button"
                onClick={() => {
                  const url = window.location.href;
                  openExternal(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`);
                }}
                className="p-2 text-blue-600 hover:scale-110 transition-transform"
                title="Facebook"
                aria-label={`Compartilhar ${product.nome} no Facebook`}
              >
                <Facebook size={16} />
              </button>
              <button
                type="button"
                onClick={() => {
                  const url = window.location.href;
                  const text = `Confira esse produto: ${product.nome}`;
                  openExternal(`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
                }}
                className="p-2 text-sky-500 hover:scale-110 transition-transform"
                title="Twitter"
                aria-label={`Compartilhar ${product.nome} no Twitter`}
              >
                <Twitter size={16} />
              </button>
              <button
                type="button"
                onClick={async () => {
                  const url = window.location.href;
                  try {
                    await navigator.clipboard.writeText(url);
                    onNotify({ type: 'success', message: 'Link do produto copiado.' });
                  } catch {
                    onNotify({ type: 'error', message: 'Não foi possível copiar o link neste navegador.' });
                  }
                }}
                className="p-2 text-gray-400 hover:text-pink-500 transition-all"
                title="Copiar Link"
                aria-label={`Copiar link de ${product.nome}`}
              >
                <Share2 size={16} />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={handleAdd}
            disabled={!isFullySelected || priceCents === null || priceCents <= 0 || !customizationReady || isUploadingArtwork}
            className={cn(
              "w-full flex items-center justify-center gap-3 px-10 py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all",
              isFullySelected && priceCents !== null && priceCents > 0 && customizationReady && !isUploadingArtwork
                ? "bg-gray-900 text-white hover:bg-[#d14d8c] shadow-xl hover:shadow-pink-100 active:scale-95 cursor-pointer"
                : "bg-gray-100 text-gray-400 cursor-not-allowed opacity-60"
            )}
          >
            <ShoppingCart size={18} />
            Adicionar ao Carrinho
          </button>
        </div>
      </div>
    </motion.article>
  );
}
