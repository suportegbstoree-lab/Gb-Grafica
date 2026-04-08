import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Edit2, Save, X, ArrowLeft, Package, Layout, List, Settings, LogOut, Clock, Upload, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Product, SiteConfig, Order, Category } from '../types';
import { cn } from '../lib/utils';
import { db, setDoc, doc, deleteDoc, updateDoc, handleFirestoreError, OperationType, logout, collection, getDocs, auth } from '../firebase';
import { INITIAL_PRODUCTS, INITIAL_CATEGORIES } from '../constants';

interface AdminProps {
  products: Product[];
  config: SiteConfig;
  categories: Category[];
  orders: Order[];
}

export default function Admin({ products, config, categories, orders }: AdminProps) {
  const [activeTab, setActiveTab] = useState<'products' | 'categories' | 'config' | 'orders'>('products');
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const [newCategory, setNewCategory] = useState({ nome: '', icon: '' });
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [newAttr, setNewAttr] = useState({ nome: '', opcoes: '' });
  const [showAttrForm, setShowAttrForm] = useState(false);

  const bootstrapData = async () => {
    setIsBootstrapping(true);
    try {
      // Categories
      for (const cat of INITIAL_CATEGORIES) {
        const id = cat.nome.toLowerCase().replace(/\s+/g, '-');
        await setDoc(doc(db, 'categories', id), cat);
      }
      // Products
      for (const prod of INITIAL_PRODUCTS) {
        const id = prod.id || Math.random().toString(36).substr(2, 9);
        await setDoc(doc(db, 'products', id), { ...prod, id });
      }
      setSuccessMessage('Dados iniciais carregados com sucesso!');
    } catch (error) {
      console.error('Error bootstrapping data:', error);
    } finally {
      setIsBootstrapping(false);
    }
  };

  // Config Handlers
  const handleSaveConfig = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const updatedConfig: SiteConfig = {
      ...config,
      logo_url: formData.get('logo_url') as string,
      telefone1: formData.get('telefone1') as string,
      telefone2: formData.get('telefone2') as string,
      banner_principal: formData.get('banner_principal') as string,
      banner_titulo: formData.get('banner_titulo') as string,
      banner_subtitulo: formData.get('banner_subtitulo') as string,
      banner_botao: formData.get('banner_botao') as string,
      beneficio1_titulo: formData.get('beneficio1_titulo') as string,
      beneficio1_desc: formData.get('beneficio1_desc') as string,
      beneficio2_titulo: formData.get('beneficio2_titulo') as string,
      beneficio2_desc: formData.get('beneficio2_desc') as string,
      beneficio3_titulo: formData.get('beneficio3_titulo') as string,
      beneficio3_desc: formData.get('beneficio3_desc') as string,
    };
    
    try {
      await setDoc(doc(db, 'config', 'main'), updatedConfig);
      setSuccessMessage('Configurações salvas com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'config/main');
    }
  };

  // Category Handlers
  const handleAddCategory = async () => {
    if (!newCategory.nome) return;
    const id = newCategory.nome.toLowerCase().replace(/\s+/g, '-');
    try {
      await setDoc(doc(db, 'categories', id), { nome: newCategory.nome, icon: newCategory.icon });
      setNewCategory({ nome: '', icon: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `categories/${id}`);
    }
  };

  const handleDeleteCategory = async (catId: string) => {
    try {
      await deleteDoc(doc(db, 'categories', catId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `categories/${catId}`);
    }
  };

  // Product Handlers
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    
    const id = editingProduct.id || Math.random().toString(36).substr(2, 9);
    const productToSave = { ...editingProduct, id } as Product;
    
    try {
      await setDoc(doc(db, 'products', id), productToSave);
      setEditingProduct(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `products/${id}`);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    // Removido confirm() devido a restrições de iFrame
    try {
      await deleteDoc(doc(db, 'products', id));
      setSuccessMessage('Produto excluído com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `products/${id}`);
    }
  };

  // Order Handlers
  const handleStatusChange = async (orderId: string, newStatus: string) => {
    try {
      await updateDoc(doc(db, 'orders', orderId), { status: newStatus });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#060606] text-white flex">
      {/* Sidebar Admin */}
      <aside className="w-64 bg-[#111111] border-r border-gray-800 flex flex-col">
        <div className="p-8">
          <div className="text-xl font-black tracking-tighter text-white mb-8">
            GB <span className="text-[#ff4d79]">ADMIN</span>
          </div>
          
          <nav className="space-y-2">
            <button 
              onClick={() => setActiveTab('products')}
              className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors", activeTab === 'products' ? "bg-[#ff4d79] text-white" : "text-gray-400 hover:bg-gray-800")}
            >
              <Layout size={18} /> Produtos
            </button>
            <button 
              onClick={() => setActiveTab('categories')}
              className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors", activeTab === 'categories' ? "bg-[#ff4d79] text-white" : "text-gray-400 hover:bg-gray-800")}
            >
              <List size={18} /> Categorias
            </button>
            <button 
              onClick={() => setActiveTab('orders')}
              className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors", activeTab === 'orders' ? "bg-[#ff4d79] text-white" : "text-gray-400 hover:bg-gray-800")}
            >
              <Package size={18} /> Pedidos
            </button>
            <button 
              onClick={() => setActiveTab('config')}
              className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors", activeTab === 'config' ? "bg-[#ff4d79] text-white" : "text-gray-400 hover:bg-gray-800")}
            >
              <Settings size={18} /> Configurações
            </button>
          </nav>
        </div>
        
        <div className="mt-auto p-8 space-y-4">
          <Link to="/" className="flex items-center gap-2 text-xs text-gray-500 hover:text-white transition-colors">
            <ArrowLeft size={14} /> Voltar para a Loja
          </Link>
          <button onClick={logout} className="flex items-center gap-2 text-xs text-red-500 hover:text-red-400 transition-colors">
            <LogOut size={14} /> Sair do Admin
          </button>
        </div>
      </aside>

      {/* Main Content Admin */}
      <main className="flex-grow p-12 overflow-y-auto max-h-screen">
        {activeTab === 'products' && (
          <div className="space-y-8">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <h2 className="text-2xl font-bold">Gerenciar Produtos</h2>
                {products.length === 0 && (
                  <button 
                    onClick={bootstrapData}
                    disabled={isBootstrapping}
                    className="text-[10px] bg-blue-500/10 text-blue-400 px-3 py-1 rounded border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
                  >
                    {isBootstrapping ? 'Carregando...' : 'Carregar Dados Iniciais'}
                  </button>
                )}
              </div>
              <button 
                onClick={() => setEditingProduct({ nome: '', desc: '', categoria: categories[0]?.nome || '', imagem: '', preco_base: '', atributos: [], combinacoes: {} })}
                className="bg-[#ff4d79] px-6 py-2 rounded-full font-bold text-sm flex items-center gap-2 hover:bg-[#e6004c] transition-colors"
              >
                <Plus size={18} /> Novo Produto
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {products.map(p => (
                <div key={p.id} className="bg-[#111111] border border-gray-800 rounded-xl overflow-hidden group">
                  <div className="aspect-video bg-gray-900 relative">
                    <img src={p.imagem} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                      <button onClick={() => setEditingProduct(p)} className="p-3 bg-white text-black rounded-full hover:scale-110 transition-transform">
                        <Edit2 size={18} />
                      </button>
                      <button onClick={() => handleDeleteProduct(p.id)} className="p-3 bg-red-500 text-white rounded-full hover:scale-110 transition-transform">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="text-[10px] text-[#ff4d79] font-bold uppercase tracking-widest mb-1">{p.categoria}</div>
                    <h3 className="font-bold mb-2">{p.nome}</h3>
                    <div className="text-xs text-gray-500 line-clamp-2">{p.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="max-w-4xl space-y-8">
            <h2 className="text-2xl font-bold">Categorias e Navegação</h2>
            
            <div className="bg-[#111111] border border-gray-800 p-6 rounded-xl space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Nome da Categoria</label>
                  <input 
                    type="text" 
                    value={newCategory.nome}
                    onChange={(e) => setNewCategory({ ...newCategory, nome: e.target.value })}
                    placeholder="Ex: Etiquetas p/ Objetos"
                    className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-500">URL do Ícone (PNG)</label>
                  <input 
                    type="text" 
                    value={newCategory.icon}
                    onChange={(e) => setNewCategory({ ...newCategory, icon: e.target.value })}
                    placeholder="https://cdn-icons-png.flaticon.com/..."
                    className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                  />
                  <p className="text-[10px] text-gray-500 mt-1">Cole o link da imagem (ex: PostImages ou Imgur)</p>
                </div>
              </div>
              <button onClick={handleAddCategory} className="bg-[#ff4d79] px-8 py-3 rounded-lg font-bold hover:bg-[#e6004c] w-full md:w-auto">
                Adicionar Categoria
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {categories.map(cat => (
                <div key={cat.id} className="bg-[#111111] border border-gray-800 p-4 rounded-lg flex justify-between items-center group">
                  <div className="flex items-center gap-4">
                    {cat.icon && <img src={cat.icon} className="w-8 h-8 object-contain" referrerPolicy="no-referrer" />}
                    <span className="font-bold text-sm uppercase tracking-wider">{cat.nome}</span>
                  </div>
                  <button onClick={() => handleDeleteCategory(cat.id)} className="text-gray-500 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'orders' && (
          <div className="space-y-8">
            <h2 className="text-2xl font-bold">Pedidos Recebidos</h2>
            
            <div className="space-y-4">
              {orders.length === 0 ? (
                <div className="text-gray-500">Nenhum pedido encontrado.</div>
              ) : (
                orders.map(order => (
                  <div key={order.id} className="bg-[#111111] border border-gray-800 rounded-xl p-6 space-y-6">
                    <div className="flex justify-between items-start border-b border-gray-800 pb-4">
                      <div>
                        <div className="text-xs text-[#ff4d79] font-bold uppercase tracking-widest mb-1">Pedido #{order.id}</div>
                        <div className="text-sm text-gray-400">{order.data}</div>
                        <div className="text-xs text-gray-500 mt-1">ID Usuário: {order.userId}</div>
                      </div>
                      <div className="flex items-center gap-4">
                        <select 
                          value={order.status}
                          onChange={(e) => handleStatusChange(order.id, e.target.value)}
                          className="bg-black border border-gray-700 rounded px-3 py-1 text-xs outline-none focus:border-[#ff4d79]"
                        >
                          <option value="Pendente">Pendente</option>
                          <option value="Processando">Processando</option>
                          <option value="Enviado">Enviado</option>
                          <option value="Entregue">Entregue</option>
                        </select>
                        <div className="text-xl font-bold">R$ {order.total}</div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-3">
                        <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Itens do Pedido</div>
                        {order.itens.map((item, idx) => (
                          <div key={idx} className="flex gap-3 items-center bg-black/40 p-3 rounded-lg border border-gray-800/50">
                            <img src={item.imagem} className="w-10 h-10 object-cover rounded" referrerPolicy="no-referrer" />
                            <div className="flex-grow">
                              <div className="text-xs font-bold">{item.nome}</div>
                              <div className="text-[10px] text-gray-500">
                                {item.quantidade}x - {Object.entries(item.selecoes).map(([k, v]) => `${k}: ${v}`).join(', ')}
                              </div>
                              {item.textoPersonalizado && (
                                <div className="text-[10px] text-[#ff4d79] mt-1 font-bold">
                                  Personalização: {item.textoPersonalizado}
                                </div>
                              )}
                              {item.arquivoUrl && (
                                <a 
                                  href={item.arquivoUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:underline mt-1"
                                >
                                  <Upload size={10} /> Baixar Arte
                                </a>
                              )}
                            </div>
                            <div className="text-xs font-bold">R$ {(parseFloat(item.preco) * item.quantidade).toFixed(2)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'config' && (
          <div className="max-w-4xl space-y-8">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold">Configurações do Site</h2>
            </div>
            
            <form onSubmit={handleSaveConfig} className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Logo do Site (URL)</label>
                  <input 
                    id="logo_url_input"
                    name="logo_url" 
                    defaultValue={config.logo_url} 
                    placeholder="https://exemplo.com/logo.png"
                    className="w-full bg-[#111111] border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]" 
                  />
                  {config.logo_url && (
                    <div className="mt-2 w-16 h-16 bg-white rounded-lg flex items-center justify-center p-2 border border-gray-800">
                      <img src={config.logo_url} className="max-w-full max-h-full object-contain" referrerPolicy="no-referrer" />
                    </div>
                  )}
                  <p className="text-[10px] text-gray-600 italic">Esta URL também será usada como o ícone da aba do navegador.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-500">WhatsApp 1</label>
                  <input name="telefone1" defaultValue={config.telefone1} className="w-full bg-[#111111] border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-500">WhatsApp 2</label>
                  <input name="telefone2" defaultValue={config.telefone2} className="w-full bg-[#111111] border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Imagem do Banner Principal (URL)</label>
                  <input 
                    id="banner_principal_input"
                    name="banner_principal" 
                    defaultValue={config.banner_principal} 
                    placeholder="https://exemplo.com/banner.jpg"
                    className="w-full bg-[#111111] border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]" 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Título do Banner</label>
                  <input name="banner_titulo" defaultValue={config.banner_titulo} placeholder="Ex: Impressão com Amor e Cuidado" className="w-full bg-[#111111] border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Subtítulo do Banner</label>
                  <input name="banner_subtitulo" defaultValue={config.banner_subtitulo} placeholder="Ex: Produtos personalizados para eternizar..." className="w-full bg-[#111111] border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Texto do Botão do Banner</label>
                  <input name="banner_botao" defaultValue={config.banner_botao} placeholder="Ex: Ver Produtos" className="w-full bg-[#111111] border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]" />
                </div>
              </div>

              <div className="space-y-6">
                {[1, 2, 3].map(num => (
                  <div key={num} className="p-6 bg-[#111111] border border-gray-800 rounded-xl space-y-4">
                    <div className="text-[10px] text-[#ff4d79] font-bold uppercase tracking-widest">Benefício {num}</div>
                    <input name={`beneficio${num}_titulo`} defaultValue={(config as any)[`beneficio${num}_titulo`]} placeholder="Título" className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-sm" />
                    <input name={`beneficio${num}_desc`} defaultValue={(config as any)[`beneficio${num}_desc`]} placeholder="Descrição" className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-sm" />
                  </div>
                ))}
              </div>

              <div className="md:col-span-2 pt-8">
                <button type="submit" className="bg-[#ff4d79] px-12 py-4 rounded-full font-bold hover:bg-[#e6004c] transition-colors shadow-lg shadow-[#ff4d79]/20">
                  Salvar Todas as Configurações
                </button>
              </div>
            </form>
          </div>
        )}
      </main>

      {/* Modal Editor de Produto */}
      <AnimatePresence>
        {editingProduct && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={() => setEditingProduct(null)} />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative bg-[#111111] border border-gray-800 w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl p-8"
            >
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-xl font-bold">{editingProduct.id ? 'Editar Produto' : 'Novo Produto'}</h3>
                <button onClick={() => setEditingProduct(null)}><X size={24} /></button>
              </div>

              <form onSubmit={handleSaveProduct} className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase">Nome do Produto</label>
                    <input 
                      required
                      value={editingProduct.nome}
                      onChange={e => setEditingProduct({...editingProduct, nome: e.target.value})}
                      className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase">Descrição</label>
                    <textarea 
                      required
                      value={editingProduct.desc}
                      onChange={e => setEditingProduct({...editingProduct, desc: e.target.value})}
                      rows={4}
                      className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79] resize-none" 
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase">Categoria</label>
                      <select 
                        value={editingProduct.categoria}
                        onChange={e => setEditingProduct({...editingProduct, categoria: e.target.value})}
                        className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                      >
                        <option value="">Selecionar Categoria</option>
                        {categories.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase">Preço Base (Texto)</label>
                      <input 
                        value={editingProduct.preco_base}
                        onChange={e => setEditingProduct({...editingProduct, preco_base: e.target.value})}
                        placeholder="Ex: A partir de R$ 50"
                        className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]" 
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase">Imagem do Produto (URL)</label>
                    <input 
                      required
                      value={editingProduct.imagem}
                      onChange={e => setEditingProduct({...editingProduct, imagem: e.target.value})}
                      placeholder="https://exemplo.com/produto.jpg"
                      className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]" 
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase">Tipo de Personalização</label>
                      <select 
                        value={editingProduct.tipoInput || 'nenhum'}
                        onChange={e => setEditingProduct({...editingProduct, tipoInput: e.target.value as any})}
                        className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                      >
                        <option value="nenhum">Nenhuma</option>
                        <option value="arte">Upload de Arte</option>
                        <option value="texto">Texto (Nome, etc)</option>
                      </select>
                    </div>
                    {editingProduct.tipoInput === 'texto' && (
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500 uppercase">Rótulo do Texto</label>
                        <input 
                          value={editingProduct.labelTexto || ''}
                          onChange={e => setEditingProduct({...editingProduct, labelTexto: e.target.value})}
                          placeholder="Ex: Nome da Criança"
                          className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]" 
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-500 uppercase">Atributos e Preços</label>
                    <button 
                      type="button"
                      onClick={() => setShowAttrForm(true)}
                      className="text-[#ff4d79] text-xs font-bold hover:underline"
                    >
                      + Adicionar Atributo
                    </button>
                  </div>

                  {showAttrForm && (
                    <div className="bg-gray-900 p-4 rounded-lg border border-pink-500/30 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] text-gray-400 uppercase">Nome (ex: Tamanho)</label>
                          <input 
                            value={newAttr.nome}
                            onChange={e => setNewAttr({...newAttr, nome: e.target.value})}
                            className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-gray-400 uppercase">Opções (separadas por vírgula)</label>
                          <input 
                            value={newAttr.opcoes}
                            onChange={e => setNewAttr({...newAttr, opcoes: e.target.value})}
                            placeholder="P, M, G"
                            className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-sm"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          type="button"
                          onClick={() => {
                            if (newAttr.nome && newAttr.opcoes) {
                              const options = newAttr.opcoes.split(',').map(s => s.trim()).filter(s => s);
                              setEditingProduct({
                                ...editingProduct,
                                atributos: [...(editingProduct.atributos || []), { nome: newAttr.nome, opcoes: options }]
                              });
                              setNewAttr({ nome: '', opcoes: '' });
                              setShowAttrForm(false);
                            }
                          }}
                          className="bg-[#ff4d79] px-4 py-2 rounded text-xs font-bold"
                        >
                          Confirmar
                        </button>
                        <button 
                          type="button"
                          onClick={() => setShowAttrForm(false)}
                          className="bg-gray-800 px-4 py-2 rounded text-xs font-bold"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    {editingProduct.atributos?.map((attr, idx) => (
                      <div key={idx} className="bg-black p-4 rounded-lg border border-gray-800 flex justify-between items-center">
                        <div>
                          <div className="text-xs font-bold">{attr.nome}</div>
                          <div className="text-[10px] text-gray-500">{attr.opcoes.join(', ')}</div>
                        </div>
                        <button 
                          type="button"
                          onClick={() => setEditingProduct({
                            ...editingProduct,
                            atributos: editingProduct.atributos?.filter((_, i) => i !== idx)
                          })}
                          className="text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>

                  {editingProduct.atributos && editingProduct.atributos.length > 0 && (
                    <div className="space-y-4 pt-4 border-t border-gray-800">
                      <div className="text-[10px] text-gray-500 uppercase font-bold">Definir Preços das Combinações</div>
                      <div className="max-h-48 overflow-y-auto space-y-2 pr-2">
                        {generateCombinations(editingProduct.atributos).map(combo => (
                          <div key={combo} className="flex items-center gap-3 bg-black/40 p-2 rounded border border-gray-800">
                            <span className="text-[10px] flex-grow">{combo.replace(/\|/g, ' + ')}</span>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-gray-500">R$</span>
                              <input 
                                type="text"
                                value={editingProduct.combinacoes?.[combo] || ''}
                                onChange={e => setEditingProduct({
                                  ...editingProduct,
                                  combinacoes: { ...editingProduct.combinacoes, [combo]: e.target.value }
                                })}
                                className="w-20 bg-black border border-gray-700 rounded px-2 py-1 text-xs"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="md:col-span-2 pt-8 flex justify-end gap-4">
                  <button type="button" onClick={() => setEditingProduct(null)} className="px-8 py-3 rounded-full font-bold text-sm text-gray-500 hover:text-white">Cancelar</button>
                  <button type="submit" className="bg-[#ff4d79] px-12 py-3 rounded-full font-bold text-sm hover:bg-[#e6004c] flex items-center gap-2">
                    <Save size={18} /> Salvar Produto
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Removidos modais de upload */}
    </div>
  );
}

function generateCombinations(attributes: any[]): string[] {
  if (attributes.length === 0) return [];
  
  let results: string[] = [ "" ];
  
  for (const attr of attributes) {
    const newResults: string[] = [];
    for (const res of results) {
      for (const option of attr.opcoes) {
        newResults.push(res ? `${res}|${option}` : option);
      }
    }
    results = newResults;
  }
  
  return results;
}
