import { optionReferenceImage } from '../lib/productSales';
import { quoteCoupon } from '../services/salesService';
import { COUPON_CODE_MAX_LENGTH, type AppliedCoupon } from '../lib/salesCoupons';
import CatalogProductCard from '../components/CatalogProductCard';
import BundleConfigurator from '../components/BundleConfigurator';
import CustomerProfile from '../components/CustomerProfile';
import ProductReviews from '../components/ProductReviews';
import ShareLinks from '../components/ShareLinks';
import { customerApi as defaultCustomerApi, type CustomerApi } from '../services/customerService';
import { type CustomerProfile as Profile } from '../lib/customerProfile';
import { filterCatalog, type CatalogSection, type ProductRating } from '../lib/catalog';
import { cartShippingItems, orderItems } from '../lib/bundles';
import EmailPreferences from '../components/EmailPreferences';
import type { EmailApi } from '../services/emailService';
import { initialReference } from '../lib/decorativeInitial';
import OrderDocuments from '../components/OrderDocuments';
import UploadInput from '../components/UploadInput';
import { contactHref, featuredProducts, storeBenefits, storeContacts } from '../lib/storePresentation';
import ProductPdfEditor from '../components/ProductPdfEditor';
import { productCustomization, productPrice, resolveProductProduction } from '../lib/productCustomization';
import React, { useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { StoreThemeControl } from '../components/StoreTheme';
import { variantImage } from '../lib/variantImage';
import { Search, ShoppingCart, Phone, Settings, CheckCircle2, ChevronRight, X, Trash2, Package, Clock, LogIn, LogOut, Loader2, Share2, Facebook, Twitter, MessageCircle, CreditCard, QrCode, Mail, Sparkles, AlertCircle, Upload, FileText, Pause, Play } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Anuncio, SiteConfig, CartItem, Order, Category, Promocao, type PersonalizationFont } from '../types';
import { cn } from '../lib/utils';
import { loginWithGoogle, logout, FirebaseUser } from '../firebase';
import { createCartItemId, formatBrazilianPhone, formatCpf, formatMoney, isHttpUrl, isValidBrazilianPhone, isValidCpf, parseMoneyToCents } from '../lib/commerce';
import { fulfillmentStatusLabel, legacyFulfillmentStatus } from '../lib/orderStatus';
import {
  removePendingArtwork,
  readPendingPersonalizationModel,
  uploadArtwork,
  uploadPersonalizationModel,
  type UploadedArtwork,
} from '../services/artworkService';
import { currentLegalAcceptance, LEGAL_ROUTES } from '../lib/legal';
import { checkoutIssues, type CheckoutIssue, validateCheckoutForm } from '../lib/checkoutForm';
import {
  createHostedCheckout,
  isTrustedPagBankPaymentUrl,
  refreshHostedPaymentStatus,
  CheckoutApiError,
} from '../services/checkoutService';
import { buildStoreStructuredData, DEFAULT_LOGO_URL, resolvePublicImage, usePageMetadata, useStructuredData } from '../lib/seo';
import TextCustomizationDrawer, { type BackCoverDraft } from '../components/TextCustomizationDrawer';
import { parsePrintProfile, printProfileKey, printProfileLabel } from '../lib/printProfile';
import PersonalizationViewer from '../components/PersonalizationViewer';
import type { PersonalizationDocument } from '../services/personalizationExport';
import { loadOrderPersonalizationDocument } from '../services/personalizationDocumentService';
import {
  activePersonalizationFonts,
  productRequiresArtwork,
  productRequiresText,
  textCustomizationFingerprint,
  textCustomizationFontLabel,
  type TextCustomization,
} from '../lib/textCustomization';
import { formattedDiscountPercentage, promotionalPrice, promotionActiveAt } from '../lib/promotions';
import { repriceCart } from '../lib/cartPricing';
import FlashOffers from '../components/FlashOffers';
import CustomerOrderDetails from '../components/CustomerOrderDetails';
import {
  isComposablePersonalizationImage,
  personalizationModelName,
} from '../lib/personalizationModel';
import type { ComposedPersonalizationModel } from '../services/personalizationModelService';
import { requestShippingQuote } from '../services/shippingService';
import type { ShippingQuoteResponse } from '../lib/shipping';

type Notice = { type: 'success' | 'error' | 'info'; message: string };

interface HomeSlide {
  branding?: boolean;
  productId?: string;
  subtitle?: string;
  image?: string;
  title?: string;
  link: string;
  targetType?: Promocao['alvoTipo'];
  targetName?: string;
}

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

interface ShippingInfo extends ShippingQuoteResponse {
  price: number;
  context: string;
  selectedCode: string;
}

export interface PersonalizationModelStorage {
  uploadModel: (model: ComposedPersonalizationModel, name: string) => Promise<UploadedArtwork>;
  deleteModel: (path: string) => Promise<void>;
  readModel: (path: string) => Promise<Blob>;
  uploadArtwork: (file: File) => Promise<UploadedArtwork>;
}

const FIREBASE_PERSONALIZATION_MODEL_STORAGE: PersonalizationModelStorage = {
  uploadModel: (model, name) => uploadPersonalizationModel(model.blob, name),
  deleteModel: removePendingArtwork,
  readModel: readPendingPersonalizationModel,
  uploadArtwork,
};

interface HomeProps {
  emailApi?: EmailApi;
  customerApi?: CustomerApi;
  products: Anuncio[];
  config: SiteConfig;
  categories: Category[];
  promotions: Promocao[];
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  orders: Order[];
  user: FirebaseUser | null;
  canAccessPanel: boolean;
  panelAccessNeedsCheck?: boolean;
  productsReady: boolean;
  productsError: string | null;
  ordersReady: boolean;
  ordersError: string | null;
  onCheckoutRedirect?: (url: string) => void;
  personalizationModelStorage?: PersonalizationModelStorage;
  orderModelLoader?: typeof loadOrderPersonalizationDocument;
}

