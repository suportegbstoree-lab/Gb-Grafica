import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ShoppingCart, Phone, Settings, CheckCircle2, ChevronRight, X, Trash2, Package, Clock, Info, LogIn, LogOut, User, Loader2, Share2, Facebook, Twitter, MessageCircle, CreditCard, QrCode } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Anuncio, SiteConfig, CartItem, Order, Category, Promocao } from '../types';
import { cn } from '../lib/utils';
import { loginWithGoogle, logout, db, collection, setDoc, doc, FirebaseUser, handleFirestoreError, OperationType, updateDoc } from '../firebase';

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
}

export default function Home({ products, config, categories, promotions, cart, setCart, orders, user, isAdmin }: HomeProps) {
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isOrdersOpen, setIsOrdersOpen] = useState(false);
  const [isHowToBuyOpen, setIsHowToBuyOpen] = useState(false);
  const [cep, setCep] = useState('');
  const [shippingInfo, setShippingInfo] = useState<{ address: string; price: number } | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState<'retirada' | 'entrega'>('entrega');
  const [paymentMethod, setPaymentMethod] = useState<'cartao' | 'pix'>('cartao');
  const [cpf, setCpf] = useState('');
  const [pixData, setPixData] = useState<{ qr_code: string; qr_code_url?: string; qr_code_base64?: string; payment_id: string; total: string } | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);

  const bannerImages = [
    config.banner_principal,
    ...(promotions?.filter(p => p.ativa).map(p => p.imagem) || [])
  ];

  React.useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % bannerImages.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const calculateShipping = async () => {
    if (cep.length !== 8) return;
    setIsCalculating(true);
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await response.json();
      if (data.erro) {
        alert('CEP não encontrado.');
      } else {
        const isSouthEast = ['SP', 'RJ', 'MG', 'ES', 'PR', 'SC', 'RS'].includes(data.uf);
        const price = isSouthEast ? 18.50 : 35.90;
        setShippingInfo({
          address: `${data.logradouro}, ${data.bairro} - ${data.localidade}/${data.uf}`,
          price
        });
      }
    } catch (error) {
      console.error('Erro ao calcular frete:', error);
    } finally {
      setIsCalculating(false);
    }
  };

  const totalWithShipping = (
    parseFloat(cart.reduce((acc, i) => acc + (parseFloat(i.preco) * i.quantidade), 0).toFixed(2)) + 
    (deliveryMethod === 'entrega' ? (shippingInfo?.price || 0) : 0)
  ).toFixed(2);

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
        const newQty = Math.max(1, item.quantidade + delta);
        return { ...item, quantidade: newQty };
      }
      return item;
    }));
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(i => i.id !== id));
  };

  const checkout = async () => {
    if (cart.length === 0) return;
    if (!user) {
      alert("Por favor, faça login para finalizar o pedido.");
      loginWithGoogle();
      return;
    }
    
    setIsCalculating(true);
    const orderId = Math.random().toString(36).substr(2, 9).toUpperCase();
    
    // Sanitize cart items to remove undefined values before saving to Firestore
    const sanitizedCart = cart.map(item => ({
      ...item,
      arquivoUrl: item.arquivoUrl || "",
      textoPersonalizado: item.textoPersonalizado || ""
    }));

    const total = totalWithShipping;
    const shippingCost = deliveryMethod === 'entrega' ? (shippingInfo?.price || 0) : 0;

    const newOrder: Order = {
      id: orderId,
      userId: user.uid,
      data: new Date().toLocaleString('pt-BR'),
      itens: sanitizedCart,
      total,
      status: 'Pendente',
      paymentStatus: 'pendente',
      metodoEntrega: deliveryMethod || 'entrega',
      metodoPagamento: paymentMethod
    };

    try {
      console.log('[DEBUG] Enviando pedido:', orderId);
      
      // Use relative path - ensures same domain/protocol
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart,
          orderId,
          baseUrl: window.location.origin,
          shippingCost,
          paymentMethod,
          userEmail: user.email,
          cpf: cpf.replace(/\D/g, '')
        })
      });

      console.log('[DEBUG] Status:', response.status);

      if (!response.ok) {
        const text = await response.text();
        console.error('[DEBUG] Erro payload:', text);
        throw new Error(`Erro do servidor (${response.status}): ${text.slice(0, 50)}`);
      }

      const data = await response.json();
      
      if (response.ok) {
        // Save to Firestore
        await setDoc(doc(db, 'orders', orderId), newOrder);

        if (data.payment_method === 'pix') {
          setPixData({
            qr_code: data.qr_code,
            qr_code_url: data.qr_code_url,
            qr_code_base64: data.qr_code_base64,
            payment_id: data.payment_id,
            total: data.total
          });
          setCart([]);
          setIsCartOpen(false);
        } else if (data.init_point) {
          window.location.href = data.init_point;
        }
      } else {
        const errorMsg = data.details || data.error || 'Erro desconhecido';
        throw new Error(errorMsg);
      }
    } catch (error: any) {
      console.error('Checkout error:', error);
      alert(`ERRO NO CHECKOUT:\n${error.message}`);
    } finally {
      setIsCalculating(false);
    }
  };

  // Polling for PIX Status
  React.useEffect(() => {
    let interval: NodeJS.Timeout;

    if (pixData && pixData.payment_id) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/payment-status/${pixData.payment_id}`);
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'approved') {
              // Update local orders if needed, we'll probably just close the modal and show success
              alert('Pagamento aprovado com sucesso!');
              setPixData(null);
              setIsOrdersOpen(true);
            }
          }
        } catch (error) {
          console.error('Error polling status:', error);
        }
      }, 5000);
    }

    return () => clearInterval(interval);
  }, [pixData]);

  // Handle Return from Mercado Pago
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status');
    const orderId = params.get('orderId');

    if (status === 'success' && orderId) {
      const updateOrder = async () => {
        try {
          await updateDoc(doc(db, 'orders', orderId), { 
            status: 'Pago',
            paymentStatus: 'pago' 
          });
          setCart([]);
          setIsOrdersOpen(true);
        } catch (error) {
          console.error("Erro ao atualizar status do pedido:", error);
        }
      };
      updateOrder();
      // Clean URL
      window.history.replaceState({}, document.title, "/");
    }
  }, []);

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [fallbackError, setFallbackError] = useState(false);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      console.log('Iniciando login...');
      await loginWithGoogle();
      console.log('Login concluído com sucesso');
    } catch (error: any) {
      console.error('Login error:', error);
      if (error.code === 'auth/popup-blocked') {
        alert('O popup de login foi bloqueado pelo seu navegador. Por favor, permita popups para este site.');
      } else if (error.code === 'auth/cancelled-popup-request') {
        // User closed the popup, no need to alert
      } else {
        alert('Erro ao fazer login: ' + (error.message || 'Erro desconhecido'));
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fcfcfd] text-gray-900 font-sans selection:bg-pink-100 relative overflow-hidden">
      {/* Background Glows (Subtle) */}
      <div className="fixed top-[-10%] left-[-10%] w-[70%] h-[70%] bg-pink-100/30 blur-[180px] rounded-full pointer-events-none z-0"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[70%] h-[70%] bg-purple-100/30 blur-[180px] rounded-full pointer-events-none z-0"></div>

      {/* Micro Top Bar */}
      <div className="bg-[#d14d8c] px-4 md:px-12 py-3 flex justify-between items-center text-[11px] text-white relative z-40">
        <div className="flex gap-4 md:gap-8">
          <span className="flex items-center gap-2 hover:text-pink-100 transition-colors cursor-pointer font-bold"><Phone size={14} /> {config.telefone1}</span>
          <span className="flex items-center gap-2 hover:text-pink-100 transition-colors cursor-pointer font-bold"><Phone size={14} /> {config.telefone2}</span>
        </div>
        <div className="flex gap-8 items-center">
          {isAdmin && (
            <Link to="/admin" className="hover:text-pink-100 flex items-center gap-2 transition-colors font-bold">
              <Settings size={14} /> Área Admin
            </Link>
          )}
          {user && (
            <button onClick={() => setIsOrdersOpen(true)} className="hover:text-pink-100 transition-colors flex items-center gap-2 font-bold">
              <Package size={14} /> Meus Pedidos
            </button>
          )}
          {user ? (
            <button onClick={logout} className="hover:text-pink-100 transition-colors flex items-center gap-2 font-bold">
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
              src={config.logo_url} 
              alt="GB Gráfica" 
              className="h-24 w-auto object-contain transition-transform group-hover:scale-105" 
              referrerPolicy="no-referrer"
              onError={() => setLogoError(true)}
            />
          ) : !fallbackError ? (
            <img 
              src="/logo.png" 
              alt="GB Gráfica" 
              className="h-24 w-auto object-contain transition-transform group-hover:scale-105" 
              referrerPolicy="no-referrer"
              onError={() => setFallbackError(true)}
            />
          ) : (
            <div className="flex flex-col">
              <div className="text-4xl font-black tracking-tighter text-[#d14d8c] leading-none">GB</div>
              <div className="text-4xl font-black tracking-tighter text-[#5dc1c1] leading-none">GRÁFICA</div>
            </div>
          )}
        </div>
        
        <div className="flex w-full md:w-1/2 max-w-xl relative group">
          <input 
            type="text" 
            placeholder="Buscar" 
            className="w-full bg-white border-2 border-gray-100 rounded-full px-8 py-4 outline-none focus:border-pink-300 transition-all text-sm shadow-sm"
          />
          <button className="absolute right-4 top-1/2 -translate-y-1/2 text-[#5dc1c1] hover:scale-110 transition-transform">
            <Search size={28} />
          </button>
        </div>

        <div className="flex gap-12 items-center">
          <button onClick={() => setIsOrdersOpen(true)} className="flex items-center gap-3 group">
            <div className="w-16 h-16 rounded-full border-2 border-[#d14d8c]/30 flex items-center justify-center bg-white group-hover:border-[#d14d8c] transition-all shadow-sm">
              <Package size={28} className="text-[#d14d8c]" />
            </div>
            <span className="text-[11px] font-black uppercase tracking-widest text-[#d14d8c]">Meus Pedidos</span>
          </button>
          
          <button onClick={() => setIsCartOpen(true)} className="flex items-center gap-3 group relative">
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
      <nav className="bg-white px-4 md:px-12 py-4 flex flex-wrap justify-center gap-x-8 md:gap-x-12 gap-y-4 relative z-30 shadow-sm">
        {categories.map((cat, idx) => (
          <motion.a 
            key={cat.id} 
            href={`#${cat.nome}`} 
            whileHover={{ scale: 1.05 }}
            className="flex items-center gap-2 group transition-all"
          >
            <div className="w-8 h-8 flex items-center justify-center transition-all">
              {cat.icon ? (
                <img src={cat.icon} className="w-full h-full object-contain grayscale group-hover:grayscale-0 opacity-60 group-hover:opacity-100 transition-all" referrerPolicy="no-referrer" />
              ) : (
                <Package size={20} className="text-gray-400 group-hover:text-[#d14d8c]" />
              )}
            </div>
            <span className="text-[10px] font-black uppercase tracking-tight text-gray-400 group-hover:text-[#d14d8c] transition-colors leading-none">
              {cat.nome.split(' ').map((word, i) => (
                <span key={i} className={cn("block", i === 0 && word.length < 10 ? "inline" : "block")}>
                  {word} {i === 0 && word.length < 10 && ' '}
                </span>
              ))}
            </span>
          </motion.a>
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
          PROMOÇÃO DESCONTO PROGRESSIVO - ATÉ 30% OFF - CONFIRA O REGULAMENTO
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
      <section className="w-full h-[500px] overflow-hidden relative group z-10">
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
              src={bannerImages[currentSlide]} 
              alt={`Banner ${currentSlide + 1}`} 
              className="w-full h-full object-cover" 
              referrerPolicy="no-referrer"
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
                {config.banner_titulo ? (
                  <>
                    {config.banner_titulo.split('<br/>').map((line, i) => (
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
              <button className="bg-gray-900 text-white px-12 py-5 rounded-full font-black text-sm uppercase tracking-widest hover:bg-pink-500 transition-all shadow-2xl shadow-pink-100 hover:scale-105 active:scale-95">
                {config.banner_botao || "Ver Produtos"}
              </button>
            </motion.div>
          </div>
        </div>

        {/* Carousel Indicators */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-3 z-20">
          {bannerImages.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentSlide(idx)}
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
      <main className="max-w-7xl mx-auto px-4 md:px-12 py-16 flex flex-col md:flex-row gap-12">
        {/* Sidebar */}
        <aside className="w-full md:w-72 flex-shrink-0">
          <div className="bg-white/60 backdrop-blur-sm rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
            <div className="p-6 border-b border-gray-100 bg-gray-50/30">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-400">Categorias</h3>
            </div>
            <div className="flex flex-col">
              {categories.map((cat) => (
                <a 
                  key={cat.id} 
                  href={`#${cat.nome}`} 
                  className="p-5 text-[13px] font-bold uppercase tracking-wider text-gray-500 border-l-4 border-transparent hover:border-pink-400 hover:bg-pink-50/20 hover:text-pink-600 transition-all flex justify-between items-center group"
                >
                  {cat.nome} <ChevronRight size={16} className="text-pink-400 opacity-0 group-hover:opacity-100 transition-all translate-x-[-10px] group-hover:translate-x-0" />
                </a>
              ))}
            </div>
          </div>
        </aside>

        {/* Content */}
        <section className="flex-grow">
          <div className="flex items-center gap-4 mb-10">
            <h2 className="text-3xl font-black uppercase tracking-tighter text-gray-900">
              Mais <span className="text-pink-500">Vendidos</span>
            </h2>
            <div className="h-px flex-grow bg-gradient-to-r from-gray-100 to-transparent"></div>
          </div>
          
          <div className="grid grid-cols-1 gap-10">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} onAddToCart={addToCart} />
            ))}
          </div>
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
              <li className="flex items-center gap-2 hover:text-pink-500 transition-colors cursor-pointer"><Phone size={14} /> {config.telefone1}</li>
              <li className="flex items-center gap-2 hover:text-pink-500 transition-colors cursor-pointer"><Phone size={14} /> {config.telefone2}</li>
              <li onClick={() => setIsHowToBuyOpen(true)} className="hover:text-pink-500 transition-colors cursor-pointer">Como Comprar</li>
              <li className="hover:text-pink-500 transition-colors cursor-pointer">Segunda a Sexta: 08h às 18h</li>
            </ul>
          </div>
          <div>
            <h4 className="text-gray-900 font-black mb-6 uppercase text-xs tracking-widest">Institucional</h4>
            <ul className="space-y-4 text-gray-500 text-sm font-medium">
              <li className="hover:text-pink-500 transition-colors cursor-pointer">Sobre Nós</li>
              <li className="hover:text-pink-500 transition-colors cursor-pointer">Política de Privacidade</li>
              <li className="hover:text-pink-500 transition-colors cursor-pointer">Termos de Uso</li>
            </ul>
          </div>
          <div>
            <h4 className="text-gray-900 font-black mb-6 uppercase text-xs tracking-widest">Pagamento</h4>
            <div className="flex gap-4 opacity-50 grayscale hover:grayscale-0 hover:opacity-100 transition-all">
              <img src="https://logodownload.org/wp-content/uploads/2014/07/visa-logo-1.png" className="h-4 object-contain" referrerPolicy="no-referrer" />
              <img src="https://logodownload.org/wp-content/uploads/2014/07/mastercard-logo.png" className="h-6 object-contain" referrerPolicy="no-referrer" />
              <img src="https://logodownload.org/wp-content/uploads/2019/06/pix-logo-1.png" className="h-6 object-contain" referrerPolicy="no-referrer" />
            </div>
          </div>
        </div>
        <div className="text-center pt-12 border-t border-gray-100 text-gray-400 text-[10px] uppercase tracking-widest space-y-2 font-black">
          <p>© 2026 GB Gráfica. Todos os direitos reservados.</p>
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
                <div className="max-h-[60vh] overflow-y-auto space-y-4 pr-2">
                  {cart.map((item) => (
                    <div key={item.id} className="flex gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
                      <img src={item.imagem} className="w-16 h-16 object-cover rounded" referrerPolicy="no-referrer" />
                      <div className="flex-grow">
                        <div className="flex justify-between items-start">
                          <h4 className="font-bold text-sm">{item.nome}</h4>
                          <button onClick={() => removeFromCart(item.id)} className="text-gray-500 hover:text-red-500">
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="text-[10px] text-gray-400 mt-1">
                          {Object.entries(item.selecoes).map(([k, v]) => `${k}: ${v}`).join(' | ')}
                        </div>
                        <div className="flex justify-between items-center mt-2">
                          <div className="flex items-center gap-2 bg-gray-50 rounded-lg border border-gray-100 p-1">
                            <button 
                              onClick={() => updateQuantity(item.id, -1)}
                              className="w-6 h-6 flex items-center justify-center hover:bg-gray-200 rounded transition-colors"
                            >
                              -
                            </button>
                            <span className="text-xs w-4 text-center font-bold">{item.quantidade}</span>
                            <button 
                              onClick={() => updateQuantity(item.id, 1)}
                              className="w-6 h-6 flex items-center justify-center hover:bg-gray-200 rounded transition-colors"
                            >
                              +
                            </button>
                          </div>
                          <span className="font-bold text-pink-500">R$ {(parseFloat(item.preco) * item.quantidade).toFixed(2)}</span>
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

                  {/* Forma de Pagamento */}
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <label className="text-[10px] uppercase tracking-widest text-gray-400 block mb-3 font-black">Forma de Pagamento</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => setPaymentMethod('cartao')}
                        className={cn(
                          "px-4 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all flex flex-col items-center gap-2",
                          paymentMethod === 'cartao' 
                            ? "bg-white border-pink-400 text-pink-500 shadow-sm" 
                            : "bg-white border-gray-100 text-gray-400"
                        )}
                      >
                        <CreditCard size={16} /> Cartão / Boleto
                      </button>
                      <button 
                        onClick={() => setPaymentMethod('pix')}
                        className={cn(
                          "px-4 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all flex flex-col items-center gap-2",
                          paymentMethod === 'pix' 
                            ? "bg-white border-pink-400 text-pink-500 shadow-sm" 
                            : "bg-white border-gray-100 text-gray-400"
                        )}
                      >
                        <QrCode size={16} /> PIX (Sem Taxas)
                      </button>
                    </div>
                  </div>

                  {/* Shipping Calculator */}
                  {deliveryMethod === 'entrega' && (
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                      <label className="text-[10px] uppercase tracking-widest text-gray-400 block mb-2 font-black">Calcular Frete (Correios)</label>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          placeholder="00000000" 
                          value={cep}
                          onChange={(e) => setCep(e.target.value.replace(/\D/g, '').slice(0, 8))}
                          className="flex-grow bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-pink-400"
                        />
                        <button 
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
                          <p className="mb-1">📍 {shippingInfo.address}</p>
                          <div className="flex justify-between text-gray-900 font-bold">
                            <span>PAC / Sedex</span>
                            <span className="text-pink-500">R$ {shippingInfo.price.toFixed(2)}</span>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  )}

                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <label className="text-[10px] uppercase tracking-widest text-gray-400 block mb-2 font-black">CPF do Pagador (Obrigatório PagBank)</label>
                    <input 
                      type="text" 
                      placeholder="000.000.000-00" 
                      value={cpf}
                      onChange={(e) => {
                        let val = e.target.value.replace(/\D/g, '').slice(0, 11);
                        if (val.length > 3 && val.length <= 6) val = val.slice(0, 3) + '.' + val.slice(3);
                        else if (val.length > 6 && val.length <= 9) val = val.slice(0, 3) + '.' + val.slice(3, 6) + '.' + val.slice(6);
                        else if (val.length > 9) val = val.slice(0, 3) + '.' + val.slice(3, 6) + '.' + val.slice(6, 9) + '-' + val.slice(9);
                        setCpf(val);
                      }}
                      className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-pink-400"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-sm text-gray-500">
                      <span>Subtotal</span>
                      <span>R$ {cart.reduce((acc, i) => acc + (parseFloat(i.preco) * i.quantidade), 0).toFixed(2)}</span>
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
                        R$ {totalWithShipping}
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={checkout}
                    disabled={isCalculating || (deliveryMethod === 'entrega' && !shippingInfo) || cpf.replace(/\D/g, '').length !== 11}
                    className="w-full bg-gray-900 text-white font-black py-4 rounded-xl hover:bg-pink-500 transition-all shadow-xl shadow-gray-100 disabled:opacity-50"
                  >
                    {isCalculating ? <Loader2 className="animate-spin mx-auto" /> : "FINALIZAR PEDIDO"}
                  </button>
                </div>

              </div>
            )}
          </Modal>
        )}

        {isOrdersOpen && (
          <Modal title="Meus Pedidos" onClose={() => setIsOrdersOpen(false)}>
            {orders.length === 0 ? (
              <div className="py-12 text-center text-gray-500">Você ainda não possui pedidos.</div>
            ) : (
              <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
                {orders.map((order) => (
                  <div key={order.id} className="bg-gray-50 p-6 rounded-2xl border border-gray-100 space-y-4">
                    <div className="flex justify-between items-center border-b border-gray-200 pb-4">
                      <div>
                        <div className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Pedido #{order.id}</div>
                        <div className="text-xs text-gray-500 mt-1 flex items-center gap-1"><Clock size={12} /> {order.data}</div>
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
                            {order.metodoPagamento === 'pix' ? (
                              <><QrCode size={10} className="stroke-[2.5px]" /> Pago via PIX</>
                            ) : (
                              <><CreditCard size={10} className="stroke-[2.5px]" /> Cartão / Boleto</>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="bg-pink-50 text-pink-500 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
                        {order.status}
                      </div>
                    </div>
                    <div className="space-y-2">
                      {order.itens.map((item, idx) => (
                        <div key={idx} className="text-xs space-y-1">
                          <div className="flex justify-between">
                            <span className="text-gray-600 font-medium">{item.quantidade}x {item.nome}</span>
                            <span className="text-gray-900 font-bold">R$ {(parseFloat(item.preco) * item.quantidade).toFixed(2)}</span>
                          </div>
                          {item.textoPersonalizado && (
                            <div className="text-[9px] text-pink-500 font-black uppercase tracking-wider">
                              Personalização: {item.textoPersonalizado}
                            </div>
                          )}
                          {item.arquivoUrl && (
                            <div className="text-[9px] text-green-500 flex items-center gap-1 font-black uppercase tracking-wider">
                              <CheckCircle2 size={10} /> Arte enviada
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between items-center pt-4 border-t border-dashed border-gray-200">
                      <span className="text-sm font-black text-gray-900 uppercase tracking-widest">Total</span>
                      <span className="text-lg font-black text-pink-500">R$ {order.total}</span>
                    </div>
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
                <p>No carrinho, revise seus itens e clique em "Finalizar Pedido". Nossa equipe entrará em contato para o envio dos arquivos e pagamento.</p>
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

        {pixData && (
          <Modal title="Pague com PIX" onClose={() => setPixData(null)}>
            <div className="space-y-6 text-center">
              <div className="p-8 bg-pink-50 rounded-[40px] border border-pink-100 flex flex-col items-center gap-6 relative overflow-hidden">
                {/* Decorative Elements */}
                <div className="absolute top-0 right-0 w-24 h-24 bg-pink-200/20 blur-3xl rounded-full"></div>
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-purple-200/20 blur-3xl rounded-full"></div>

                <div className="relative">
                  <div className="bg-white p-6 rounded-3xl shadow-xl shadow-pink-200/20 relative z-10 scale-105">
                    {pixData.qr_code_url ? (
                      <img 
                        src={pixData.qr_code_url} 
                        alt="QR Code PIX" 
                        className="w-48 h-48 mx-auto"
                        referrerPolicy="no-referrer"
                      />
                    ) : pixData.qr_code_base64 && (
                      <img 
                        src={`data:image/png;base64,${pixData.qr_code_base64}`} 
                        alt="QR Code PIX" 
                        className="w-48 h-48 mx-auto"
                      />
                    )}
                  </div>
                </div>

                <div className="space-y-2 relative z-10">
                  <div className="text-gray-900 font-black text-lg tracking-tight">R$ {pixData.total}</div>
                  <div className="text-gray-500 font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2">
                    <QrCode size={14} className="text-pink-500" /> Escaneie para Pagar
                  </div>
                </div>
              </div>

              <div className="space-y-4 text-left">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-black block mb-2 px-1">Código Copia e Cola</label>
                  <div className="flex gap-2">
                    <input 
                      readOnly 
                      value={pixData.qr_code} 
                      className="flex-grow bg-gray-50 border border-gray-100 rounded-2xl px-4 py-4 text-xs font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-pink-500/20 transition-all"
                    />
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(pixData.qr_code);
                        alert('Código copiado!');
                      }}
                      className="bg-gray-900 text-white px-6 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-pink-500 transition-all shadow-lg shadow-gray-200 active:scale-95"
                    >
                      Copiar
                    </button>
                  </div>
                </div>
              </div>

              <div className="pt-4 space-y-4 border-t border-gray-100">
                <div className="flex items-center justify-center gap-3 text-pink-500 font-black text-[11px] uppercase tracking-widest animate-pulse">
                  <div className="w-2 h-2 bg-pink-500 rounded-full"></div>
                  Aguardando Confirmação automática...
                </div>
                <p className="text-[11px] text-gray-400 font-medium px-4 leading-relaxed">
                  Não é necessário enviar comprovante. Nosso sistema identifica o pagamento em segundos através do PagBank.
                </p>
                <button 
                  onClick={() => setPixData(null)}
                  className="w-full bg-white border-2 border-gray-900 text-gray-900 py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-gray-50 transition-all active:scale-[0.98]"
                >
                  Fechar Janela
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Floating Chat Button */}
      <motion.button 
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => window.open(`https://wa.me/${config.telefone1.replace(/\D/g, '')}`, '_blank')}
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-white/60 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="relative bg-white border border-gray-100 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden"
      >
        <div className="px-8 py-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <h3 className="text-xl font-black text-gray-900 tracking-tight">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-pink-500 transition-colors">
            <X size={24} />
          </button>
        </div>
        <div className="p-8">
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

function ProductCard({ product, onAddToCart }: { product: Anuncio; onAddToCart: (item: CartItem) => void; key?: string }) {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [customText, setCustomText] = useState("");
  const [activeImage, setActiveImage] = useState(product.imagem);
  
  const allImages = [product.imagem, ...(product.imagens || [])];

  // Sincroniza a imagem ativa se o produto mudar (ex: edição no admin)
  React.useEffect(() => {
    setActiveImage(product.imagem);
  }, [product.imagem]);

  const handleSelect = (attrName: string, option: string) => {
    setSelections(prev => ({ ...prev, [attrName]: option }));
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadedUrl(e.target.value);
  };

  const isFullySelected = product.atributos.every(attr => selections[attr.nome]);
  
  const currentPrice = () => {
    if (!isFullySelected) return null;
    const key = product.atributos.map(attr => selections[attr.nome]).join('|');
    const comboPrice = product.combinacoes[key];
    return comboPrice || product.preco_base;
  };

  const price = currentPrice();

  const handleAdd = () => {
    if (!isFullySelected || !price) return;
    
    const cartId = `${product.id}-${Object.values(selections).join('-')}`;
    onAddToCart({
      id: cartId,
      productId: product.id,
      nome: product.nome,
      imagem: product.imagem,
      preco: price,
      selecoes: { ...selections },
      quantidade: 1,
      arquivoUrl: uploadedUrl || "",
      textoPersonalizado: customText || ""
    });

    // Reset after adding
    setUploadedUrl(null);
    setCustomText("");
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="bg-white/60 backdrop-blur-sm border border-gray-100 rounded-[2.5rem] p-8 flex flex-col lg:flex-row gap-10 hover:border-pink-200 transition-all group shadow-sm hover:shadow-md"
    >
      <div className="w-full lg:w-80 flex-shrink-0 flex flex-col gap-4">
        <div className="aspect-square bg-gray-50 rounded-2xl overflow-hidden border border-gray-100 relative group-hover:shadow-[0_0_30px_rgba(244,114,182,0.1)] transition-all">
          <img 
            src={activeImage} 
            alt={product.nome} 
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
            referrerPolicy="no-referrer"
            onError={(e) => {
              (e.target as HTMLImageElement).src = "https://picsum.photos/seed/error/400/400?blur=2";
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-pink-50/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
        </div>

        {allImages.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {allImages.map((img, idx) => (
              <button 
                key={idx}
                onClick={() => setActiveImage(img)}
                className={cn(
                  "w-16 h-16 rounded-lg overflow-hidden border-2 flex-shrink-0 transition-all",
                  activeImage === img ? "border-pink-400 scale-105 shadow-md" : "border-transparent opacity-60 hover:opacity-100"
                )}
              >
                <img src={img} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
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
                      key={option}
                      onClick={() => handleSelect(attr.nome, option)}
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
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4">Sua Arte (Link)</span>
                <input 
                  type="text"
                  value={uploadedUrl || ""}
                  onChange={handleUrlChange}
                  placeholder="Cole o link da sua arte aqui"
                  className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-4 text-xs outline-none focus:border-pink-400 text-gray-900 transition-all mb-2"
                />
                <p className="text-[9px] text-gray-400 leading-tight">
                  Você pode usar sites como PostImages ou Imgur. Se preferir, pode enviar pelo WhatsApp após a compra.
                </p>
              </div>
            )}

            {product.tipoInput === 'texto' && (
              <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4">{product.labelTexto || "Personalização"}</span>
                <input 
                  type="text"
                  value={customText}
                  onChange={e => setCustomText(e.target.value)}
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
                {price ? (
                  <span className="flex items-center gap-1">
                    <span className="text-sm font-normal text-gray-400">R$</span> {price}
                  </span>
                ) : (
                  <span className="text-sm text-pink-500 font-bold uppercase tracking-widest animate-pulse">
                    {product.preco_base || "Selecione as opções"}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 bg-gray-50/50 p-1.5 rounded-2xl border border-gray-100">
              <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest px-2">Compartilhar</span>
              <button 
                onClick={() => {
                  const text = `Confira esse produto: ${product.nome} - ${window.location.origin}`;
                  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                }}
                className="p-2 text-green-500 hover:scale-110 transition-transform"
                title="WhatsApp"
              >
                <MessageCircle size={16} />
              </button>
              <button 
                onClick={() => {
                  const url = window.location.href;
                  window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
                }}
                className="p-2 text-blue-600 hover:scale-110 transition-transform"
                title="Facebook"
              >
                <Facebook size={16} />
              </button>
              <button 
                onClick={() => {
                  const url = window.location.href;
                  const text = `Confira esse produto: ${product.nome}`;
                  window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank');
                }}
                className="p-2 text-sky-500 hover:scale-110 transition-transform"
                title="Twitter"
              >
                <Twitter size={16} />
              </button>
              <button 
                onClick={() => {
                  const url = window.location.href;
                  navigator.clipboard.writeText(url);
                  alert('Link copiado!');
                }}
                className="p-2 text-gray-400 hover:text-pink-500 transition-all"
                title="Copiar Link"
              >
                <Share2 size={16} />
              </button>
            </div>
          </div>

          <button 
            onClick={handleAdd}
            disabled={!isFullySelected}
            className={cn(
              "w-full flex items-center justify-center gap-3 px-10 py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all",
              isFullySelected 
                ? "bg-gray-900 text-white hover:bg-[#d14d8c] shadow-xl hover:shadow-pink-100 active:scale-95 cursor-pointer" 
                : "bg-gray-100 text-gray-400 cursor-not-allowed opacity-60"
            )}
          >
            <ShoppingCart size={18} />
            Adicionar ao Carrinho
          </button>
        </div>
      </div>
    </motion.div>
  );
}


