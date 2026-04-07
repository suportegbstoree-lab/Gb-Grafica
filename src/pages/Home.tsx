import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ShoppingCart, Phone, Settings, CheckCircle2, ChevronRight, X, Trash2, Package, Clock, Info, LogIn, LogOut, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Product, SiteConfig, CartItem, Order } from '../types';
import { cn } from '../lib/utils';
import { loginWithGoogle, logout, db, collection, setDoc, doc, FirebaseUser, handleFirestoreError, OperationType, storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Upload, FileCheck, Loader2 } from 'lucide-react';

interface HomeProps {
  products: Product[];
  config: SiteConfig;
  categories: string[];
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  orders: Order[];
  user: FirebaseUser | null;
  isAdmin: boolean;
}

export default function Home({ products, config, categories, cart, setCart, orders, user, isAdmin }: HomeProps) {
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isOrdersOpen, setIsOrdersOpen] = useState(false);
  const [isHowToBuyOpen, setIsHowToBuyOpen] = useState(false);
  const [cep, setCep] = useState('');
  const [shippingInfo, setShippingInfo] = useState<{ address: string; price: number } | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

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

  const totalWithShipping = (parseFloat(cart.reduce((acc, i) => acc + (parseFloat(i.preco) * i.quantidade), 0).toFixed(2)) + (shippingInfo?.price || 0)).toFixed(2);

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
    
    setIsCalculating(true); // Reusing loading state for checkout
    try {
      const orderId = Math.random().toString(36).substr(2, 9).toUpperCase();
      
      // 1. Create Preference on Backend
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart,
          orderId
        })
      });
      
      const data = await response.json();
      
      if (data.init_point) {
        // 2. Save Pending Order to Firestore
        const total = totalWithShipping;
        const newOrder: Order = {
          id: orderId,
          userId: user.uid,
          data: new Date().toLocaleString('pt-BR'),
          itens: [...cart],
          total,
          status: 'Pendente'
        };
        await setDoc(doc(db, 'orders', orderId), newOrder);
        
        // 3. Redirect to Mercado Pago
        window.location.href = data.init_point;
      } else {
        throw new Error('Failed to create payment preference');
      }
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Erro ao processar checkout. Tente novamente.');
    } finally {
      setIsCalculating(false);
    }
  };

  // Handle Return from Mercado Pago
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status');
    const orderId = params.get('orderId');

    if (status === 'success' && orderId) {
      setCart([]);
      setIsOrdersOpen(true);
      // Clean URL
      window.history.replaceState({}, document.title, "/");
    }
  }, []);

  const [isLoggingIn, setIsLoggingIn] = useState(false);

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
    <div className="min-h-screen bg-[#0a0a0c] text-white font-sans selection:bg-[#ff4d79]/30 relative overflow-hidden">
      {/* Background Glows */}
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#ff4d79]/10 blur-[120px] rounded-full pointer-events-none z-0"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#7000ff]/10 blur-[120px] rounded-full pointer-events-none z-0"></div>

      {/* Micro Top Bar */}
      <div className="bg-black/60 backdrop-blur-xl px-4 md:px-12 py-2 flex justify-between items-center text-[11px] text-gray-400 border-b border-white/5 relative z-10">
        <div className="flex gap-4 md:gap-6">
          <span className="flex items-center gap-1 hover:text-[#ff4d79] transition-colors cursor-pointer"><Phone size={12} /> {config.telefone1}</span>
          <span className="flex items-center gap-1 hover:text-[#ff4d79] transition-colors cursor-pointer"><Phone size={12} /> {config.telefone2}</span>
        </div>
        <div className="flex gap-4">
          {isAdmin && (
            <Link to="/admin" className="hover:text-[#ff4d79] flex items-center gap-1 transition-colors font-bold">
              <Settings size={12} /> Área Admin
            </Link>
          )}
          {user && (
            <button onClick={() => setIsOrdersOpen(true)} className="hover:text-[#ff4d79] transition-colors flex items-center gap-1">
              <Package size={12} /> Meus Pedidos
            </button>
          )}
          {user ? (
            <button onClick={logout} className="hover:text-[#ff4d79] transition-colors flex items-center gap-1">
              <LogOut size={12} /> Sair ({user.displayName?.split(' ')[0]})
            </button>
          ) : (
            <button 
              onClick={handleLogin} 
              disabled={isLoggingIn}
              className="hover:text-[#ff4d79] transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              {isLoggingIn ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />} 
              {isLoggingIn ? 'Entrando...' : 'Entrar'}
            </button>
          )}
        </div>
      </div>

      {/* Header */}
      <header className="bg-[#111115] px-4 md:px-12 py-6 flex flex-col md:flex-row justify-between items-center gap-6 border-b border-white/5 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#ff4d79] via-[#7000ff] to-[#ff4d79] animate-gradient-x"></div>
        
        <div className="flex items-center group">
          {(config.logo_url || "/logo.png") ? (
            <img 
              src={config.logo_url || "/logo.png"} 
              alt="GB Gráfica" 
              className="h-14 w-auto object-contain transition-transform group-hover:scale-110 drop-shadow-[0_0_15px_rgba(255,77,121,0.2)]" 
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="text-3xl font-black tracking-tighter text-white">
              GB <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff4d79] to-[#7000ff]">GRÁFICA</span>
            </div>
          )}
        </div>
        
        <div className="flex w-full md:w-1/2 max-w-2xl relative group">
          <input 
            type="text" 
            placeholder="O que você deseja imprimir hoje?" 
            className="w-full bg-black/40 border border-white/10 rounded-full px-8 py-4 outline-none focus:border-[#ff4d79] focus:ring-2 focus:ring-[#ff4d79]/20 transition-all text-sm backdrop-blur-sm"
          />
          <button className="absolute right-2 top-2 bottom-2 bg-gradient-to-br from-[#ff4d79] to-[#7000ff] px-6 rounded-full font-bold hover:scale-105 transition-transform flex items-center justify-center shadow-lg shadow-[#ff4d79]/20">
            <Search size={20} />
          </button>
        </div>

        <div className="flex gap-8 items-center text-xs font-bold uppercase tracking-wider">
          <button onClick={() => setIsHowToBuyOpen(true)} className="hover:text-[#ff4d79] transition-colors flex items-center gap-2 group">
            <div className="p-2 bg-white/5 rounded-lg group-hover:bg-[#ff4d79]/10 transition-colors">
              <Info size={20} className="text-[#ff4d79]" />
            </div>
            Como Comprar
          </button>
          <button onClick={() => setIsCartOpen(true)} className="flex items-center gap-2 hover:text-[#ff4d79] transition-colors relative group">
            <div className="p-2 bg-white/5 rounded-lg group-hover:bg-[#ff4d79]/10 transition-colors">
              <ShoppingCart size={20} className="text-[#ff4d79]" />
            </div>
            Meu Carrinho
            {cart.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-gradient-to-r from-[#ff4d79] to-[#7000ff] text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center shadow-lg animate-bounce">
                {cart.reduce((acc, i) => acc + i.quantidade, 0)}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-[#111115]/80 backdrop-blur-md px-4 md:px-12 py-4 flex flex-wrap justify-center gap-4 md:gap-10 border-b border-white/5 sticky top-0 z-30">
        {categories.map((cat) => (
          <a key={cat} href="#" className="text-[11px] font-bold uppercase tracking-widest text-gray-400 hover:text-[#ff4d79] transition-all flex items-center gap-2 group">
            <div className="w-1.5 h-1.5 rounded-full bg-[#ff4d79] group-hover:scale-150 transition-transform shadow-[0_0_8px_#ff4d79]"></div>
            {cat}
          </a>
        ))}
      </nav>

      {/* Banner */}
      <section className="w-full h-[450px] overflow-hidden relative group">
        <img 
          src={config.banner_principal} 
          alt="Banner Principal" 
          className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105" 
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0c] via-transparent to-black/20 flex items-center justify-center">
          <div className="text-center space-y-6 px-4">
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl md:text-6xl font-black tracking-tighter"
            >
              QUALIDADE QUE <br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff4d79] to-[#7000ff]">IMPRESSIONA</span>
            </motion.h1>
            <p className="text-gray-300 max-w-xl mx-auto text-sm md:text-base font-medium">
              Sua gráfica online com os melhores preços e entrega rápida em todo o Brasil.
            </p>
            <button className="bg-white text-black px-10 py-4 rounded-full font-black text-sm uppercase tracking-widest hover:bg-[#ff4d79] hover:text-white transition-all shadow-xl">
              Ver Produtos
            </button>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="bg-[#111115] px-4 md:px-12 py-10 flex flex-wrap justify-center gap-12 md:gap-24 border-b border-white/5">
        <BenefitItem icon="🚚" title={config.beneficio1_titulo} desc={config.beneficio1_desc} />
        <BenefitItem icon="💳" title={config.beneficio2_titulo} desc={config.beneficio2_desc} />
        <BenefitItem icon="✨" title={config.beneficio3_titulo} desc={config.beneficio3_desc} />
      </section>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 md:px-12 py-16 flex flex-col md:flex-row gap-12">
        {/* Sidebar */}
        <aside className="w-full md:w-72 flex-shrink-0">
          <div className="bg-[#15151a] rounded-2xl border border-white/5 overflow-hidden shadow-xl">
            <div className="p-6 border-b border-white/5">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-500">Categorias</h3>
            </div>
            <div className="flex flex-col">
              {categories.map((cat) => (
                <a 
                  key={cat} 
                  href="#" 
                  className="p-5 text-[13px] font-bold uppercase tracking-wider text-gray-400 border-l-4 border-transparent hover:border-[#ff4d79] hover:bg-white/5 hover:text-white transition-all flex justify-between items-center group"
                >
                  {cat} <ChevronRight size={16} className="text-[#ff4d79] opacity-0 group-hover:opacity-100 transition-all translate-x-[-10px] group-hover:translate-x-0" />
                </a>
              ))}
            </div>
          </div>
        </aside>

        {/* Content */}
        <section className="flex-grow">
          <div className="flex items-center gap-4 mb-10">
            <h2 className="text-3xl font-black uppercase tracking-tighter text-white">
              Mais <span className="text-[#ff4d79]">Vendidos</span>
            </h2>
            <div className="h-px flex-grow bg-gradient-to-r from-white/10 to-transparent"></div>
          </div>
          
          <div className="grid grid-cols-1 gap-10">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} onAddToCart={addToCart} />
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-[#08080a] border-t border-white/5 py-20 px-4 md:px-12">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
          <div className="space-y-6">
            <div className="text-2xl font-black tracking-tighter text-white">
              GB <span className="text-[#ff4d79]">GRÁFICA</span>
            </div>
            <p className="text-gray-500 text-sm leading-relaxed">
              Sua parceira ideal para impressões de alta qualidade, brindes e materiais promocionais.
            </p>
          </div>
          <div>
            <h4 className="text-white font-bold mb-6 uppercase text-xs tracking-widest">Atendimento</h4>
            <ul className="space-y-4 text-gray-500 text-sm">
              <li className="flex items-center gap-2 hover:text-white transition-colors cursor-pointer"><Phone size={14} /> {config.telefone1}</li>
              <li className="flex items-center gap-2 hover:text-white transition-colors cursor-pointer"><Phone size={14} /> {config.telefone2}</li>
              <li className="hover:text-white transition-colors cursor-pointer">Segunda a Sexta: 08h às 18h</li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-bold mb-6 uppercase text-xs tracking-widest">Institucional</h4>
            <ul className="space-y-4 text-gray-500 text-sm">
              <li className="hover:text-white transition-colors cursor-pointer">Sobre Nós</li>
              <li className="hover:text-white transition-colors cursor-pointer">Política de Privacidade</li>
              <li className="hover:text-white transition-colors cursor-pointer">Termos de Uso</li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-bold mb-6 uppercase text-xs tracking-widest">Pagamento</h4>
            <div className="flex gap-4 opacity-50 grayscale hover:grayscale-0 hover:opacity-100 transition-all">
              <img src="https://logodownload.org/wp-content/uploads/2014/07/visa-logo-1.png" className="h-4 object-contain" referrerPolicy="no-referrer" />
              <img src="https://logodownload.org/wp-content/uploads/2014/07/mastercard-logo.png" className="h-6 object-contain" referrerPolicy="no-referrer" />
              <img src="https://logodownload.org/wp-content/uploads/2019/06/pix-logo-1.png" className="h-6 object-contain" referrerPolicy="no-referrer" />
            </div>
          </div>
        </div>
        <div className="text-center pt-12 border-t border-white/5 text-gray-600 text-[10px] uppercase tracking-widest space-y-2">
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
                    <div key={item.id} className="flex gap-4 bg-[#1a1a1a] p-4 rounded-lg border border-gray-800">
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
                          <div className="flex items-center gap-2 bg-black rounded-lg border border-gray-800 p-1">
                            <button 
                              onClick={() => updateQuantity(item.id, -1)}
                              className="w-6 h-6 flex items-center justify-center hover:bg-gray-800 rounded transition-colors"
                            >
                              -
                            </button>
                            <span className="text-xs w-4 text-center">{item.quantidade}</span>
                            <button 
                              onClick={() => updateQuantity(item.id, 1)}
                              className="w-6 h-6 flex items-center justify-center hover:bg-gray-800 rounded transition-colors"
                            >
                              +
                            </button>
                          </div>
                          <span className="font-bold text-[#ff4d79]">R$ {(parseFloat(item.preco) * item.quantidade).toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-gray-800 pt-6 space-y-4">
                  {/* Shipping Calculator */}
                  <div className="bg-black p-4 rounded-lg border border-gray-800">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 block mb-2">Calcular Frete (Correios)</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder="00000000" 
                        value={cep}
                        onChange={(e) => setCep(e.target.value.replace(/\D/g, '').slice(0, 8))}
                        className="flex-grow bg-[#1a1a1a] border border-gray-700 rounded px-3 py-2 text-sm outline-none focus:border-[#ff4d79]"
                      />
                      <button 
                        onClick={calculateShipping}
                        disabled={isCalculating || cep.length !== 8}
                        className="bg-gray-800 px-4 py-2 rounded text-xs font-bold hover:bg-gray-700 disabled:opacity-50"
                      >
                        {isCalculating ? '...' : 'OK'}
                      </button>
                    </div>
                    {shippingInfo && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="mt-3 text-[11px] text-gray-400"
                      >
                        <p className="mb-1">📍 {shippingInfo.address}</p>
                        <div className="flex justify-between text-white font-bold">
                          <span>PAC / Sedex</span>
                          <span className="text-[#ff4d79]">R$ {shippingInfo.price.toFixed(2)}</span>
                        </div>
                      </motion.div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-sm text-gray-400">
                      <span>Subtotal</span>
                      <span>R$ {cart.reduce((acc, i) => acc + (parseFloat(i.preco) * i.quantidade), 0).toFixed(2)}</span>
                    </div>
                    {shippingInfo && (
                      <div className="flex justify-between items-center text-sm text-gray-400">
                        <span>Frete</span>
                        <span>R$ {shippingInfo.price.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center pt-2 border-t border-gray-800">
                      <span className="text-gray-400">Total</span>
                      <span className="text-2xl font-bold text-white">
                        R$ {totalWithShipping}
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={checkout}
                    className="w-full bg-[#ff4d79] text-white font-bold py-4 rounded-lg hover:bg-[#e6004c] transition-colors"
                  >
                    FINALIZAR PEDIDO
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
                  <div key={order.id} className="bg-[#1a1a1a] p-6 rounded-xl border border-gray-800 space-y-4">
                    <div className="flex justify-between items-center border-b border-gray-800 pb-4">
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-widest">Pedido #{order.id}</div>
                        <div className="text-xs text-gray-400 mt-1 flex items-center gap-1"><Clock size={12} /> {order.data}</div>
                      </div>
                      <div className="bg-[#ff4d79]/10 text-[#ff4d79] px-3 py-1 rounded-full text-[10px] font-bold uppercase">
                        {order.status}
                      </div>
                    </div>
                    <div className="space-y-2">
                      {order.itens.map((item, idx) => (
                        <div key={idx} className="text-xs space-y-1">
                          <div className="flex justify-between">
                            <span className="text-gray-400">{item.quantidade}x {item.nome}</span>
                            <span>R$ {(parseFloat(item.preco) * item.quantidade).toFixed(2)}</span>
                          </div>
                          {item.textoPersonalizado && (
                            <div className="text-[9px] text-[#ff4d79] font-bold">
                              Personalização: {item.textoPersonalizado}
                            </div>
                          )}
                          {item.arquivoUrl && (
                            <div className="text-[9px] text-green-500 flex items-center gap-1">
                              <FileCheck size={10} /> Arte enviada
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between items-center pt-4 border-t border-dashed border-gray-800">
                      <span className="text-sm font-bold">Total</span>
                      <span className="text-lg font-bold text-[#ff4d79]">R$ {order.total}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Modal>
        )}

        {isHowToBuyOpen && (
          <Modal title="Como Comprar" onClose={() => setIsHowToBuyOpen(false)}>
            <div className="space-y-6 text-sm text-gray-300 leading-relaxed">
              <div className="space-y-2">
                <h4 className="font-bold text-[#ff4d79] flex items-center gap-2">1. Escolha seu Produto</h4>
                <p>Navegue pelas categorias ou use a busca para encontrar o material gráfico que deseja.</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-bold text-[#ff4d79] flex items-center gap-2">2. Configure as Opções</h4>
                <p>Selecione as variações como quantidade, tipo de papel e acabamento. O preço será atualizado automaticamente.</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-bold text-[#ff4d79] flex items-center gap-2">3. Adicione ao Carrinho</h4>
                <p>Clique em "Adicionar ao Carrinho" para salvar sua escolha. Você pode continuar comprando ou finalizar o pedido.</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-bold text-[#ff4d79] flex items-center gap-2">4. Finalize o Pedido</h4>
                <p>No carrinho, revise seus itens e clique em "Finalizar Pedido". Nossa equipe entrará em contato para o envio dos arquivos e pagamento.</p>
              </div>
              <div className="pt-6 border-t border-gray-800 flex justify-center">
                <button 
                  onClick={() => setIsHowToBuyOpen(false)}
                  className="bg-gray-800 px-8 py-3 rounded-lg font-bold hover:bg-gray-700 transition-colors"
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
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="relative bg-[#111111] border border-gray-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="px-8 py-6 border-b border-gray-800 flex justify-between items-center">
          <h3 className="text-xl font-bold text-[#ffb3c6]">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
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
      <div className="text-3xl mb-4 transform group-hover:scale-125 transition-transform duration-300 drop-shadow-[0_0_15px_rgba(255,77,121,0.3)]">{icon}</div>
      <span className="font-black text-xs uppercase tracking-[0.2em] text-white mb-2">{title}</span>
      <span className="text-[10px] text-gray-500 font-medium max-w-[150px]">{desc}</span>
    </div>
  );
}

function ProductCard({ product, onAddToCart }: { product: Product; onAddToCart: (item: CartItem) => void; key?: string }) {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [customText, setCustomText] = useState("");
  
  const handleSelect = (attrName: string, option: string) => {
    setSelections(prev => ({ ...prev, [attrName]: option }));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    setFile(selectedFile);
    setIsUploading(true);
    
    try {
      const fileRef = ref(storage, `artes/${Date.now()}-${selectedFile.name}`);
      await uploadBytes(fileRef, selectedFile);
      const url = await getDownloadURL(fileRef);
      setUploadedUrl(url);
    } catch (error) {
      console.error("Erro no upload:", error);
      alert("Erro ao enviar arquivo.");
    } finally {
      setIsUploading(false);
    }
  };

  const isFullySelected = product.atributos.every(attr => selections[attr.nome]);
  
  const currentPrice = () => {
    if (!isFullySelected) return null;
    const key = product.atributos.map(attr => selections[attr.nome]).join('|');
    return product.combinacoes[key];
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
      arquivoUrl: uploadedUrl || undefined,
      textoPersonalizado: customText || undefined
    });

    // Reset after adding
    setFile(null);
    setUploadedUrl(null);
    setCustomText("");
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="bg-[#15151a] border border-white/5 rounded-3xl p-8 flex flex-col lg:flex-row gap-10 hover:border-[#ff4d79]/30 transition-all group shadow-xl"
    >
      <div className="w-full lg:w-80 flex-shrink-0">
        <div className="aspect-square bg-black rounded-2xl overflow-hidden border border-white/5 relative group-hover:shadow-[0_0_30px_rgba(255,77,121,0.1)] transition-all">
          <img 
            src={product.imagem} 
            alt={product.nome} 
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
        </div>
      </div>

      <div className="flex-grow flex flex-col">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-2xl font-black text-white tracking-tight">{product.nome}</h3>
          <div className="bg-[#ff4d79]/10 text-[#ff4d79] px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">Premium</div>
        </div>
        <p className="text-sm text-gray-400 mb-8 leading-relaxed max-w-2xl font-medium">{product.desc}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 mb-10">
          {product.atributos.map((attr, idx) => {
            const isEnabled = idx === 0 || product.atributos.slice(0, idx).every(a => selections[a.nome]);
            
            return (
              <div key={attr.nome} className={cn("flex flex-col transition-all", !isEnabled && "opacity-20 pointer-events-none grayscale")}>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-4">{attr.nome}</span>
                <div className="flex flex-col gap-2">
                  {attr.opcoes.map(option => (
                    <button
                      key={option}
                      onClick={() => handleSelect(attr.nome, option)}
                      className={cn(
                        "text-left px-4 py-3 rounded-xl border text-xs font-bold transition-all",
                        selections[attr.nome] === option 
                          ? "bg-gradient-to-r from-[#ff4d79] to-[#7000ff] border-transparent text-white shadow-lg shadow-[#ff4d79]/20" 
                          : "bg-black/40 border-white/5 text-gray-400 hover:border-white/20 hover:text-white"
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
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-4">Sua Arte</span>
                <label className={cn(
                  "flex items-center gap-3 px-4 py-4 rounded-xl border border-dashed cursor-pointer transition-all",
                  uploadedUrl ? "border-green-500 bg-green-500/10" : "border-white/10 hover:border-[#ff4d79] bg-black/40"
                )}>
                  <input type="file" className="hidden" onChange={handleFileChange} accept=".pdf,.jpg,.jpeg,.png,.ai,.psd" />
                  {isUploading ? (
                    <Loader2 size={20} className="animate-spin text-[#ff4d79]" />
                  ) : uploadedUrl ? (
                    <FileCheck size={20} className="text-green-500" />
                  ) : (
                    <Upload size={20} className="text-gray-500" />
                  )}
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold text-white">
                      {isUploading ? "Enviando..." : uploadedUrl ? "Arte Pronta!" : "Anexar Arquivo"}
                    </span>
                    <span className="text-[9px] text-gray-500">PDF, JPG, PNG, AI</span>
                  </div>
                </label>
              </div>
            )}

            {product.tipoInput === 'texto' && (
              <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-4">{product.labelTexto || "Personalização"}</span>
                <input 
                  type="text"
                  value={customText}
                  onChange={e => setCustomText(e.target.value)}
                  placeholder="Ex: Nome da Empresa"
                  className="bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-xs outline-none focus:border-[#ff4d79] text-white transition-all"
                />
              </div>
            )}
          </div>
        </div>

        <div className="mt-auto pt-8 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-baseline gap-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Preço</span>
            <div className="text-3xl font-black text-white">
              {price ? (
                <span className="flex items-center gap-1">
                  <span className="text-sm font-normal text-gray-500">R$</span> {price}
                </span>
              ) : (
                <span className="text-sm text-[#ff4d79] font-bold uppercase tracking-widest animate-pulse">
                  {product.preco_base || "Configure as opções"}
                </span>
              )}
            </div>
          </div>
          <button 
            onClick={handleAdd}
            disabled={!isFullySelected}
            className={cn(
              "px-10 py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all",
              isFullySelected 
                ? "bg-white text-black hover:bg-[#ff4d79] hover:text-white shadow-2xl hover:shadow-[#ff4d79]/40 active:scale-95" 
                : "bg-white/5 text-gray-600 cursor-not-allowed"
            )}
          >
            Adicionar ao Carrinho
          </button>
        </div>
      </div>
    </motion.div>
  );
}