export default function Home({ emailApi, customerApi = defaultCustomerApi,
  products,
  config,
  categories,
  promotions,
  cart,
  setCart,
  orders,
  user,
  canAccessPanel,
  panelAccessNeedsCheck = false,
  productsReady,
  productsError,
  ordersReady,
  ordersError,
  onCheckoutRedirect,
  personalizationModelStorage = FIREBASE_PERSONALIZATION_MODEL_STORAGE,
  orderModelLoader = loadOrderPersonalizationDocument,
}: HomeProps) {
  const [modelDocument, setModelDocument] = useState<PersonalizationDocument | null>(null);
  const viewerRequest = useRef(0);
  React.useEffect(() => {
    setModelDocument(null);
    return () => { viewerRequest.current += 1; };
  }, [user?.uid]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [couponRefresh, setCouponRefresh] = useState(0);
  const [couponQuote, setCouponQuote] = useState<{ key: string; coupon: AppliedCoupon | null; error?: string }>();
  const couponItems = JSON.stringify(cart.map(function quoteItem(item): unknown {
    return {
      productId: item.productId, selecoes: item.selecoes, quantidade: item.quantidade,
      expectedUnitAmountCents: parseMoneyToCents(item.preco),
      ...(item.bundleItems ? { bundleRevision: item.bundleRevision, bundleItems: item.bundleItems.map(quoteItem) } : {}),
    };
  }));
  const couponKey = JSON.stringify([user?.uid, couponCode, couponItems, couponRefresh]);
  const currentCouponQuote = couponQuote?.key === couponKey ? couponQuote : undefined;
  const appliedCoupon = currentCouponQuote?.coupon;
  const awaitingCoupon = Boolean(user && cart.length && !currentCouponQuote);
  React.useEffect(() => {
    setCouponInput('');
    setCouponCode('');
    setCouponQuote(undefined);
  }, [user?.uid]);
  React.useEffect(() => {
    if (!isCartOpen || !user || couponItems === '[]') return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void user.getIdToken().then(token => quoteCoupon(token, JSON.parse(couponItems), couponCode, controller.signal))
        .then(result => {
          if (!controller.signal.aborted) setCouponQuote({ key: couponKey, coupon: result.coupon });
        }).catch(error => {
          if (!controller.signal.aborted) setCouponQuote({ key: couponKey, coupon: null, error: error.message });
        });
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [isCartOpen, user, couponKey, couponItems, couponCode]);
  const [isEmailPreferencesOpen, setIsEmailPreferencesOpen] = useState(false);
  React.useEffect(() => setIsEmailPreferencesOpen(false), [user?.uid]);
  const [isOrdersOpen, setIsOrdersOpen] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const detailOrder = user && !ordersError ? orders.find(order => order.id === detailOrderId) : undefined;
  const [isHowToBuyOpen, setIsHowToBuyOpen] = useState(false);
  const [cep, setCep] = useState('');
  const [storedShippingInfo, setShippingInfo] = useState<ShippingInfo | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState<'retirada' | 'entrega'>('entrega');
  const [customerName, setCustomerName] = useState('');
  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState('');
  const checkoutDraftEdited = useRef(false);
  const [orderNotes, setOrderNotes] = useState('');
  const [addressStreet, setAddressStreet] = useState('');
  const [addressNeighborhood, setAddressNeighborhood] = useState('');
  const [addressNumber, setAddressNumber] = useState('');
  const [addressComplement, setAddressComplement] = useState('');
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isCarouselPaused, setIsCarouselPaused] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();
  const { categoryId, productId } = useParams();
  const location = useLocation();
  const customerPreview = new URLSearchParams(location.search).get('preview') === 'customer';
  const query = new URLSearchParams(location.search);
  const section = (['destaques','promocoes','lancamentos','pacotes'].includes(location.pathname.slice(1)) ? location.pathname.slice(1) : 'todos') as CatalogSection;
  const sectionTitles = { todos: 'Todos os produtos', destaques: 'Produtos em destaque', promocoes: 'Produtos em promoção', lancamentos: 'Lançamentos', pacotes: 'Pacotes de produtos' };
  const isProfile = location.pathname === '/minha-conta';
  const focusedPage = !!productId || isProfile;
  const detailProduct = products.find(p => p.id === productId);
  const routeCategory = categories.find(category => category.id === (categoryId || query.get('categoria')));
  const [ratings, setRatings] = useState<Record<string,ProductRating>>({});
  const [ratingsError, setRatingsError] = useState('');
  React.useEffect(()=>{ let active=true; void customerApi.ratings().then(rows=>{if(active) {setRatings(rows);setRatingsError('');}}).catch(()=>{if(active) setRatingsError('As avaliações estão indisponíveis no momento.');});return()=>{active=false;};},[customerApi]);
  React.useEffect(()=>{setSearchTerm(new URLSearchParams(location.search).get('q') || '');},[location.search]);
  const applyFilters = (changes: Record<string,string>) => { const next=new URLSearchParams(location.search); Object.entries(changes).forEach(([key,value])=>value?next.set(key,value):next.delete(key)); navigate(`${focusedPage ? '/' : location.pathname}${next.size ? '?'+next.toString() : ''}`); };
  const fillProfile = (profile: Profile) => { setCustomerName(profile.fullName || user?.displayName || ''); setPhone(profile.phone);setCpf(profile.cpf);setCep(profile.cep);setAddressStreet(profile.street);setAddressNumber(profile.number);setAddressComplement(profile.complement);setAddressNeighborhood(profile.neighborhood); };
  React.useEffect(()=>{ let active=true; checkoutDraftEdited.current=false; setCustomerName(user?.displayName || '');setPhone('');setCpf('');setCep('');setAddressStreet('');setAddressNumber('');setAddressComplement('');setAddressNeighborhood(''); if(user) void customerApi.profile().then(profile=>{if(active && !checkoutDraftEdited.current) fillProfile(profile);}).catch(()=>undefined);return()=>{active=false;}; },[user?.uid,customerApi]);
  const activeCategory = routeCategory?.nome || null;
  const [shippingError, setShippingError] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [acceptedLegalTerms, setAcceptedLegalTerms] = useState(false);
  const [checkoutErrors, setCheckoutErrors] = useState<CheckoutIssue[]>([]);
  React.useEffect(() => setCheckoutErrors([]), [customerName, cpf, phone, cep, addressStreet, addressNeighborhood, addressNumber, acceptedLegalTerms, deliveryMethod]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pagbankReturnOrderId, setPagbankReturnOrderId] = useState<string | null>(null);
  const checkoutLock = useRef(false);
  const shippingAbort = useRef<AbortController | null>(null);
  const shippingSequence = useRef(0);
  const shippingContext = JSON.stringify([deliveryMethod, cep, cart.map(item => [
    item.productId, item.quantidade, item.bundleRevision, item.bundleItems?.map(c=>[c.productId,c.quantidade,c.selecoes]), Object.entries(item.selecoes).sort(([a], [b]) => a.localeCompare(b)),
  ])]);
  const currentShippingContext = useRef(shippingContext);
  currentShippingContext.current = shippingContext;
  const shippingInfo = storedShippingInfo?.context === shippingContext && Date.parse(storedShippingInfo.expires_at) > Date.now()
    ? storedShippingInfo : null;
  const shouldReduceMotion = useReducedMotion();

  const [promotionNow, setPromotionNow] = useState(Date.now);
  React.useEffect(() => {
    setPromotionNow(Date.now());
    if (!promotions.some(promotion => promotion.ativa && promotion.endsAt)) return;
    const timer = window.setInterval(() => setPromotionNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [promotions]);
  const contacts = storeContacts(config);
  const benefits = storeBenefits(config);
  const primaryContact = contacts.find(contact => contact.type === 'whatsapp') || contacts[0];
  const storeStructuredData = useMemo(() => buildStoreStructuredData(config), [config]);
  usePageMetadata({
    title: `${detailProduct?.nome || (isProfile ? 'Minha conta' : routeCategory?.nome || sectionTitles[section])} | GB Gráfica`,
    description: config.banner_subtitulo || 'Produtos gráficos e personalizados da GB Gráfica, com pagamento seguro pelo PagBank.',
    path: location.pathname,
    noIndex: isProfile,
    image: detailProduct?.imagem || config.banner_principal || config.logo_url,
  });
  useStructuredData('gb-store-structured-data', storeStructuredData);

  const slides = useMemo<HomeSlide[]>(() => {
    const highlighted = featuredProducts(products).map(product => ({ productId: product.id, image: product.imagem, title: product.nome, subtitle: product.desc, link: '' }));
    const availableSlides: HomeSlide[] = [
      { branding: true, image: config.banner_principal, title: config.banner_titulo, subtitle: config.banner_subtitulo, link: '' },
      ...highlighted,
      ...promotions.filter(promotion => promotionActiveAt(promotion, promotionNow)).map(promotion => ({
        image: promotion.imagem,
        title: promotion.titulo,
        link: promotion.link || '',
        targetType: promotion.alvoTipo,
        targetName: promotion.alvoNome,
      })),
    ].filter(slide => Boolean(slide.image?.trim()));

    return availableSlides.length > 0
      ? availableSlides
      : [{ image: DEFAULT_LOGO_URL, title: config.banner_titulo, link: '' }];
  }, [config.banner_principal, config.banner_titulo, config.banner_subtitulo, promotions, products, promotionNow]);

  const visibleProducts = useMemo(() => ((categoryId || query.get('categoria')) && !routeCategory) ? [] : filterCatalog(products, promotions, ratings, { section, category: routeCategory?.nome, query: searchTerm, min: query.get('min') ? parseMoneyToCents(query.get('min')) ?? undefined : undefined, max: query.get('max') ? parseMoneyToCents(query.get('max')) ?? undefined : undefined, rating: Number(query.get('avaliacao')) || undefined }, promotionNow), [products,promotions,ratings,section,routeCategory,categoryId,searchTerm,location.search,promotionNow]);

  const subtotalCents = useMemo(() => cart.reduce((total, item) => {
    const unitAmount = parseMoneyToCents(item.preco);
    return unitAmount === null ? total : total + unitAmount * item.quantidade;
  }, 0), [cart]);
  const hasInvalidCartPrice = cart.some(item => parseMoneyToCents(item.preco) === null || (item.bundleItems && products.find(p=>p.id===item.productId)?.pacote?.revision !== item.bundleRevision));
  const totalCents = subtotalCents - (appliedCoupon?.discountCents || 0) + (deliveryMethod === 'entrega' ? Math.round((shippingInfo?.price || 0) * 100) : 0);

  React.useEffect(() => {
    shippingSequence.current += 1;
    shippingAbort.current?.abort();
    setShippingInfo(null);
    setShippingError(null);
    setIsCalculating(false);
    return () => { shippingSequence.current += 1; shippingAbort.current?.abort(); };
  }, [shippingContext]);

  React.useEffect(() => {
    if (!storedShippingInfo) return;
    const timer = window.setTimeout(() => setShippingInfo(null), Math.max(0, Date.parse(storedShippingInfo.expires_at) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [storedShippingInfo]);

  React.useEffect(() => {
    setCart(current => repriceCart(current, products, promotions, promotionNow));
  }, [products, promotions, promotionNow, setCart]);

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
    if (cep.length !== 8 || !cart.length) return;
    shippingAbort.current?.abort();
    const controller = new AbortController();
    shippingAbort.current = controller;
    const sequence = ++shippingSequence.current;
    const context = shippingContext;
    setIsCalculating(true);
    setShippingError(null);
    setShippingInfo(null);
    try {
      const data = await requestShippingQuote(cep, cart, controller.signal);
      if (sequence !== shippingSequence.current || currentShippingContext.current !== context) return;
      setShippingInfo({
        ...data, context, selectedCode: data.options[0].service_code, price: data.options[0].amount_cents / 100,
      });
      setAddressStreet(data.street);
      setAddressNeighborhood(data.neighborhood);
    } catch (error) {
      if (sequence !== shippingSequence.current || controller.signal.aborted || currentShippingContext.current !== context) return;
      setShippingInfo(null);
      setShippingError(error instanceof Error ? error.message : 'Não foi possível calcular o frete.');
    } finally {
      if (sequence === shippingSequence.current) setIsCalculating(false);
    }
  };

  const addToCart = (item: CartItem) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) {
        return prev.map(i => i.id === item.id ? { ...i, quantidade: i.bundleItems ? Math.min(i.bundleQuantityAllowed ? 20 : 1, i.quantidade + 1) : Math.min(99,i.quantidade + 1) } : i);
      }
      return [...prev, item];
    });
    setNotice({ type: 'success', message: 'Adicionado ao carrinho.' });
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const limit = item.bundleItems ? (item.bundleQuantityAllowed ? Math.min(20,...item.bundleItems.map(c=>Math.floor(99/c.quantidade))) : 1) : 99;
        const newQty = Math.min(limit, Math.max(1, item.quantidade + delta));
        return { ...item, quantidade: newQty };
      }
      return item;
    }));
  };

  const removeFromCart = (id: string) => {
    const item = cart.find(candidate => candidate.id === id);
    setCart(prev => prev.filter(i => i.id !== id));
    const pendingPaths = (item ? cartShippingItems([item]) : []).flatMap(c => [c.arquivoPath,c.modeloPath,c.contracapaPath,c.contracapaOriginalPath,c.imagemClientePath,...(c.paginasModelo||[])])
      .filter((path): path is string => Boolean(path?.includes('/pending/')));
    void Promise.allSettled(pendingPaths.map(path => personalizationModelStorage.deleteModel(path))).then(results => {
      if (results.some(result => result.status === 'rejected')) {
        console.error('Não foi possível remover todos os arquivos temporários do item.');
      }
    });
  };

  const openOrderModel = async (orderId: string, itemId: string) => {
    try {
      const item = orderItems(orders.find(order => order.id === orderId)?.itens || []).find(item => item.id === itemId);
      if (!item) throw new Error('Item do pedido não encontrado.');
      const request = ++viewerRequest.current;
      const model = await orderModelLoader(orderId, item);
      if (request === viewerRequest.current) setModelDocument(model);
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível abrir o modelo personalizado.',
      });
    }
  };

  const openCartModel = async (item: CartItem) => {
    if (!item.modeloPath) return;
    const request = ++viewerRequest.current;
    try {
      const front = await personalizationModelStorage.readModel(item.modeloPath);
      const back = item.contracapaPath ? await personalizationModelStorage.readModel(item.contracapaPath) : null;
      const extras=await Promise.all((item.paginasModelo||[]).map(async(path,i)=>({label:`Página ${i+3}` as const,blob:await personalizationModelStorage.readModel(path)})));
      if (request === viewerRequest.current) setModelDocument({ title: item.nome, ...(item.printProfile ? { printProfile: item.printProfile } : {}), pages: [
        { label: 'Capa', blob: front }, ...(back ? [{ label: 'Contracapa' as const, blob: back }] : []),...extras,
      ] });
    } catch (error) { setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Não foi possível carregar o modelo.' }); }
  };

  const scrollToProducts = () => {
    document.getElementById('produtos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const selectCategory = (category: string | null) => {
    const target = categories.find(item => item.nome === category);
    const next = new URLSearchParams(location.search); next.delete('categoria'); if(target && section !== 'todos') next.set('categoria',target.id); navigate(`${section === 'todos' ? target ? `/categoria/${encodeURIComponent(target.id)}` : '/' : '/'+section}${next.size?'?'+next.toString():''}`);
    window.requestAnimationFrame(scrollToProducts);
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    applyFilters({ q: searchTerm });
    scrollToProducts();
  };

  const checkout = async () => {
    if (checkoutLock.current || isCheckingOut || cart.length === 0) return;
    if (cartShippingItems(cart).some(item => item.modeloPath && item.aprovarArte !== true)) {
      setNotice({ type: 'error', message: 'Confira e aprove a arte de cada item personalizado antes de continuar.' });
      return;
    }
    if (!user) {
      setNotice({ type: 'info', message: 'Faça login para finalizar o pedido.' });
      await handleLogin();
      return;
    }
    const formInput = {
      acceptedLegalTerms,
      customerName,
      cpf,
      phone,
      deliveryMethod,
      hasShippingQuote: Boolean(shippingInfo && Date.parse(shippingInfo.expires_at) > Date.now()),
      addressStreet,
      addressNeighborhood,
      addressNumber,
      hasInvalidCartPrice,
    };
    const issues = checkoutIssues(formInput);
    setCheckoutErrors(issues);
    if (issues.length) { document.getElementById(issues[0].field)?.focus(); return; }
    const formResult = validateCheckoutForm(formInput);
    if (formResult.ok === false) {
      setNotice({ type: 'error', message: formResult.message });
      return;
    }

    if (!currentCouponQuote || currentCouponQuote.error) return;

    checkoutLock.current = true;
    setIsCheckingOut(true);

    try {
      const idToken = await user.getIdToken();
      const checkoutResult = await createHostedCheckout({
        items: cart.map(function serializeItem(item): any { return ({
          ...(item.bundleItems ? { bundleItems: item.bundleItems.map(serializeItem), bundleRevision: item.bundleRevision } : {}),
          productId: item.productId,
          ...(item.templateId ? { templateId: item.templateId } : {}),
          paginasModelo:item.paginasModelo,
          moldeRevisao:item.moldeRevisao, textoMolde:item.textoMolde, imagemClientePath:item.imagemClientePath,
          imagemBaseReferencia: item.imagemBaseReferencia,
          expectedUnitAmountCents: parseMoneyToCents(item.preco),
          quantidade: item.quantidade,
          selecoes: item.selecoes,
          arquivoPath: item.arquivoPath || '',
          arquivoNome: item.arquivoNome || '',
          modeloPath: item.modeloPath || '',
          modeloNome: item.modeloNome || '',
          contracapaPath: item.contracapaPath || '',
          contracapaOriginalPath: item.contracapaOriginalPath || '',
          contracapaNome: item.contracapaNome || '',
          ...(item.contracapaModo ? { contracapaModo: item.contracapaModo } : {}),
          textoPersonalizado: item.textoPersonalizado || '',
          personalizacaoTexto: item.personalizacaoTexto,
          inicialReferencia: item.inicialReferencia,
          ...(item.printProfile ? { printProfile: item.printProfile } : {}),
          ...(item.modeloPath ? { aprovarArte: item.aprovarArte === true } : {}),
        }); }),
        requestId: crypto.randomUUID(),
        ...(couponCode ? { couponCode } : {}),
        expectedCouponCents: appliedCoupon?.discountCents ?? 0,
        expectedCouponCode: appliedCoupon?.code ?? null,
        customerName: formResult.customerName,
        observacoes: orderNotes,
        cpf: formResult.cpf,
        phone: formResult.phone,
        deliveryMethod,
        shippingServiceCode: deliveryMethod === 'entrega' ? shippingInfo?.selectedCode : undefined,
        shippingAmountCents: deliveryMethod === 'entrega' ? Math.round((shippingInfo?.price || 0) * 100) : undefined,
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
      setCouponCode('');
      setCouponInput('');
      setIsCartOpen(false);
      if (onCheckoutRedirect) onCheckoutRedirect(checkoutResult.initPoint);
      else window.location.assign(checkoutResult.initPoint);
    } catch (error: unknown) {
      if (error instanceof CheckoutApiError && error.code?.startsWith('SHIPPING_')) setShippingInfo(null);
      if (error instanceof CheckoutApiError && error.code?.startsWith('COUPON_')) setCouponRefresh(value => value + 1);
      if (error instanceof CheckoutApiError && error.code === 'PRICE_CHANGED') {
        setCart(current => repriceCart(current, products, promotions, Date.now()));
      }
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

    if (pagbankReturn && orderId && /^GB-[A-Z0-9]{8,64}$/.test(orderId)) {
      setCart([]);
      setIsOrdersOpen(true);
      setPagbankReturnOrderId(orderId);
      localStorage.removeItem('gb_pending_order');
      setNotice({ type: 'info', message: 'Retorno recebido. Confirmando o pagamento com o PagBank...' });
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  React.useEffect(() => {
    if (!user || !pagbankReturnOrderId) return;
    let cancelled = false;

    const refreshPayment = async () => {
      try {
        const idToken = await user.getIdToken();
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const result = await refreshHostedPaymentStatus(pagbankReturnOrderId, idToken);
          if (cancelled) return;

          if (result.status === 'pago') {
            setNotice({ type: 'success', message: 'Pagamento confirmado. Seu pedido já foi liberado para produção.' });
            setPagbankReturnOrderId(null);
            return;
          }
          if (['recusado', 'cancelado', 'expirado', 'erro'].includes(result.status)) {
            setNotice({ type: 'error', message: 'O pagamento não foi concluído. Consulte o pedido para tentar novamente.' });
            setPagbankReturnOrderId(null);
            return;
          }
          if (attempt < 3) {
            await new Promise(resolve => window.setTimeout(resolve, 3_000));
          }
        }

        if (!cancelled) {
          setNotice({
            type: 'info',
            message: 'O pagamento ainda está sendo processado. O status será atualizado em Meus Pedidos.',
          });
          setPagbankReturnOrderId(null);
        }
      } catch (error) {
        console.error('Payment status refresh error:', error);
        if (!cancelled) {
          setNotice({
            type: 'info',
            message: 'Retorno recebido. A confirmação ainda pode levar alguns instantes; acompanhe em Meus Pedidos.',
          });
          setPagbankReturnOrderId(null);
        }
      }
    };

    void refreshPayment();
    return () => {
      cancelled = true;
    };
  }, [pagbankReturnOrderId, user]);

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
    const pendingArtworks = cartShippingItems(cart)
      .flatMap(item => [item.arquivoPath, item.modeloPath, item.contracapaPath, item.contracapaOriginalPath])
      .filter((path): path is string => Boolean(path?.includes('/pending/')));
    await Promise.allSettled(pendingArtworks.map(path=>personalizationModelStorage.deleteModel(path)));
    setCart([]);
    localStorage.removeItem('gb_pending_order');
    await logout();
  };

  const activeSlide = slides[currentSlide] || slides[0];
  const imageOnlyBanner = activeSlide.branding && !activeSlide.title?.trim() && !activeSlide.subtitle?.trim() && !config.banner_botao?.trim();
  const handleBannerAction = () => {
    if (activeSlide.productId) {
      navigate(`/produto/${encodeURIComponent(activeSlide.productId)}`);
      return;
    }
    if (activeSlide.link && isHttpUrl(activeSlide.link)) {
      const target = new URL(activeSlide.link);
      if (target.origin === window.location.origin) window.location.assign(target.href);
      else openExternal(target.href);
      return;
    }
    if (activeSlide.targetType === 'categoria' && activeSlide.targetName) {
      selectCategory(activeSlide.targetName);
      window.requestAnimationFrame(scrollToProducts);
      return;
    }
    if (activeSlide.link.startsWith('#')) {
      document.getElementById(activeSlide.link.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    scrollToProducts();
  };

  return (
    <div className="store-shell min-h-screen bg-[#fcfcfd] text-gray-900 font-sans selection:bg-pink-100 relative overflow-hidden">
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
          {contacts.map(contact => <a key={contact.id} href={contactHref(contact)} target={contact.type === 'whatsapp' ? '_blank' : undefined} rel="noopener noreferrer" aria-label={`${contact.label}: ${contact.value}`} className="flex items-center gap-2 break-all font-bold transition-colors hover:text-pink-100">{contact.type === 'email' ? <Mail size={14} /> : <Phone size={14} />} {contact.value}</a>)}
        </div>
        <div className="flex flex-wrap justify-end gap-x-8 gap-y-2 items-center">
          {canAccessPanel && !customerPreview && (
            <Link to="/admin" className="hover:text-pink-100 flex items-center gap-2 transition-colors font-bold">
              <Settings size={14} /> Área Admin
            </Link>
          )}
          <StoreThemeControl />
          {!canAccessPanel && panelAccessNeedsCheck && <Link to="/admin" className="flex items-center gap-2 font-bold hover:text-pink-100"><Settings size={14} />Verificar acesso</Link>}
          {user && <button type="button" onClick={() => setIsEmailPreferencesOpen(true)} className="flex items-center gap-2 font-bold"><Mail size={14} />Preferências de e-mail</button>}
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
      <header className="store-header bg-[#fffdd6] px-4 md:px-12 py-10 grid grid-cols-1 lg:grid-cols-[1fr_2fr_1fr] items-center justify-items-center gap-6 relative z-20">
        <div className="flex items-center group lg:justify-self-start">
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

        <form onSubmit={submitSearch} role="search" className="flex w-full max-w-2xl relative group">
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

        <div className="flex gap-4 items-center lg:justify-self-end">
          {user && <Link to="/minha-conta" className="text-xs font-bold text-pink-600">Minha conta</Link>}
          <button type="button" onClick={openOrders} className="flex items-center gap-3 group">
            <div className="w-12 h-12 rounded-full border-2 border-[#d14d8c]/30 flex items-center justify-center bg-white group-hover:border-[#d14d8c] transition-all shadow-sm">
              <Package size={28} className="text-[#d14d8c]" />
            </div>
            <span className="sr-only">Meus Pedidos</span>
          </button>

          <button type="button" onClick={() => setIsCartOpen(true)} aria-label="Abrir carrinho" aria-haspopup="dialog" aria-expanded={isCartOpen} className="flex items-center gap-3 group relative">
            <div className="w-12 h-12 rounded-full border-2 border-[#5dc1c1]/30 flex items-center justify-center bg-white group-hover:border-[#5dc1c1] transition-all shadow-sm">
              <ShoppingCart size={28} className="text-[#5dc1c1]" />
            </div>
            <div className="sr-only">
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

      {customerPreview && canAccessPanel && <div className="bg-gray-900 px-4 py-3 text-center text-sm text-white">Visualização como cliente · <Link to="/admin" className="underline">Voltar ao painel</Link></div>}
      {categoryId && <div className="mx-auto max-w-7xl p-4"><Link to="/">Loja</Link> / {routeCategory?.nome || 'Categoria não encontrada'}</div>}
      <nav aria-label="Seções da loja" className="flex flex-wrap justify-center gap-2 bg-white px-4 py-4">{Object.entries(sectionTitles).map(([key,title])=><Link key={key} to={key==='todos'?'/':'/'+key} aria-current={!focusedPage && section===key?'page':undefined} className={`rounded-full px-4 py-2 text-sm font-bold ${!focusedPage && section===key?'bg-pink-500 text-white':'text-gray-600 hover:bg-pink-50'}`}>{title}</Link>)}</nav>
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
      <div className="bg-[#0f5e64] py-4 text-center relative z-20">
        <span className="text-white font-black uppercase tracking-[0.3em] text-[11px]">
          {promotions.find(promotion => promotion.ativa)?.titulo || 'PERSONALIZADOS FEITOS COM CUIDADO PARA VOCÊ'}
        </span>
        {/* Smooth Wave Bottom for Promo */}
        <div className="absolute bottom-[-15px] left-0 w-full overflow-hidden leading-[0] z-50 pointer-events-none">
          <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="relative block w-[calc(100%+1.3px)] h-[25px] fill-[#0f5e64]">
            <path d="M0,0V46.29c47.79,22.2,103.59,32.17,158,28,70.36-5.37,136.33-33.31,206.8-37.5C438.64,32.43,512.34,53.67,583,72.05c69.27,18,138.3,24.88,209.4,13.08,36.15-6,69.85-17.84,104.45-29.34C989.49,25,1113-14.29,1200,52.47V0Z" opacity=".25"></path>
            <path d="M0,0V15.81C13,36.92,27.64,56.86,47.69,72.05,99.41,111.27,165,111,224.58,91.58c31.15-10.15,60.09-26.07,89.67-39.8,40.92-19,84.73-46,130.83-49.67,36.26-2.85,70.9,9.42,98.6,31.56,31.77,25.39,62.32,62,103.63,73,40.44,10.79,81.35-6.69,119.13-24.28s75.16-39,116.92-43.05c59.73-5.85,113.28,22.88,168.9,38.84,30.2,8.66,59,6.17,87.09-7.5,22.43-10.89,48-26.93,60.65-49.24V0Z" opacity=".5"></path>
            <path d="M0,0V5.63C149.93,59,314.09,71.32,475.83,42.57c43-7.64,84.23-20.12,127.61-26.46,59-8.63,112.48,12.24,165.56,35.4C827.93,77.22,886,95.24,951.2,90c86.53-7,172.46-45.71,248.8-84.81V0Z"></path>
          </svg>
        </div>
      </div>

      {/* Banner Carousel */}
      {!focusedPage && <section className="w-full h-[500px] overflow-hidden relative group z-10" aria-roledescription="carrossel" aria-label="Destaques" aria-live={isCarouselPaused ? 'polite' : 'off'}>
        <AnimatePresence initial={false}>
          <motion.div
            key={currentSlide}
            initial={{ x: shouldReduceMotion ? 0 : '100%' }}
            animate={{ x: 0 }}
            exit={{ x: shouldReduceMotion ? 0 : '-100%' }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.6, ease: "easeOut" }}
            className="absolute inset-0"
          >
            <img
              src={activeSlide.image}
              alt={activeSlide.title || (activeSlide.branding ? "Banner da GB Gráfica" : `Destaque ${currentSlide + 1}`)}
              className={activeSlide.productId || activeSlide.branding ? "h-full w-full bg-gray-50 object-contain" : "w-full h-full object-cover"}
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
            {!imageOnlyBanner && <div className="absolute inset-0 bg-black/60" />}
          </motion.div>
        </AnimatePresence>

        {!imageOnlyBanner && <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center space-y-6 px-4 max-w-4xl">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h1 className="break-words text-4xl font-black leading-none tracking-tighter text-white md:text-7xl">
                {activeSlide.title ? (
                  <>
                    {activeSlide.title.split('<br/>').map((line, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <br/>}
                        {line.includes('**') ? (
                          <span className="text-pink-200">
                            {line.replace(/\*\*/g, '')}
                          </span>
                        ) : line}
                      </React.Fragment>
                    ))}
                  </>
                ) : (
                  <>
                    Impressão com <br/>
                    <span className="text-pink-200">Amor e Cuidado</span>
                  </>
                )}
              </h1>
            </motion.div>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-white max-w-xl mx-auto text-base md:text-lg font-medium"
            >
              {activeSlide.subtitle || config.banner_subtitulo || "Produtos personalizados para eternizar os momentos mais especiais da sua vida."}
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
            >
              <button type="button" onClick={handleBannerAction} className="bg-gray-900 text-white px-12 py-5 rounded-full font-black text-sm uppercase tracking-widest hover:bg-pink-500 transition-all shadow-2xl hover:scale-105 active:scale-95">
                {activeSlide.productId ? 'Ver produto' : activeSlide.link && isHttpUrl(activeSlide.link) ? 'Ver promoção' : (config.banner_botao || 'Ver Produtos')}
              </button>
            </motion.div>
          </div>
        </div>}

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
              aria-label={`Mostrar ${slide.title || (slide.branding ? "banner da loja" : `destaque ${idx + 1}`)}`}
              aria-current={currentSlide === idx}
              className={cn(
                "h-1.5 transition-all duration-500 rounded-full",
                currentSlide === idx ? "w-8 bg-pink-500" : "w-2 bg-gray-300 hover:bg-gray-400"
              )}
            />
          ))}
        </div>
      </section>

      }
      {/* Benefits */}
      {!focusedPage && benefits.length > 0 && <section aria-label="Benefícios da loja" className="relative z-10 flex flex-wrap justify-center gap-12 border-b border-gray-100 bg-white/40 px-4 py-12 backdrop-blur-sm md:gap-24 md:px-12">
        {benefits.map(benefit => <BenefitItem key={benefit.id} icon={<Sparkles size={28} />} title={benefit.title} desc={benefit.description} />)}
      </section>}

      {!focusedPage && <FlashOffers products={products} promotions={promotions} now={promotionNow} />}
      <main id="produtos" className="mx-auto max-w-[1920px] px-4 py-12 md:px-8 xl:px-12">
        {isProfile ? (
          <CustomerProfile uid={user?.uid} email={user?.email} api={customerApi} onSaved={fillProfile} />
        ) : productId ? (
          <div className="mx-auto max-w-6xl space-y-8">
            <Link to="/" className="text-sm font-bold text-pink-600">
              Voltar ao catálogo
            </Link>
            {!productsReady ? (
              <p>Carregando produto...</p>
            ) : !detailProduct ? (
              <p role="alert">Produto não encontrado.</p>
            ) : (
              <>
                {detailProduct.pacote ? (
                  <BundleConfigurator
                    key={detailProduct.pacote.revision}
                    product={detailProduct}
                    products={products}
                    onAdd={addToCart}
                    notify={(message, error) => setNotice({ type: error ? 'error' : 'success', message })}
                    renderProduct={({ onConfirm, ...props }) => (
                      <ProductCard
                        {...props}
                        onAddToCart={onConfirm}
                        user={user}
                        onRequireLogin={handleLogin}
                        onNotify={setNotice}
                        promotions={[]}
                        fonts={config.fontes_personalizacao || []}
                        personalizationModelStorage={personalizationModelStorage}
                        onOpenModel={setModelDocument}
                      />
                    )}
                  />
                ) : (
                  <ProductCard
                    key={detailProduct.id}
                    product={detailProduct}
                    user={user}
                    onRequireLogin={handleLogin}
                    onAddToCart={addToCart}
                    onNotify={setNotice}
                    promotions={promotions}
                    fonts={config.fontes_personalizacao || []}
                    personalizationModelStorage={personalizationModelStorage}
                    onOpenModel={setModelDocument}
                  />
                )}
                <ProductReviews
                  key={detailProduct.id}
                  productId={detailProduct.id}
                  uid={user?.uid}
                  orders={orders}
                  api={customerApi}
                  onChange={() =>
                    void customerApi
                      .ratings()
                      .then(setRatings)
                      .catch(() => undefined)
                  }
                />
              </>
            )}
          </div>
        ) : (
          <section aria-labelledby="products-heading" className="min-w-0">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <h1 id="products-heading" className="text-3xl font-black text-gray-900">
                {categoryId && !routeCategory ? 'Categoria não encontrada' : sectionTitles[section]}
                {activeCategory && <span className="text-pink-500"> · {activeCategory}</span>}
              </h1>
              <ShareLinks
                name={sectionTitles[section]}
                notify={(message, error) => setNotice({ type: error ? 'error' : 'success', message })}
              />
            </div>
            <form
              aria-label="Filtros do catálogo"
              className="mb-8 flex flex-wrap items-end gap-4 rounded-2xl border border-gray-100 bg-white p-4"
              onSubmit={(e) => e.preventDefault()}
            >
              <label className="text-sm">
                Categoria
                <select
                  aria-label="Filtrar por categoria"
                  value={routeCategory?.nome || ''}
                  onChange={(e) => selectCategory(e.target.value || null)}
                  className="mt-1 block rounded-lg border p-2"
                >
                  <option value="">Todas as categorias</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.nome}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </label>
              {['min', 'max'].map((key) => (
                <label key={key} className="text-sm">
                  {key === 'min' ? 'Preço mínimo (R$)' : 'Preço máximo (R$)'}
                  <input
                    aria-label={key === 'min' ? 'Preço mínimo' : 'Preço máximo'}
                    type="number"
                    min="0"
                    step="0.01"
                    value={query.get(key) || ''}
                    onChange={(e) => applyFilters({ [key]: e.target.value })}
                    className="mt-1 block w-36 rounded-lg border p-2"
                  />
                </label>
              ))}
              <label className="text-sm">
                Avaliação mínima
                <select
                  aria-label="Filtrar por avaliação"
                  value={query.get('avaliacao') || ''}
                  onChange={(e) => applyFilters({ avaliacao: e.target.value })}
                  className="mt-1 block rounded-lg border p-2"
                >
                  <option value="">Todas</option>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n} estrelas ou mais
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="p-2 text-sm font-bold text-pink-600"
                onClick={() => {
                  setSearchTerm('');
                  navigate(section === 'todos' ? '/' : '/' + section);
                }}
              >
                Limpar filtros
              </button>
            </form>
            {ratingsError && (
              <p role="status" className="mb-4 text-sm text-gray-500">
                {ratingsError}
              </p>
            )}
            {productsError ? (
              <p role="alert">{productsError}</p>
            ) : !productsReady ? (
              <p role="status">Carregando produtos...</p>
            ) : !visibleProducts.length ? (
              <p className="rounded-3xl bg-white p-12 text-center">Nenhum produto encontrado.</p>
            ) : (
              <div
                data-testid="catalog-grid"
                className="grid auto-rows-fr grid-cols-1 items-stretch gap-6 md:grid-cols-2 2xl:grid-cols-3"
              >
                {visibleProducts.map((product) => (
                  <CatalogProductCard
                    key={product.id}
                    product={product}
                    products={products}
                    promotions={promotions}
                    rating={ratings[product.id]}
                    onAdd={addToCart}
                    notify={(message, error) => setNotice({ type: error ? 'error' : 'success', message })}
                  />
                ))}
              </div>
            )}
          </section>
        )}
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
              {contacts.map(contact => <li key={contact.id}><a href={contactHref(contact)} target={contact.type === 'whatsapp' ? '_blank' : undefined} rel="noopener noreferrer" className="flex items-center gap-2 break-all transition-colors hover:text-pink-500">{contact.type === 'email' ? <Mail size={14} /> : <Phone size={14} />} {contact.label}: {contact.value}</a></li>)}
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
          {config.contatos === undefined && config.email_atendimento && (
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
              <div className="space-y-6" onChangeCapture={()=>{checkoutDraftEdited.current=true;}}>
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
                        {item.bundleItems && <div className="mt-3 space-y-3 rounded-xl border border-purple-100 p-3">{item.bundleItems.map((child,index)=><div key={index} className="space-y-2 text-xs"><p className="font-bold">{child.quantidade * item.quantidade} × {child.nome}</p><p>{Object.entries(child.selecoes).map(([k,v])=>`${k}: ${v}`).join(' · ')}</p>{child.textoPersonalizado && <p className="whitespace-pre-wrap">{child.textoPersonalizado}</p>}{child.arquivoNome && <p>Arte: {child.arquivoNome}</p>}{child.modeloPath && <><button onClick={()=>void openCartModel(child)} className="font-bold text-purple-600">Visualizar modelo de {child.nome}</button><label className="flex gap-2"><input type="checkbox" aria-label={`Aprovar arte de ${child.nome} no pacote`} checked={child.aprovarArte===true} onChange={e=>{const approved=e.target.checked;setCart(current=>current.map(root=>root.id===item.id?{...root,bundleItems:root.bundleItems!.map((c,i)=>i===index?{...c,aprovarArte:approved}:c)}:root));}} />Conferi e aprovo a arte deste componente para produção.</label></>}</div>)}</div>}
                        {item.personalizacaoTexto ? (
                          <div className="mt-2 rounded-lg border border-pink-100 bg-pink-50/70 px-3 py-2 text-[10px] text-gray-600">
                            <div className="whitespace-pre-wrap break-words font-bold text-pink-600">Texto: {item.personalizacaoTexto.texto}</div>
                            <div className="mt-1">
                              Fonte: {textCustomizationFontLabel(item.personalizacaoTexto, config.fontes_personalizacao)}
                            </div>
                            {item.modeloNome && <div className="mt-1 font-bold text-green-700">Modelo composto: {item.modeloNome}</div>}
                          </div>
                        ) : item.textoPersonalizado ? (
                          <div className="mt-2 text-[10px] font-bold text-pink-600">Personalização: {item.textoPersonalizado}</div>
                        ) : null}
                        {item.modeloPath && <button type="button" onClick={() => void openCartModel(item)} className="mt-2 text-xs font-bold text-purple-600 hover:underline">Visualizar modelo{item.contracapaPath ? ' · capa e contracapa' : ''}</button>}
                        {item.printProfile && <p className="mt-2 text-[10px] text-gray-600">{printProfileLabel(item.printProfile)}</p>}
                        {item.modeloPath && <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-gray-700"><input type="checkbox" aria-label={`Aprovar arte de ${item.nome}`} checked={item.aprovarArte === true} onChange={event => { const approved = event.target.checked; setCart(current => current.map(entry => entry.id === item.id ? { ...entry, aprovarArte: approved } : entry)); }} className="mt-0.5 shrink-0" /><span>Conferi o modelo e aprovo {item.contracapaPath ? 'a capa e a contracapa' : 'a capa'}, os textos e as posições deste item para produção.</span></label>}
                        {item.arquivoNome && (
                          <div className="mt-1 text-[10px] text-gray-500">Arte anexada: {item.arquivoNome}</div>
                        )}
                        <div className="flex justify-between items-center mt-2">
                          <div className="flex items-center gap-2 bg-gray-50 rounded-lg border border-gray-100 p-1">
                            <button
                              type="button"
                              aria-label={`Diminuir quantidade de ${item.nome}`}
                              disabled={Boolean(item.bundleItems && !item.bundleQuantityAllowed)}
                              onClick={() => updateQuantity(item.id, -1)}
                              className="w-6 h-6 flex items-center justify-center hover:bg-gray-200 rounded transition-colors"
                            >
                              -
                            </button>
                            <span className="text-xs w-4 text-center font-bold">{item.quantidade}</span>
                            <button
                              type="button"
                              aria-label={`Aumentar quantidade de ${item.nome}`}
                              disabled={Boolean(item.bundleItems && !item.bundleQuantityAllowed)}
                              onClick={() => updateQuantity(item.id, 1)}
                              className="w-6 h-6 flex items-center justify-center hover:bg-gray-200 rounded transition-colors"
                            >
                              +
                            </button>
                          </div>
                          <span className="text-right font-bold text-pink-500">
                            {item.precoOriginal && (
                              <span className="mb-0.5 block text-[10px] font-medium text-gray-400 line-through">
                                {formatMoney(((parseMoneyToCents(item.precoOriginal) || 0) * item.quantidade) / 100)}
                              </span>
                            )}
                            {formatMoney(((parseMoneyToCents(item.preco) || 0) * item.quantidade) / 100)}
                          </span>
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
                          id="shipping-cep" aria-invalid={checkoutErrors.some(issue => issue.field === 'shipping-cep')}
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
                          <fieldset className="mt-3 space-y-2">
                            <legend className="font-bold text-gray-900">Serviço dos Correios</legend>
                            {shippingInfo.options.map(option => (
                              <label key={option.service_code} className="flex items-start gap-2 rounded-lg border border-gray-200 p-2 cursor-pointer">
                                <input type="radio" name="shipping-service" checked={shippingInfo.selectedCode === option.service_code}
                                  onChange={() => setShippingInfo({ ...shippingInfo, selectedCode: option.service_code, price: option.amount_cents / 100 })} />
                                <span>{option.service_name} — R$ {(option.amount_cents / 100).toFixed(2)}
                                  <span className="block">Prazo estimado: {option.delivery_days} {option.delivery_days === 1 ? 'dia útil' : 'dias úteis'} após a postagem.</span>
                                  {!option.home_delivery && <span className="block font-semibold">Pode exigir retirada em agência dos Correios.</span>}
                                </span>
                              </label>
                            ))}
                          </fieldset>
                          <p className="mt-2">{shippingInfo.parcel_count} {shippingInfo.parcel_count === 1 ? 'volume' : 'volumes'}. O prazo de transporte não inclui a produção{config.prazo_producao ? `: ${config.prazo_producao}` : '.'}</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                            <div className="sm:col-span-2">
                              <label htmlFor="shipping-street" className="text-[10px] uppercase tracking-widest text-gray-400 block mb-1 font-black">Rua</label>
                              <input
                                id="shipping-street" aria-invalid={checkoutErrors.some(issue => issue.field === 'shipping-street')}
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
                                id="shipping-neighborhood" aria-invalid={checkoutErrors.some(issue => issue.field === 'shipping-neighborhood')}
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
                                id="shipping-number" aria-invalid={checkoutErrors.some(issue => issue.field === 'shipping-number')}
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
                      id="checkout-name" aria-invalid={checkoutErrors.some(issue => issue.field === 'checkout-name')}
                      type="text"
                      placeholder="Seu nome completo"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value.slice(0, 100))}
                      autoComplete="name"
                      className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-pink-400 mb-4"
                    />
                    <label htmlFor="checkout-cpf" className="text-[10px] uppercase tracking-widest text-gray-400 block mb-2 font-black">CPF do pagador (obrigatório no PagBank)</label>
                    <input
                      id="checkout-cpf" aria-invalid={checkoutErrors.some(issue => issue.field === 'checkout-cpf')}
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
                      id="checkout-phone" aria-invalid={checkoutErrors.some(issue => issue.field === 'checkout-phone')}
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
                        id="checkout-legal-acceptance" aria-invalid={checkoutErrors.some(issue => issue.field === 'checkout-legal-acceptance')}
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

                  {user && <section className="space-y-2 rounded-xl border border-gray-200 p-3" aria-label="Cupom de desconto">
                    <label className="block text-sm font-bold text-gray-700">Cupom de desconto
                      <input className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" value={couponInput} maxLength={COUPON_CODE_MAX_LENGTH}
                        onChange={event => setCouponInput(event.target.value.toUpperCase())} placeholder="Digite o código"
                        onKeyDown={event => {
                          if (event.key === 'Enter' && couponInput.trim() && !isCheckingOut) {
                            event.preventDefault();
                            setCouponCode(couponInput.trim());
                            setCouponRefresh(value => value + 1);
                          }
                        }} />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={!couponInput.trim() || isCheckingOut} className="rounded-lg border border-pink-200 px-3 py-2 text-sm font-bold text-pink-700 disabled:opacity-40"
                        onClick={() => { setCouponCode(couponInput.trim()); setCouponRefresh(value => value + 1); }}>Aplicar cupom</button>
                      {couponCode && <button type="button" disabled={isCheckingOut} className="px-3 py-2 text-sm text-gray-700"
                        onClick={() => { setCouponInput(''); setCouponCode(''); }}>Remover cupom</button>}
                    </div>
                    <div aria-live="polite">
                      {awaitingCoupon && <p className="text-xs text-gray-500">Verificando desconto…</p>}
                      {appliedCoupon && <p className="text-sm font-medium text-green-700">
                        {appliedCoupon.firstPurchase ? 'Primeira compra · ' : ''}{appliedCoupon.description} ({appliedCoupon.code})
                      </p>}
                      {currentCouponQuote?.error && <p className="text-sm text-red-700">{currentCouponQuote.error}{' '}
                        <button type="button" className="underline" onClick={() => setCouponRefresh(value => value + 1)}>Tentar novamente</button>
                      </p>}
                    </div>
                  </section>}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-sm text-gray-500">
                      <span>Subtotal</span>
                      <span>{formatMoney(subtotalCents / 100)}</span>
                    </div>
                    {appliedCoupon && <div className="flex justify-between items-center text-sm font-bold text-green-700">
                      <span>Desconto do cupom</span>
                      <span>− {formatMoney(appliedCoupon.discountCents / 100)}</span>
                    </div>}
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
                  <label className="mb-4 block text-sm">Observações do pedido (opcional)<textarea aria-label="Observações do pedido" maxLength={1000} value={orderNotes} onChange={event => setOrderNotes(event.target.value)} className="mt-2 w-full rounded-xl border border-gray-200 p-3" /></label>
                  {checkoutErrors.length > 0 && <div role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-600"><p className="font-bold">Preencha os campos para continuar:</p><ul>{checkoutErrors.map(issue => <li key={issue.field}><button type="button" className="underline" onClick={() => document.getElementById(issue.field)?.focus()}>{issue.message}</button></li>)}</ul></div>}
                  <button
                    type="button"
                    onClick={checkout}
                    disabled={isCheckingOut || isCalculating || awaitingCoupon || Boolean(currentCouponQuote?.error)}
                    className="w-full bg-gray-900 text-white font-black py-4 rounded-xl hover:bg-pink-500 transition-all shadow-xl shadow-gray-100 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isCheckingOut ? <><Loader2 className="animate-spin" size={18} /> REDIRECIONANDO...</> : "IR PARA O PAGBANK"}
                  </button>
                </div>

              </div>
            )}
          </Modal>
        )}

        {user && isEmailPreferencesOpen && <Modal title="Preferências de e-mail" onClose={() => setIsEmailPreferencesOpen(false)}><React.Fragment key={user.uid}><EmailPreferences api={emailApi} /></React.Fragment></Modal>}
        {(isOrdersOpen || detailOrder) && (
          <Modal title={detailOrder ? `Detalhes do pedido ${detailOrder.id}` : 'Meus Pedidos'} onClose={() => { if (detailOrder) { setDetailOrderId(null); setIsOrdersOpen(true); } else setIsOrdersOpen(false); }}>
            {detailOrder ? <CustomerOrderDetails order={detailOrder} /> : !ordersReady ? (
              <div className="py-12 text-center text-gray-500" role="status"><Loader2 className="mx-auto mb-3 animate-spin text-pink-500" /> Carregando pedidos...</div>
            ) : ordersError ? (
              <div className="py-12 text-center text-red-600" role="alert">{ordersError}</div>
            ) : orders.length === 0 ? (
              <div className="py-12 text-center text-gray-500">Você ainda não possui pedidos.</div>
            ) : (
              <div className="space-y-6 pr-2">
                {orders.map((order) => (
                  <div key={order.id} className="bg-gray-50 p-6 rounded-2xl border border-gray-100 space-y-4">
                    <OrderDocuments order={order} />
                    <div className="flex justify-between items-center border-b border-gray-200 pb-4">
                      <div>
                        <div className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Pedido #{order.id}</div>
                        <div className="text-xs text-gray-500 mt-1 flex items-center gap-1"><Clock size={12} /> {formatOrderDate(order.data)}</div>
                        {order.metodoEntrega && (
                          <div className="text-[9px] text-pink-400 mt-1.5 font-black uppercase tracking-[0.1em] flex items-center gap-1.5">
                            {order.metodoEntrega === 'retirada' ? (
                              <><Settings size={10} className="stroke-[2.5px]" /> Retirada na Gráfica</>
                            ) : (
                              <><Package size={10} className="stroke-[2.5px]" /> Entrega{order.shipping ? ` — ${order.shipping.service_name}` : ''}</>
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
                      {orderItems(order.itens).map((item) => (
                        <div key={item.id} className="text-xs space-y-1">
                          <div className="flex justify-between">
                            <span className="text-gray-600 font-medium">{item.quantidade}x {item.nome}</span>
                            <span className="text-gray-900 font-bold">{item.bundleParentName ? 'Incluído no pacote' : formatMoney(((parseMoneyToCents(item.preco) || 0) * item.quantidade) / 100)}</span>
                          </div>
                          {item.personalizacaoTexto ? (
                            <div className="whitespace-pre-wrap break-words text-[9px] text-pink-500 font-black uppercase tracking-wider">
                              Texto: {item.personalizacaoTexto.texto} · Fonte: {textCustomizationFontLabel(item.personalizacaoTexto, config.fontes_personalizacao)}
                            </div>
                          ) : item.textoPersonalizado ? (
                            <div className="text-[9px] text-pink-500 font-black uppercase tracking-wider">
                              Personalização antiga: {item.textoPersonalizado}
                            </div>
                          ) : null}
                          {item.arquivoPath && <span className="text-[9px] text-gray-500">Arte recebida para produção.</span>}
                          {item.modeloPath && (
                            <button
                              type="button"
                              onClick={() => openOrderModel(order.id, item.id)}
                              className="text-[9px] text-purple-600 flex items-center gap-1 font-black uppercase tracking-wider hover:underline"
                            >
                              <FileText size={10} /> Abrir modelo composto
                            </button>
                          )}
                          {item.artePendente && (
                            <div className="text-[9px] text-amber-600 flex items-center gap-1 font-black uppercase tracking-wider">
                              <AlertCircle size={10} /> Pedido antigo sem arte anexada
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
                    <button type="button" onClick={() => { setIsOrdersOpen(false); setDetailOrderId(order.id); }} className="w-full rounded-xl border border-purple-200 px-4 py-3 text-xs font-bold text-purple-600">Ver detalhes do pedido {order.id}</button>
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

      {modelDocument && <PersonalizationViewer document={modelDocument} onClose={() => setModelDocument(null)} />}

      {/* Floating Chat Button */}
      {primaryContact && <motion.button
        type="button"
        aria-label={`Falar com a GB Gráfica: ${primaryContact.label}`}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => { const href = contactHref(primaryContact); if (primaryContact.type === 'whatsapp') openExternal(href); else window.location.assign(href); }}
        className="fixed bottom-8 right-8 z-40 bg-[#25D366] text-white p-4 rounded-full shadow-2xl flex items-center justify-center group"
      >
        {primaryContact.type === 'email' ? <Mail size={24} /> : <Phone size={24} />}
        <span className="max-w-0 overflow-hidden group-hover:max-w-xs group-hover:ml-2 transition-all duration-300 font-bold text-sm whitespace-nowrap">
          {primaryContact.label}
        </span>
      </motion.button>}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const closeAction = React.useRef(onClose); closeAction.current = onClose;
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
        closeAction.current();
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

function BenefitItem({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string; key?: string }) {
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
  promotions,
  fonts,
  personalizationModelStorage,
  onOpenModel, initialSelections = {}, lockSelections = false, confirmLabel = 'Adicionar ao Carrinho', onDraftChange,
}: {
  initialSelections?: Record<string,string>; lockSelections?: boolean; confirmLabel?: string; onDraftChange?: () => void;
  product: Anuncio;
  user: FirebaseUser | null;
  onRequireLogin: () => Promise<boolean>;
  onAddToCart: (item: CartItem) => void;
  onNotify: (notice: Notice) => void;
  promotions: Promocao[];
  fonts: PersonalizationFont[];
  personalizationModelStorage: PersonalizationModelStorage;
  onOpenModel: (model: PersonalizationDocument) => void;
  key?: string;
}) {
  const [selections, setSelections] = useState<Record<string, string>>(initialSelections);
  const [storedArtwork, setUploadedArtwork] = useState<UploadedArtwork | null>(null);
  const [artworkSourceFile, setArtworkSourceFile] = useState<File | null>(null);
  const [uploadedModel, setUploadedModel] = useState<UploadedArtwork | null>(null);
  const [uploadedBackOriginal, setUploadedBackOriginal] = useState<UploadedArtwork | null>(null);
  const [uploadedBack, setUploadedBack] = useState<UploadedArtwork | null>(null);
  const [extraModels,setExtraModels]=useState<UploadedArtwork[]>([]);
  const [backDraft, setBackDraft] = useState<BackCoverDraft>({ mode: /caderno/i.test(`${product.nome} ${product.categoria}`) ? 'automatic' : 'none' });
  const [generatedDocument, setGeneratedDocument] = useState<PersonalizationDocument | null>(null);
  const [isUploadingArtwork, setIsUploadingArtwork] = useState(false);
  const [artworkPreviewUrl, setArtworkPreviewUrl] = useState<string | null>(null);
  const [textCustomization, setTextCustomization] = useState<TextCustomization | null>(null);
  const [isTextDrawerOpen, setIsTextDrawerOpen] = useState(false);
  const [activeImage, setActiveImage] = useState(product.imagem);

  const { moldePdf: binding, imagemBase: baseImage } = resolveProductProduction(product, selections);
  const [moldText,setMoldText]=useState('');
  const incompatibleArtwork = !!binding && !!artworkSourceFile &&
    !isComposablePersonalizationImage(artworkSourceFile.type, artworkSourceFile.size);
  const uploadedArtwork = incompatibleArtwork ? null : storedArtwork;
  const allImages = Array.from(new Set([product.imagem, ...(product.imagens || [])].filter(Boolean)));
  const legacySourceImage = allImages.includes(activeImage) ? activeImage : variantImage(product, selections, false);
  const template = !binding && !baseImage ? (product.modelosPdf || []).find(template => template.pages.includes(legacySourceImage)) : undefined;
  const [pdfBack, setPdfBack] = useState<Blob | undefined>();
  React.useEffect(() => { let cancelled = false; setPdfBack(undefined); if (artworkSourceFile?.type === 'application/pdf') void import('../services/pdfPreview').then(module => module.pdfPreviewPages(artworkSourceFile)).then(pages => { if (!cancelled) setPdfBack(pages[1]); }).catch(error => onNotify({ type: 'error', message: error.message })); return () => { cancelled = true; }; }, [artworkSourceFile]);
  const attributeSignature = JSON.stringify(product.atributos);
  const availableFonts = activePersonalizationFonts(fonts);
  const printProfile = binding ? undefined : parsePrintProfile(product.printProfile) || undefined;
  const customization = productCustomization(product,selections);
  const requiresArtwork = customization.image;
  const requiresText = customization.text;
  const mustCompose=Boolean(binding || requiresText || baseImage || requiresArtwork && printProfile);

  // Sincroniza a imagem ativa se o produto mudar (ex: edição no admin)
  React.useEffect(() => {
    setActiveImage(product.imagem);
  }, [product.imagem]);

  React.useEffect(() => { setActiveImage(variantImage(product, selections)); }, [product.imagensPorCombinacao, product.atributos, product.imagem, JSON.stringify(selections)]);

  React.useEffect(() => {
    setSelections(initialSelections);
  }, [product.id, attributeSignature, JSON.stringify(initialSelections)]);
  React.useEffect(()=>{onDraftChange?.();},[JSON.stringify(selections),uploadedArtwork?.path,uploadedModel?.path,uploadedBack?.path,JSON.stringify(textCustomization)]);

  React.useEffect(() => () => {
    if (artworkPreviewUrl) URL.revokeObjectURL(artworkPreviewUrl);
  }, [artworkPreviewUrl]);

  const sourceKey = JSON.stringify([requiresArtwork ? uploadedArtwork?.path : '', binding?.revision, binding?.pdf.path, baseImage || (!binding ? legacySourceImage : ''), printProfileKey(printProfile),template?.alphabet||null, customization, selections]);
  const previousSource = useRef(sourceKey);
  React.useEffect(() => { if (previousSource.current !== sourceKey) { previousSource.current = sourceKey; for(const file of [uploadedModel,uploadedBack,...extraModels])if(file)void personalizationModelStorage.deleteModel(file.path).catch(()=>undefined); setGeneratedDocument(null); setUploadedModel(null); setUploadedBack(null);setExtraModels([]); if (uploadedBackOriginal) void personalizationModelStorage.deleteModel(uploadedBackOriginal.path).catch(() => undefined); setUploadedBackOriginal(null); } }, [sourceKey]);

  const handleSelect = (attrName: string, option: string) => {
    if (lockSelections) return;
    setSelections(previous => {
      if (previous[attrName] !== option) return { ...previous, [attrName]: option };
      const next = { ...previous };
      delete next[attrName];
      return next;
    });
  };

  const handleArtworkFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if(binding && !isComposablePersonalizationImage(file.type,file.size)){onNotify({type:'error',message:'Para este molde, envie uma imagem JPG, PNG ou WebP.'});return;}
    if (file.type !== 'application/pdf' && (requiresText || printProfile) && !isComposablePersonalizationImage(file.type, file.size)) {
      onNotify({
        type: 'error',
        message: 'Produtos com texto ou formato de impressão exigem uma imagem JPG, PNG ou WebP para compor o modelo. PDF continua disponível nos produtos sem essas opções.',
      });
      return;
    }
    const nextPreviewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;

    if (!user) {
      const loggedIn = await onRequireLogin();
      if (!loggedIn) {
        if (nextPreviewUrl) URL.revokeObjectURL(nextPreviewUrl);
        return;
      }
    }

    setIsUploadingArtwork(true);
    try {
      const nextArtwork = await personalizationModelStorage.uploadArtwork(file);
      const previousArtwork = storedArtwork;
      const previousModel = uploadedModel;
      const previousBack = uploadedBack;
      setUploadedArtwork(nextArtwork);
      setArtworkSourceFile(file);
      setArtworkPreviewUrl(nextPreviewUrl);
      if (previousArtwork) void removePendingArtwork(previousArtwork.path).catch(() => undefined);
      if (previousModel) void personalizationModelStorage.deleteModel(previousModel.path).catch(() => undefined);
      if (previousBack) void personalizationModelStorage.deleteModel(previousBack.path).catch(() => undefined);
      setUploadedBack(null);
      setGeneratedDocument(null);
      setUploadedModel(null);
      setTextCustomization(null);
      onNotify({ type: 'success', message: 'Arte enviada com segurança.' });
    } catch (error) {
      if (nextPreviewUrl) URL.revokeObjectURL(nextPreviewUrl);
      onNotify({
        type: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível enviar a arte.',
      });
    } finally {
      setIsUploadingArtwork(false);
    }
  };

  const removeArtwork = () => {
    if (storedArtwork) void removePendingArtwork(storedArtwork.path).catch(() => undefined);
    if (uploadedModel) void personalizationModelStorage.deleteModel(uploadedModel.path).catch(() => undefined);
    if (uploadedBack) void personalizationModelStorage.deleteModel(uploadedBack.path).catch(() => undefined);
    setUploadedBack(null);
    setExtraModels([]);
    setGeneratedDocument(null);
    setUploadedArtwork(null);
    setArtworkSourceFile(null);
    setUploadedModel(null);
    setArtworkPreviewUrl(null);
    setTextCustomization(null);
  };

  const originalPriceCents = productPrice(product, selections);
  const discount = originalPriceCents === null ? null : promotionalPrice(originalPriceCents, product, promotions);
  const priceCents = discount?.finalCents ?? originalPriceCents;
  const price = priceCents === null ? null : (priceCents / 100).toFixed(2);
  const customizationReady = (!requiresArtwork || Boolean(uploadedArtwork || template || baseImage || binding)) &&
    (!requiresText || Boolean(binding ? moldText && uploadedModel : textCustomization && uploadedModel)) && (!mustCompose || Boolean(uploadedModel));

  const openTextCustomizer = async () => {
    if (!binding && requiresText && availableFonts.length === 0) {
      onNotify({ type: 'error', message: 'As fontes de personalização ainda não foram configuradas.' });
      return;
    }
    if (requiresArtwork && !template && !baseImage && !binding && (!uploadedArtwork || !artworkSourceFile)) {
      onNotify({ type: 'error', message: 'Envie a imagem antes de posicionar o texto.' });
      return;
    }
    if (!user) {
      const loggedIn = await onRequireLogin();
      if (!loggedIn) return;
    }
    if (!binding && artworkSourceFile?.type === 'application/pdf') {
      try { const pages = await (await import('../services/pdfPreview')).pdfPreviewPages(artworkSourceFile); setPdfBack(pages[1]); }
      catch (error) { onNotify({ type: 'error', message: error instanceof Error ? error.message : 'Não foi possível abrir o PDF.' }); return; }
    }
    setIsTextDrawerOpen(true);
  };

  const handleAdd = () => {
    if (priceCents === null || priceCents <= 0) return;
    if (requiresArtwork && !uploadedArtwork && !template && !baseImage && !binding) {
      onNotify({ type: 'error', message: 'Envie a arte antes de adicionar este produto ao carrinho.' });
      return;
    }

    if (requiresText && !(binding ? moldText : textCustomization)) {
      onNotify({ type: 'error', message: 'Configure o texto, a fonte e a posição da personalização.' });
      return;
    }
    if (mustCompose && !uploadedModel) {
      onNotify({ type: 'error', message: 'Gere o modelo composto antes de adicionar este produto ao carrinho.' });
      return;
    }
    if (uploadedModel && printProfileKey(generatedDocument?.printProfile) !== printProfileKey(printProfile)) {
      onNotify({ type: 'error', message: 'O formato de impressão mudou. Gere o modelo novamente.' }); return;
    }
    const customizationFingerprint = binding ? `${binding.revision}:${requiresText?moldText:''}` : textCustomization ? textCustomizationFingerprint(textCustomization) : '';
    const cartId = createCartItemId(
      product.id,
      selections,
      customizationFingerprint,
      [uploadedArtwork?.path, uploadedModel?.path, uploadedBack?.path, uploadedBackOriginal?.path].filter(Boolean).join('|'),
    );
    onAddToCart({
      id: cartId,
      productId: product.id,
      ...(template && !uploadedArtwork ? { templateId: template.id } : {}),
      nome: product.nome,
      imagem: variantImage(product, selections),
      preco: (priceCents / 100).toFixed(2),
      ...(discount ? {
        precoOriginal: (discount.originalCents / 100).toFixed(2),
        promocaoId: discount.promotion.id,
        descontoPercentual: discount.percentage,
      } : {}),
      selecoes: { ...selections },
      quantidade: 1,
      ...(printProfile ? { printProfile } : {}),
      ...(!binding && baseImage ? { imagemBaseReferencia: baseImage } : {}),
      ...(binding ? {moldeRevisao:binding.revision,textoMolde:requiresText?moldText:'',textoPersonalizado:requiresText?moldText:undefined,inicialReferencia:initialReference(binding.pdf,requiresText?moldText:'',binding.layout.initial_size_percent),imagemClientePath:requiresArtwork?uploadedArtwork?.path:undefined} : {arquivoPath:requiresArtwork?uploadedArtwork?.path:undefined,arquivoNome:requiresArtwork?uploadedArtwork?.name:undefined}),
      ...(extraModels.length?{paginasModelo:extraModels.map(f=>f.path)}:{}),
      modeloPath: uploadedModel?.path,
      modeloNome: uploadedModel?.name,
      contracapaPath: uploadedBack?.path,
      contracapaOriginalPath: uploadedBackOriginal?.path,
      contracapaOriginalNome: uploadedBackOriginal?.name,
      contracapaNome: uploadedBack?.name,
      ...(uploadedBack && backDraft.mode !== 'none' ? { contracapaModo: backDraft.mode } : {}),
      textoPersonalizado: binding ? (requiresText?moldText:undefined) : requiresText?textCustomization?.texto:undefined,
      personalizacaoTexto: !binding && requiresText?textCustomization || undefined:undefined,
      ...(template?.alphabet && !uploadedArtwork ? { inicialReferencia: initialReference(template, textCustomization?.texto || '') } : {}),
    });

    // Package components keep their draft until the complete package is added.
    if(onDraftChange) return;

    // Reset after adding
    setUploadedBackOriginal(null);
    setUploadedBack(null);
    setExtraModels([]);
    setGeneratedDocument(null);
    setBackDraft({ mode: /caderno/i.test(`${product.nome} ${product.categoria}`) ? 'automatic' : 'none' });
    setUploadedArtwork(null);
    setArtworkSourceFile(null);
    setUploadedModel(null);
    setArtworkPreviewUrl(null);
    setTextCustomization(null);
  };

  return (
    <>
    <motion.article
      id={`produto-${product.id}`}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="@container/product min-w-0 max-w-full overflow-hidden [overflow-wrap:anywhere] bg-white/60 backdrop-blur-sm border border-gray-100 rounded-[2.5rem] p-5 sm:p-8 hover:border-pink-200 transition-all group shadow-sm hover:shadow-md"
    >
      <div className="flex min-w-0 flex-col gap-6 @3xl/product:flex-row @3xl/product:gap-10">
      <div className="min-w-0 max-w-full w-full @3xl/product:w-80 flex-shrink-0 flex flex-col gap-4">
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

      <div className="min-w-0 flex-1 flex flex-col">
        <div className="flex min-w-0 justify-between items-start gap-3 mb-4">
          <h3 className="min-w-0 text-2xl font-black text-gray-900 tracking-tight">{product.nome}</h3>
          {product.lancamento && <div className="shrink-0 bg-pink-50 text-pink-500 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">Novo</div>}
        </div>
        <p className="text-sm text-gray-500 mb-8 leading-relaxed max-w-2xl font-medium">{product.desc}</p>

        <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-6 mb-10">
          {product.atributos.map(attr => (
            <div key={attr.nome} className="min-w-0 flex flex-col">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4">{attr.nome}</span>
              <div className="flex flex-col gap-2">
                {attr.opcoes.map(option => {
                  const reference = optionReferenceImage(attr.configuracao?.[option]);
                  return <button
                    type="button"
                    key={option}
                    disabled={lockSelections}
                    onClick={() => handleSelect(attr.nome, option)}
                    aria-pressed={selections[attr.nome] === option}
                    className={cn(
                      "flex items-center gap-2 text-left px-4 py-3 rounded-xl border text-xs font-bold transition-all",
                      selections[attr.nome] === option
                        ? "bg-gradient-to-r from-pink-400 to-purple-500 border-transparent text-white shadow-lg shadow-pink-100"
                        : "bg-gray-50 border-gray-100 text-gray-500 hover:border-pink-200 hover:text-pink-600"
                    )}
                  >
                    {reference && <img src={reference} alt=""
                      className="h-8 w-8 shrink-0 rounded object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
                    <span className="min-w-0 break-words">
                      {option}{product.precificacao === 'adicionais' && attr.configuracao?.[option]?.adicional &&
                        <span className="ml-2 opacity-80">+ {formatMoney(attr.configuracao[option].adicional)}</span>}
                    </span>
                  </button>;
                })}
              </div>
            </div>
          ))}

          {/* Personalization Section */}
          <div className="col-span-full flex min-w-0 flex-col gap-6">
            {requiresArtwork && (
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
                    <UploadInput
                      type="file"
                      originalPdf accept={binding?"image/png,image/jpeg,image/webp":"application/pdf,image/png,image/jpeg,image/webp"}
                      onChange={handleArtworkFile}
                      disabled={isUploadingArtwork}
                      className="sr-only"
                    />
                  </label>
                )}
                {incompatibleArtwork && <p className="mt-2 text-xs text-amber-700">
                  Para usar seu arquivo nesta opção, envie uma imagem JPG, PNG ou WebP.
                </p>}
                <p className="mt-2 text-[9px] text-gray-400 leading-tight">
                  {binding?'PNG, JPG ou WebP':'PDF, PNG, JPG ou WebP'}, até 50 MB. O arquivo fica privado, vinculado ao pedido. {baseImage||binding||template?'Envio opcional: sem arquivo, será usada a base da loja.':'Envie a arte para concluir a compra.'}
                </p>
              </div>
            )}

            {!binding && !requiresText && (baseImage || template || artworkSourceFile && (artworkSourceFile.type === 'application/pdf' || isComposablePersonalizationImage(artworkSourceFile.type, artworkSourceFile.size))) && <button type="button" onClick={() => void openTextCustomizer()} className="rounded-xl border border-pink-200 bg-pink-50 px-4 py-3 text-xs font-bold text-pink-600">Personalizar capa e contracapa</button>}
            {binding && <button type="button" onClick={()=>void openTextCustomizer()} className="rounded-xl border border-pink-200 bg-pink-50 px-4 py-3 text-xs font-bold text-pink-600">{uploadedModel?'Editar personalização':'Personalizar e conferir modelo'}</button>}
            {generatedDocument && <button type="button" onClick={() => onOpenModel(generatedDocument)} className="rounded-xl border border-purple-200 px-4 py-3 text-xs font-bold text-purple-600">Visualizar modelo{uploadedBack ? ' · capa e contracapa' : ''}</button>}
            {!binding && requiresText && (
              <div className="flex flex-col">
                <span className="mb-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">{product.labelTexto || 'Personalização'}</span>
                {textCustomization ? (
                  <div className="rounded-xl border border-pink-200 bg-pink-50/70 p-4">
                    <div className="whitespace-pre-wrap break-words text-sm font-bold text-gray-900">{textCustomization.texto}</div>
                    <div className="mt-2 text-[9px] font-bold uppercase tracking-wider text-gray-500">
                      {textCustomizationFontLabel(textCustomization, fonts)}
                    </div>
                    {uploadedModel && <div className="mt-2 text-[9px] font-black uppercase tracking-wider text-green-700">Modelo composto pronto</div>}
                    <button
                      type="button"
                      onClick={() => void openTextCustomizer()}
                      className="mt-3 text-[10px] font-black uppercase tracking-widest text-pink-600 hover:underline"
                    >
                      Editar texto e posição
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void openTextCustomizer()}
                    disabled={availableFonts.length === 0 || (requiresArtwork && !uploadedArtwork && !template && !baseImage)}
                    className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-pink-200 bg-pink-50 px-4 py-4 text-xs font-bold text-pink-600 transition-colors hover:border-pink-400 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    <FileText size={16} /> {availableFonts.length === 0
                      ? 'Fontes indisponíveis'
                      : requiresArtwork && !uploadedArtwork && !baseImage && !template
                        ? 'Envie a imagem primeiro'
                        : 'Personalizar texto'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-auto pt-8 border-t border-gray-100 flex flex-col gap-6">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 max-w-full flex-wrap items-baseline gap-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Preço</span>
              <div className="min-w-0 text-3xl font-black text-gray-900">
                {price && priceCents !== null && priceCents > 0 ? (
                  <div>
                    {discount && (
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-gray-400 line-through">{formatMoney(discount.originalCents / 100)}</span>
                        <span className="rounded-full bg-pink-100 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-pink-600">
                          {formattedDiscountPercentage(discount.percentage)}% OFF
                        </span>
                      </div>
                    )}
                    <span className="flex flex-wrap items-center gap-1">
                      <span className="text-sm font-normal text-gray-400">R$</span> {formatMoney(price).replace(/^R\$\s*/, '')}
                    </span>
                  </div>
                ) : (
                  <span className="text-sm text-pink-500 font-bold uppercase tracking-widest animate-pulse">
                    {Object.keys(selections).length ? 'Preço não configurado para esta seleção' : (product.preco_base || 'Selecione as opções')}
                  </span>
                )}
              </div>
            </div>

            <ShareLinks productId={product.id} name={product.nome} notify={(message,error)=>onNotify({type:error?'error':'success',message})} />
          </div>

          <button
            type="button"
            onClick={handleAdd}
            disabled={priceCents === null || priceCents <= 0 || !customizationReady || isUploadingArtwork}
            className={cn(
              "w-full min-w-0 max-w-full flex items-center justify-center gap-3 px-4 sm:px-6 py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all",
              priceCents !== null && priceCents > 0 && customizationReady && !isUploadingArtwork
                ? "bg-gray-900 text-white hover:bg-[#d14d8c] shadow-xl hover:shadow-pink-100 active:scale-95 cursor-pointer"
                : "bg-gray-100 text-gray-400 cursor-not-allowed opacity-60"
            )}
          >
            <ShoppingCart size={18} className="shrink-0" />
            <span className="min-w-0">{confirmLabel}</span>
          </button>
        </div>
      </div>
      </div>
    </motion.article>
    {isTextDrawerOpen && binding && <ProductPdfEditor binding={binding} textEnabled={requiresText} initialText={moldText} image={requiresArtwork ? (uploadedArtwork && artworkSourceFile) || baseImage : undefined} onClose={()=>setIsTextDrawerOpen(false)} onSave={async(text,document)=>{
      const files:UploadedArtwork[]=[];
      try {
        for(const [i,page] of document.pages.entries()) {const bitmap=await createImageBitmap(page.blob);const model={blob:page.blob,width:bitmap.width,height:bitmap.height};bitmap.close();files.push(await personalizationModelStorage.uploadModel(model,personalizationModelName(product.nome,undefined,i===1)));}
        const previous=[uploadedModel,uploadedBack,...extraModels].filter((f):f is UploadedArtwork=>Boolean(f));
        const next={...document,title:product.nome,...(printProfile?{printProfile}:{})};
        setUploadedModel(files[0]);setUploadedBack(files[1]||null);setExtraModels(files.slice(2));setBackDraft({mode:files[1]?'automatic':'none'});setGeneratedDocument(next);setMoldText(text);setIsTextDrawerOpen(false);onOpenModel(next);
        void Promise.allSettled(previous.map(f=>personalizationModelStorage.deleteModel(f.path)));
      }catch(e){await Promise.allSettled(files.map(f=>personalizationModelStorage.deleteModel(f.path)));throw e;}
    }} />}
    {isTextDrawerOpen && !binding && (
      <TextCustomizationDrawer
        productName={product.nome}
        template={!uploadedArtwork ? template : undefined}
        printProfile={printProfile}
        previewImage={(requiresArtwork?artworkPreviewUrl:undefined) || baseImage || template?.pages[0] || legacySourceImage || product.imagem || DEFAULT_LOGO_URL}
        previewSource={requiresArtwork?artworkSourceFile || undefined:undefined}
        fieldLabel={product.labelTexto || 'Texto da personalização'}
        initialValue={requiresText?textCustomization:null}
        textRequired={requiresText}
        initialBack={backDraft}
        automaticBack={pdfBack || template?.pages[1]}
        fonts={fonts}
        onClose={() => setIsTextDrawerOpen(false)}
        onSave={async (value, model, back, nextBackDraft) => {
          const nextModel = await personalizationModelStorage.uploadModel(model, personalizationModelName(product.nome, uploadedArtwork?.name));
          let nextBack: UploadedArtwork | null = null;
          let nextBackOriginal: UploadedArtwork | null = null;
          try {
            if (back) nextBack = await personalizationModelStorage.uploadModel(back, personalizationModelName(product.nome, uploadedArtwork?.name, true));
            if (nextBackDraft.mode === 'custom' && nextBackDraft.file?.type === 'application/pdf') nextBackOriginal = await personalizationModelStorage.uploadArtwork(nextBackDraft.file);
          } catch (error) {
            await Promise.allSettled([nextModel, nextBack, nextBackOriginal].filter(Boolean).map(file => personalizationModelStorage.deleteModel(file!.path)));
            throw error;
          }
          const previousModels = [uploadedModel, uploadedBack, uploadedBackOriginal].filter((model): model is UploadedArtwork => Boolean(model));
          const document: PersonalizationDocument = { title: product.nome, ...(printProfile ? { printProfile } : {}), pages: [
            { label: 'Capa', blob: model.blob }, ...(back ? [{ label: 'Contracapa' as const, blob: back.blob }] : []),
          ] };
          setTextCustomization(value);
          setUploadedModel(nextModel);
          setUploadedBack(nextBack);
          setUploadedBackOriginal(nextBackOriginal);
          setBackDraft(nextBackDraft);
          setGeneratedDocument(document);
          setIsTextDrawerOpen(false);
          onOpenModel(document);
          void Promise.allSettled(previousModels.map(model => personalizationModelStorage.deleteModel(model.path)));
        }}
      />
    )}
    </>
  );
}
