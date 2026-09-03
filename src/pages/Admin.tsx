import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Edit2, Save, X, ArrowLeft, Package, Layout, List, Settings, LogOut, Clock, Upload, Loader2, Sparkles, CheckCircle2, Tag, QrCode, CreditCard } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Anuncio, SiteConfig, Order, Category, Promocao, ProductAttribute, type FulfillmentStatus } from '../types';
import { cn } from '../lib/utils';
import { db, setDoc, doc, deleteDoc, handleFirestoreError, OperationType, logout } from '../firebase';
import { INITIAL_PRODUCTS, INITIAL_CATEGORIES } from '../constants';
import { generateDescriptionFromTitle, improveTitle, improveDescription, generateDescriptionWithCustomPrompt } from '../services/geminiService';
import { formatMoney, isHttpUrl, parseMoneyToCents, slugifyDocumentId } from '../lib/commerce';
import { allowedFulfillmentTransitions, fulfillmentStatusLabel, legacyFulfillmentStatus } from '../lib/orderStatus';
import { requestArtworkUrl } from '../services/artworkService';
import { updateOrderFulfillment } from '../services/orderService';
import { missingLegalBusinessFields } from '../lib/legal';
import { DEFAULT_LOGO_URL, resolvePublicImage, usePageMetadata } from '../lib/seo';

interface AdminProps {
  products: Anuncio[];
  config: SiteConfig;
  categories: Category[];
  orders: Order[];
  ordersReady: boolean;
  ordersError: string | null;
  promotions: Promocao[];
}

const BENEFIT_FIELDS = [
  { number: 1, title: 'beneficio1_titulo', description: 'beneficio1_desc' },
  { number: 2, title: 'beneficio2_titulo', description: 'beneficio2_desc' },
  { number: 3, title: 'beneficio3_titulo', description: 'beneficio3_desc' },
] as const;

const LEGAL_FIELD_LABELS: Record<string, string> = {
  razao_social: 'razão social',
  documento_fiscal: 'CNPJ ou CPF',
  endereco_comercial: 'endereço comercial',
  email_atendimento: 'e-mail de atendimento',
  email_privacidade: 'e-mail de privacidade',
  prazo_producao: 'prazo de produção',
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function Admin({ products, config, categories, orders, ordersReady, ordersError, promotions }: AdminProps) {
  const [activeTab, setActiveTab] = useState<'products' | 'categories' | 'config' | 'orders' | 'promotions'>('products');
  const [editingProduct, setEditingProduct] = useState<Partial<Anuncio> | null>(null);
  const [editingPromotion, setEditingPromotion] = useState<Partial<Promocao> | null>(null);
  const [newCategory, setNewCategory] = useState({ nome: '', icon: '' });
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const missingCommercialFields = missingLegalBusinessFields(config);

  usePageMetadata({
    title: 'Painel administrativo | GB Gráfica',
    description: 'Área administrativa restrita da GB Gráfica.',
    path: '/admin',
    noIndex: true,
    image: config.logo_url,
  });

  React.useEffect(() => {
    if (successMessage || errorMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
        setErrorMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage, errorMessage]);
  const [newAttr, setNewAttr] = useState({ nome: '', opcoes: '' });
  const [showAttrForm, setShowAttrForm] = useState(false);
  const [showBulkImageForm, setShowBulkImageForm] = useState(false);
  const [bulkImages, setBulkImages] = useState('');
  const [showCustomAiPrompt, setShowCustomAiPrompt] = useState(false);
  const [customAiPrompt, setCustomAiPrompt] = useState('');
  const [aiPreview, setAiPreview] = useState<{
    field: 'nome' | 'desc';
    original: string;
    suggested: string;
    loading: boolean;
  } | null>(null);

  const closeProductEditor = () => {
    setEditingProduct(null);
    setShowAttrForm(false);
    setShowBulkImageForm(false);
    setShowCustomAiPrompt(false);
    setAiPreview(null);
    setBulkImages('');
    setCustomAiPrompt('');
    setNewAttr({ nome: '', opcoes: '' });
  };

  React.useEffect(() => {
    if (!editingProduct && !editingPromotion) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';

    const activeDialog = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
      .filter(element => element.getClientRects().length > 0)
      .at(-1);
    const focusableElements = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter(element => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');

    const focusFrame = window.requestAnimationFrame(() => {
      const dialog = activeDialog();
      if (dialog) focusableElements(dialog)[0]?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (aiPreview) setAiPreview(null);
        else if (showCustomAiPrompt) setShowCustomAiPrompt(false);
        else if (showBulkImageForm) setShowBulkImageForm(false);
        else if (editingProduct) closeProductEditor();
        else setEditingPromotion(null);
        return;
      }

      if (event.key !== 'Tab') return;
      const dialog = activeDialog();
      if (!dialog) return;
      const focusable = focusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [editingProduct, editingPromotion, aiPreview, showCustomAiPrompt, showBulkImageForm]);

  const handleAiAction = async (action: 'generate' | 'improveTitle' | 'improveDescription' | 'custom', prompt?: string) => {
    if (!editingProduct) return;

    const currentField = action === 'improveTitle' ? 'nome' : 'desc';
    const currentValue = action === 'improveTitle' ? editingProduct.nome || '' : editingProduct.desc || '';

    setAiPreview({
      field: currentField,
      original: currentValue,
      suggested: '',
      loading: true
    });

    try {
      let result = '';
      if (action === 'generate') {
        result = await generateDescriptionFromTitle(editingProduct.nome || '');
      } else if (action === 'improveTitle') {
        result = await improveTitle(editingProduct.nome || '');
      } else if (action === 'improveDescription') {
        result = await improveDescription(editingProduct.desc || '');
      } else if (action === 'custom' && prompt) {
        result = await generateDescriptionWithCustomPrompt(editingProduct.nome || '', prompt);
      }

      setAiPreview(prev => prev ? { ...prev, suggested: result, loading: false } : null);
    } catch (error) {
      console.error(error);
      setAiPreview(null);
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível consultar a IA.');
    }
  };

  const bootstrapData = async () => {
    setIsBootstrapping(true);
    try {
      // Categories
      for (const cat of INITIAL_CATEGORIES) {
        const id = slugifyDocumentId(cat.nome);
        if (!id) continue;
        await setDoc(doc(db, 'categories', id), cat);
      }
      // Products
      for (const prod of INITIAL_PRODUCTS) {
        const id = prod.id || crypto.randomUUID().replace(/-/g, '').slice(0, 20);
        await setDoc(doc(db, 'anuncios', id), { ...prod, id });
      }
      setSuccessMessage('Dados iniciais carregados com sucesso!');
    } catch (error) {
      console.error('Error bootstrapping data:', error);
      setErrorMessage('Não foi possível carregar os dados iniciais.');
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
      pix_chave: String(formData.get('pix_chave') || '').trim(),
      pix_beneficiario: String(formData.get('pix_beneficiario') || '').trim(),
      razao_social: String(formData.get('razao_social') || '').trim(),
      documento_fiscal: String(formData.get('documento_fiscal') || '').trim(),
      endereco_comercial: String(formData.get('endereco_comercial') || '').trim(),
      email_atendimento: String(formData.get('email_atendimento') || '').trim().toLowerCase(),
      email_privacidade: String(formData.get('email_privacidade') || '').trim().toLowerCase(),
      prazo_producao: String(formData.get('prazo_producao') || '').trim(),
    };

    if (!updatedConfig.telefone1.trim() || !updatedConfig.telefone2.trim()) {
      setErrorMessage('Informe os dois números de atendimento.');
      return;
    }
    if (updatedConfig.logo_url && !isHttpUrl(updatedConfig.logo_url) && !updatedConfig.logo_url.startsWith('/')) {
      setErrorMessage('A URL do logo é inválida.');
      return;
    }
    if (!isHttpUrl(updatedConfig.banner_principal) && !updatedConfig.banner_principal.startsWith('/')) {
      setErrorMessage('A URL do banner principal é inválida.');
      return;
    }
    if (updatedConfig.email_atendimento && !isValidEmail(updatedConfig.email_atendimento)) {
      setErrorMessage('O e-mail de atendimento é inválido.');
      return;
    }
    if (updatedConfig.email_privacidade && !isValidEmail(updatedConfig.email_privacidade)) {
      setErrorMessage('O e-mail de privacidade é inválido.');
      return;
    }

    setIsSaving(true);
    try {
      await setDoc(doc(db, 'config', 'main'), updatedConfig);
      setSuccessMessage('Configurações salvas com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'config/main');
      setErrorMessage('Não foi possível salvar as configurações.');
    } finally {
      setIsSaving(false);
    }
  };

  // Category Handlers
  const handleAddCategory = async () => {
    const name = newCategory.nome.trim();
    if (!name) return;
    if (newCategory.icon.trim() && !isHttpUrl(newCategory.icon.trim())) {
      setErrorMessage('A URL do ícone da categoria é inválida.');
      return;
    }
    const id = slugifyDocumentId(name);
    if (!id) {
      setErrorMessage('O nome da categoria não gera um identificador válido.');
      return;
    }
    if (categories.some(category => category.id === id || category.nome.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
      setErrorMessage('Já existe uma categoria com esse nome.');
      return;
    }
    try {
      await setDoc(doc(db, 'categories', id), { nome: name, icon: newCategory.icon.trim() });
      setNewCategory({ nome: '', icon: '' });
      setSuccessMessage('Categoria adicionada.');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `categories/${id}`);
      setErrorMessage('Não foi possível adicionar a categoria.');
    }
  };

  const handleDeleteCategory = async (catId: string) => {
    const category = categories.find(item => item.id === catId);
    if (category && products.some(product => product.categoria === category.nome)) {
      setErrorMessage('Esta categoria ainda possui produtos. Mova-os antes de excluir.');
      return;
    }
    if (!window.confirm(`Excluir a categoria "${category?.nome || catId}"?`)) return;
    try {
      await deleteDoc(doc(db, 'categories', catId));
      setSuccessMessage('Categoria excluída.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `categories/${catId}`);
      setErrorMessage('Não foi possível excluir a categoria.');
    }
  };

  // Product Handlers
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;

    const name = editingProduct.nome?.trim() || '';
    const description = editingProduct.desc?.trim() || '';
    const category = editingProduct.categoria?.trim() || '';
    const mainImage = editingProduct.imagem?.trim() || '';
    const attributes = (editingProduct.atributos || []).map(attribute => ({
      nome: attribute.nome.trim(),
      opcoes: Array.from(new Set(attribute.opcoes.map(option => option.trim()).filter(Boolean))),
    }));

    if (!name || !description || !category || !mainImage) {
      setErrorMessage('Por favor, preencha todos os campos obrigatórios (Nome, Descrição, Categoria e Imagem Principal).');
      return;
    }
    if (name.length >= 200 || description.length >= 1000) {
      setErrorMessage('O nome deve ter menos de 200 caracteres e a descrição menos de 1000.');
      return;
    }
    if (!isHttpUrl(mainImage) && !mainImage.startsWith('/')) {
      setErrorMessage('A URL da imagem principal é inválida.');
      return;
    }
    const gallery = [...new Set<string>((editingProduct.imagens || []).map(image => image.trim()).filter(Boolean))];
    if (gallery.some(image => !isHttpUrl(image) && !image.startsWith('/'))) {
      setErrorMessage('A galeria contém uma URL inválida.');
      return;
    }
    if (attributes.some(attribute => !attribute.nome || attribute.opcoes.length === 0) || new Set(attributes.map(attribute => attribute.nome)).size !== attributes.length) {
      setErrorMessage('Cada atributo precisa de nome único e pelo menos uma opção.');
      return;
    }

    const combinationKeys = generateCombinations(attributes);
    if (combinationKeys.length > 500) {
      setErrorMessage('Este produto gera combinações demais. Reduza a quantidade de atributos ou opções.');
      return;
    }
    const combinations = Object.fromEntries(combinationKeys.map(key => [key, editingProduct.combinacoes?.[key]?.trim() || '']));
    if (combinationKeys.some(key => {
      const cents = parseMoneyToCents(combinations[key]);
      return cents === null || cents <= 0;
    })) {
      setErrorMessage('Defina um preço válido e maior que zero para todas as combinações.');
      return;
    }
    if (attributes.length === 0) {
      const basePrice = parseMoneyToCents(editingProduct.preco_base);
      if (basePrice === null || basePrice <= 0) {
        setErrorMessage('Defina um preço base válido e maior que zero.');
        return;
      }
    }

    const id = editingProduct.id || crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const productToSave: Anuncio = {
      ...editingProduct,
      id,
      nome: name,
      desc: description,
      categoria: category,
      imagem: mainImage,
      imagens: gallery,
      preco_base: editingProduct.preco_base?.trim() || '',
      atributos: attributes,
      combinacoes: combinations,
      tipoInput: editingProduct.tipoInput || 'nenhum',
      labelTexto: editingProduct.labelTexto?.trim() || '',
    };

    setIsSaving(true);
    try {
      await setDoc(doc(db, 'anuncios', id), productToSave);
      closeProductEditor();
      setSuccessMessage('Anúncio salvo com sucesso!');
    } catch (error) {
      console.error('Erro ao salvar anúncio:', error);
      setErrorMessage('Não foi possível salvar o anúncio. Verifique os campos e tente novamente.');
      handleFirestoreError(error, OperationType.WRITE, `anuncios/${id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    const product = products.find(item => item.id === id);
    if (!window.confirm(`Excluir o produto "${product?.nome || id}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await deleteDoc(doc(db, 'anuncios', id));
      setSuccessMessage('Anúncio excluído com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `anuncios/${id}`);
      setErrorMessage('Não foi possível excluir o anúncio.');
    }
  };

  // Order Handlers
  const handleStatusChange = async (orderId: string, newStatus: FulfillmentStatus) => {
    try {
      await updateOrderFulfillment(orderId, newStatus);
      setSuccessMessage('Etapa do pedido atualizada.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível atualizar o pedido.');
    }
  };

  const handleOpenArtwork = async (orderId: string, itemId: string) => {
    try {
      const url = await requestArtworkUrl(orderId, itemId);
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (opened) opened.opener = null;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível abrir a arte.');
    }
  };

  // Promotion Handlers
  const handleSavePromotion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPromotion) return;

    const title = editingPromotion.titulo?.trim() || '';
    const image = editingPromotion.imagem?.trim() || '';
    const link = editingPromotion.link?.trim() || '';
    if (!title || !image) {
      setErrorMessage('Por favor, preencha o título e a imagem da promoção.');
      return;
    }
    if ((!isHttpUrl(image) && !image.startsWith('/')) || (link && !isHttpUrl(link))) {
      setErrorMessage('A promoção contém uma URL inválida.');
      return;
    }

    const id = editingPromotion.id || crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const promotionToSave = {
      ...editingPromotion,
      id,
      titulo: title,
      imagem: image,
      link,
      ativa: editingPromotion.ativa ?? true
    } as Promocao;

    setIsSaving(true);
    try {
      await setDoc(doc(db, 'promocoes', id), promotionToSave);
      setEditingPromotion(null);
      setSuccessMessage('Promoção salva com sucesso!');
    } catch (error) {
      setErrorMessage('Erro ao salvar promoção.');
      handleFirestoreError(error, OperationType.WRITE, `promocoes/${id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeletePromotion = async (id: string) => {
    const promotion = promotions.find(item => item.id === id);
    if (!window.confirm(`Excluir a promoção "${promotion?.titulo || id}"?`)) return;
    try {
      await deleteDoc(doc(db, 'promocoes', id));
      setSuccessMessage('Promoção excluída com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `promocoes/${id}`);
      setErrorMessage('Não foi possível excluir a promoção.');
    }
  };

  return (
    <div className="min-h-screen bg-[#060606] text-white flex flex-col lg:flex-row">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[120] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-xs focus:font-bold focus:text-black"
      >
        Ir para o conteúdo
      </a>
      {/* Sidebar Admin */}
      <aside className="w-full lg:w-64 bg-[#111111] border-b lg:border-b-0 lg:border-r border-gray-800 flex flex-col shrink-0">
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="text-xl font-black tracking-tighter text-white mb-4 lg:mb-8">
            GB <span className="text-[#ff4d79]">ADMIN</span>
          </div>

          <nav aria-label="Seções administrativas" className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0">
            <button
              onClick={() => setActiveTab('products')}
              className={cn("w-auto shrink-0 lg:w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors", activeTab === 'products' ? "bg-[#ff4d79] text-white" : "text-gray-400 hover:bg-gray-800")}
            >
              <Layout size={18} /> Produtos
            </button>
            <button
              onClick={() => setActiveTab('categories')}
              className={cn("w-auto shrink-0 lg:w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors", activeTab === 'categories' ? "bg-[#ff4d79] text-white" : "text-gray-400 hover:bg-gray-800")}
            >
              <List size={18} /> Categorias
            </button>
            <button
              onClick={() => setActiveTab('orders')}
              className={cn("w-auto shrink-0 lg:w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors", activeTab === 'orders' ? "bg-[#ff4d79] text-white" : "text-gray-400 hover:bg-gray-800")}
            >
              <Package size={18} /> Pedidos
            </button>
            <button
              onClick={() => setActiveTab('promotions')}
              className={cn("w-auto shrink-0 lg:w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors", activeTab === 'promotions' ? "bg-[#ff4d79] text-white" : "text-gray-400 hover:bg-gray-800")}
            >
              <Tag size={18} /> Promoções
            </button>
            <button
              onClick={() => setActiveTab('config')}
              className={cn("w-auto shrink-0 lg:w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors", activeTab === 'config' ? "bg-[#ff4d79] text-white" : "text-gray-400 hover:bg-gray-800")}
            >
              <Settings size={18} /> Configurações
            </button>
          </nav>
        </div>

        <div className="mt-auto flex flex-wrap gap-4 px-4 pb-4 sm:px-6 sm:pb-6 lg:flex-col lg:p-8">
          <Link to="/" className="flex items-center gap-2 text-xs text-gray-500 hover:text-white transition-colors">
            <ArrowLeft size={14} /> Voltar para a Loja
          </Link>
          <button onClick={logout} className="flex items-center gap-2 text-xs text-red-500 hover:text-red-400 transition-colors">
            <LogOut size={14} /> Sair do Admin
          </button>
        </div>
      </aside>

      {/* Main Content Admin */}
      <main id="admin-main" className="min-w-0 flex-grow p-4 sm:p-6 lg:p-12 overflow-y-visible lg:overflow-y-auto max-h-none lg:max-h-screen relative">
        <AnimatePresence>
          {successMessage && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              role="status"
              aria-live="polite"
              className="fixed top-8 right-8 z-[100] bg-green-500 text-white px-6 py-3 rounded-lg shadow-xl font-bold flex items-center gap-2"
            >
              <CheckCircle2 size={18} /> {successMessage}
            </motion.div>
          )}
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              role="alert"
              className="fixed top-8 right-8 z-[100] bg-red-500 text-white px-6 py-3 rounded-lg shadow-xl font-bold flex items-center gap-2"
            >
              <X size={18} /> {errorMessage}
            </motion.div>
          )}
        </AnimatePresence>
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
                onClick={() => setEditingProduct({
                  nome: '',
                  desc: '',
                  categoria: categories[0]?.nome || '',
                  imagem: '',
                  imagens: [],
                  preco_base: '',
                  atributos: [],
                  combinacoes: {},
                  tipoInput: 'nenhum'
                })}
                className="bg-[#ff4d79] px-6 py-2 rounded-full font-bold text-sm flex items-center gap-2 hover:bg-[#e6004c] transition-colors"
              >
                <Plus size={18} /> Novo Produto
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {products.map(p => (
                <div key={p.id} className="bg-[#111111] border border-gray-800 rounded-xl overflow-hidden group">
                  <div className="aspect-video bg-gray-900 relative">
                    <img src={p.imagem} alt={p.nome} className="w-full h-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                      <button type="button" onClick={() => setEditingProduct(p)} aria-label={`Editar ${p.nome}`} className="p-3 bg-white text-black rounded-full hover:scale-110 transition-transform">
                        <Edit2 size={18} />
                      </button>
                      <button type="button" onClick={() => handleDeleteProduct(p.id)} aria-label={`Excluir ${p.nome}`} className="p-3 bg-red-500 text-white rounded-full hover:scale-110 transition-transform">
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
                  <p className="text-[10px] text-gray-500 mt-1">Informe uma URL HTTPS estável para o ícone.</p>
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
                    {cat.icon && <img src={cat.icon} alt="" className="w-8 h-8 object-contain" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
                    <span className="font-bold text-sm uppercase tracking-wider">{cat.nome}</span>
                  </div>
                  <button onClick={() => handleDeleteCategory(cat.id)} aria-label={`Excluir ${cat.nome}`} className="text-gray-500 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'orders' && (
          <div className="space-y-12">
            <h2 className="text-2xl font-bold">Pedidos Recebidos</h2>
            {!ordersReady && <div role="status" className="text-sm text-gray-400 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Carregando pedidos...</div>}
            {ordersError && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{ordersError}</div>}

            {/* Pedidos Pagos */}
            <div className="space-y-6">
              <div className="flex items-center gap-3 border-b border-green-500/30 pb-2">
                <CheckCircle2 className="text-green-500" size={20} />
                <h3 className="text-lg font-bold text-green-500">Pedidos com pagamento confirmado</h3>
              </div>

              <div className="space-y-4">
                {orders.filter(isPaymentConfirmed).length === 0 ? (
                  <div className="text-gray-600 text-sm italic">Nenhum pedido pago encontrado.</div>
                ) : (
                  orders.filter(isPaymentConfirmed).map(order => (
                    <OrderCard key={order.id} order={order} handleStatusChange={handleStatusChange} handleOpenArtwork={handleOpenArtwork} />
                  ))
                )}
              </div>
            </div>

            {/* Pedidos Pendentes */}
            <div className="space-y-6 pt-8">
              <div className="flex items-center gap-3 border-b border-yellow-500/30 pb-2">
                <Clock className="text-yellow-500" size={20} />
                <h3 className="text-lg font-bold text-yellow-500">Pedidos Pendentes (Falta Pagamento)</h3>
              </div>

              <div className="space-y-4">
                {orders.filter(order => !isPaymentConfirmed(order)).length === 0 ? (
                  <div className="text-gray-600 text-sm italic">Nenhum pedido pendente encontrado.</div>
                ) : (
                  orders.filter(order => !isPaymentConfirmed(order)).map(order => (
                    <OrderCard key={order.id} order={order} handleStatusChange={handleStatusChange} handleOpenArtwork={handleOpenArtwork} />
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'config' && (
          <div className="max-w-4xl space-y-8">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold">Configurações do Site</h2>
            </div>

            <form key={JSON.stringify(config)} onSubmit={handleSaveConfig} className="grid grid-cols-1 md:grid-cols-2 gap-8">
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
                      <img src={resolvePublicImage(config.logo_url)} alt="Prévia do logo" className="max-w-full max-h-full object-contain" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                    </div>
                  )}
                  <p className="text-[10px] text-gray-600 italic">Esta URL também será usada como o ícone da aba do navegador.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-500">WhatsApp 1</label>
                  <input name="telefone1" type="tel" defaultValue={config.telefone1} className="w-full bg-[#111111] border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-500">WhatsApp 2</label>
                  <input name="telefone2" type="tel" defaultValue={config.telefone2} className="w-full bg-[#111111] border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]" />
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
                {BENEFIT_FIELDS.map(benefit => (
                  <div key={benefit.number} className="p-6 bg-[#111111] border border-gray-800 rounded-xl space-y-4">
                    <div className="text-[10px] text-[#ff4d79] font-bold uppercase tracking-widest">Benefício {benefit.number}</div>
                    <input name={benefit.title} defaultValue={config[benefit.title]} placeholder="Título" className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-sm" />
                    <input name={benefit.description} defaultValue={config[benefit.description]} placeholder="Descrição" className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-sm" />
                  </div>
                ))}

                <div className="p-6 bg-[#111111] border border-pink-500/20 rounded-xl space-y-4">
                  <div className="text-[10px] text-[#ff4d79] font-bold uppercase tracking-widest">PIX manual (legado — não usado no Checkout PagBank)</div>
                  <div className="space-y-2">
                    <label className="text-xs text-gray-500 font-medium">Chave PIX</label>
                    <input name="pix_chave" defaultValue={config.pix_chave} placeholder="CPF, E-mail, Celular ou Chave Aleatória" className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-sm" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-gray-500 font-medium">Nome do Beneficiário</label>
                    <input name="pix_beneficiario" defaultValue={config.pix_beneficiario} placeholder="Nome Completo ou Razão Social" className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-sm" />
                  </div>
                </div>
              </div>

              <section className="md:col-span-2 p-6 bg-[#111111] border border-amber-500/30 rounded-xl space-y-6">
                <div className="space-y-2">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-amber-400">Dados comerciais e documentos legais</h3>
                  <p className="text-xs leading-relaxed text-gray-500">
                    Estes dados aparecem nas páginas institucionais. Enquanto estiverem incompletos, as páginas serão
                    marcadas como documento em preparação e não devem ser usadas para contratação comercial.
                  </p>
                  <p className={`text-xs font-semibold ${missingCommercialFields.length ? 'text-amber-400' : 'text-green-400'}`}>
                    {missingCommercialFields.length
                      ? `Falta confirmar: ${missingCommercialFields.map(field => LEGAL_FIELD_LABELS[field]).join(', ')}.`
                      : 'Dados comerciais obrigatórios preenchidos.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <label htmlFor="razao_social" className="text-xs font-bold uppercase tracking-widest text-gray-500">Razão social ou nome completo</label>
                    <input id="razao_social" name="razao_social" defaultValue={config.razao_social} maxLength={160} autoComplete="organization" placeholder="Nome jurídico do fornecedor" className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-sm outline-none focus:border-[#ff4d79]" />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="documento_fiscal" className="text-xs font-bold uppercase tracking-widest text-gray-500">CNPJ ou CPF do fornecedor</label>
                    <input id="documento_fiscal" name="documento_fiscal" defaultValue={config.documento_fiscal} maxLength={24} inputMode="numeric" placeholder="00.000.000/0000-00" className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-sm outline-none focus:border-[#ff4d79]" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label htmlFor="endereco_comercial" className="text-xs font-bold uppercase tracking-widest text-gray-500">Endereço físico/comercial</label>
                    <textarea id="endereco_comercial" name="endereco_comercial" defaultValue={config.endereco_comercial} maxLength={300} rows={2} autoComplete="street-address" placeholder="Rua, número, complemento, bairro, cidade, UF e CEP" className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-sm outline-none focus:border-[#ff4d79] resize-y" />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="email_atendimento" className="text-xs font-bold uppercase tracking-widest text-gray-500">E-mail de atendimento</label>
                    <input id="email_atendimento" name="email_atendimento" type="email" defaultValue={config.email_atendimento} maxLength={160} autoComplete="email" placeholder="atendimento@empresa.com.br" className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-sm outline-none focus:border-[#ff4d79]" />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="email_privacidade" className="text-xs font-bold uppercase tracking-widest text-gray-500">E-mail de privacidade/LGPD</label>
                    <input id="email_privacidade" name="email_privacidade" type="email" defaultValue={config.email_privacidade} maxLength={160} autoComplete="email" placeholder="privacidade@empresa.com.br" className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-sm outline-none focus:border-[#ff4d79]" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label htmlFor="prazo_producao" className="text-xs font-bold uppercase tracking-widest text-gray-500">Prazo padrão de produção</label>
                    <input id="prazo_producao" name="prazo_producao" defaultValue={config.prazo_producao} maxLength={200} placeholder="Ex.: de 3 a 5 dias úteis após pagamento e aprovação da arte" className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-sm outline-none focus:border-[#ff4d79]" />
                    <p className="text-[10px] text-gray-600">O prazo de transporte deve ser informado separadamente.</p>
                  </div>
                </div>
              </section>

              <div className="md:col-span-2 pt-8">
                <button type="submit" disabled={isSaving} className="bg-[#ff4d79] px-12 py-4 rounded-full font-bold hover:bg-[#e6004c] transition-colors shadow-lg shadow-[#ff4d79]/20 disabled:opacity-50 flex items-center justify-center gap-2">
                  {isSaving ? <><Loader2 size={18} className="animate-spin" /> Salvando...</> : 'Salvar Todas as Configurações'}
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'promotions' && (
          <div className="space-y-8">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold">Gerenciar Promoções</h2>
              <button
                onClick={() => setEditingPromotion({ titulo: '', imagem: '', link: '', ativa: true })}
                className="bg-[#ff4d79] px-6 py-2 rounded-full font-bold text-sm flex items-center gap-2 hover:bg-[#e6004c] transition-colors"
              >
                <Plus size={18} /> Nova Promoção
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {promotions.map(promo => (
                <div key={promo.id} className="bg-[#111111] border border-gray-800 rounded-xl overflow-hidden group">
                  <div className="aspect-[21/9] relative">
                    <img src={promo.imagem} alt={promo.titulo} className="w-full h-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                      <button type="button" onClick={() => setEditingPromotion(promo)} aria-label={`Editar ${promo.titulo}`} className="p-3 bg-white text-black rounded-full hover:scale-110 transition-transform">
                        <Edit2 size={18} />
                      </button>
                      <button type="button" onClick={() => handleDeletePromotion(promo.id)} aria-label={`Excluir ${promo.titulo}`} className="p-3 bg-red-500 text-white rounded-full hover:scale-110 transition-transform">
                        <Trash2 size={18} />
                      </button>
                    </div>
                    {!promo.ativa && (
                      <div className="absolute top-2 right-2 bg-gray-500 text-white text-[10px] font-bold px-2 py-1 rounded">Inativa</div>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-bold text-sm mb-1">{promo.titulo}</h3>
                    {promo.link && <div className="text-[10px] text-gray-500 truncate">{promo.link}</div>}
                  </div>
                </div>
              ))}
              {promotions.length === 0 && (
                <div className="col-span-3 py-20 text-center text-gray-500 bg-[#111111] rounded-xl border border-dashed border-gray-800">
                  <Tag className="mx-auto mb-4 opacity-20" size={48} />
                  <p>Nenhuma promoção cadastrada.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Modal Editor de Produto */}
      <AnimatePresence>
        {editingProduct && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={closeProductEditor} />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="product-editor-title"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative bg-[#111111] border border-gray-800 w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl p-4 sm:p-8"
            >
              <div className="flex justify-between items-center mb-8">
                <h3 id="product-editor-title" className="text-xl font-bold">{editingProduct.id ? 'Editar Produto' : 'Novo Produto'}</h3>
                <button type="button" onClick={closeProductEditor} aria-label="Fechar editor de produto"><X size={24} /></button>
              </div>

              <form onSubmit={handleSaveProduct} className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-gray-500 uppercase">Nome do Produto</label>
                      <button
                        type="button"
                        onClick={() => handleAiAction('improveTitle')}
                        className="flex items-center gap-1 text-[10px] font-bold text-[#ff4d79] hover:underline"
                      >
                        <Sparkles size={10} /> Melhorar com IA
                      </button>
                    </div>
                    <input
                      required
                      value={editingProduct.nome}
                      maxLength={199}
                      onChange={e => setEditingProduct({...editingProduct, nome: e.target.value})}
                      className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-gray-500 uppercase">Descrição</label>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setShowCustomAiPrompt(true)}
                          className="flex items-center gap-1 text-[10px] font-bold text-[#ff4d79] hover:underline"
                        >
                          <Sparkles size={10} /> Comando IA
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAiAction('generate')}
                          className="flex items-center gap-1 text-[10px] font-bold text-[#ff4d79] hover:underline"
                        >
                          <Sparkles size={10} /> Gerar da IA
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAiAction('improveDescription')}
                          className="flex items-center gap-1 text-[10px] font-bold text-[#ff4d79] hover:underline"
                        >
                          <Sparkles size={10} /> Melhorar com IA
                        </button>
                      </div>
                    </div>
                    <textarea
                      required
                      value={editingProduct.desc}
                      maxLength={999}
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
                        inputMode="decimal"
                        onChange={e => setEditingProduct({...editingProduct, preco_base: e.target.value})}
                        placeholder="Ex: A partir de R$ 50"
                        className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase">Imagem Principal (URL)</label>
                      <input
                        required
                        value={editingProduct.imagem}
                        onChange={e => setEditingProduct({...editingProduct, imagem: e.target.value})}
                        placeholder="https://exemplo.com/capa.jpg"
                        className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-bold text-gray-500 uppercase">Galeria de Fotos (Opcional)</label>
                        <button
                          type="button"
                          onClick={() => setShowBulkImageForm(true)}
                          className="text-[#ff4d79] text-[10px] font-bold hover:underline"
                        >
                          + Adicionar Várias
                        </button>
                      </div>

                      <div className="grid grid-cols-4 gap-2">
                        {editingProduct.imagens?.map((img, idx) => (
                          <div key={idx} className="relative aspect-square bg-black border border-gray-800 rounded overflow-hidden group">
                            <img
                              src={img}
                              alt=""
                              className="w-full h-full object-cover"
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                (e.target as HTMLImageElement).classList.add('opacity-20');
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const newImgs = [...(editingProduct.imagens || [])];
                                newImgs.splice(idx, 1);
                                setEditingProduct({...editingProduct, imagens: newImgs});
                              }}
                              className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setShowBulkImageForm(true)}
                          aria-label="Adicionar imagem à galeria"
                          className="aspect-square border border-dashed border-gray-700 rounded flex items-center justify-center text-gray-500 hover:border-[#ff4d79] hover:text-[#ff4d79] transition-colors"
                        >
                          <Plus size={20} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase">Tipo de Personalização</label>
                      <select
                        value={editingProduct.tipoInput || 'nenhum'}
                        onChange={e => setEditingProduct({...editingProduct, tipoInput: e.target.value as Anuncio['tipoInput']})}
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
                              const attrName = newAttr.nome.trim();
                              const options = Array.from(new Set(newAttr.opcoes.split(',').map(s => s.trim()).filter(Boolean)));
                              if (!attrName || options.length === 0) {
                                setErrorMessage('Informe o nome e ao menos uma opção para o atributo.');
                                return;
                              }
                              if ((editingProduct.atributos || []).some(attribute => attribute.nome.toLocaleLowerCase('pt-BR') === attrName.toLocaleLowerCase('pt-BR'))) {
                                setErrorMessage('Já existe um atributo com esse nome.');
                                return;
                              }
                              setEditingProduct({
                                ...editingProduct,
                                atributos: [...(editingProduct.atributos || []), { nome: attrName, opcoes: options }]
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
                                inputMode="decimal"
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
                  <button type="button" onClick={closeProductEditor} className="px-8 py-3 rounded-full font-bold text-sm text-gray-500 hover:text-white">Cancelar</button>
                  <button type="submit" disabled={isSaving} className="bg-[#ff4d79] px-12 py-3 rounded-full font-bold text-sm hover:bg-[#e6004c] flex items-center gap-2 disabled:opacity-50">
                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} {isSaving ? 'Salvando...' : 'Salvar Produto'}
                  </button>
                </div>
              </form>

              {/* AI Custom Prompt Overlay */}
              <AnimatePresence>
                {showBulkImageForm && (
                  <motion.div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="bulk-image-dialog-title"
                    tabIndex={-1}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-30 bg-[#111111] flex flex-col p-4 sm:p-8 rounded-2xl"
                  >
                    <div className="flex justify-between items-center mb-6">
                      <div className="flex items-center gap-2 text-[#ff4d79]">
                        <Upload size={20} />
                        <h4 id="bulk-image-dialog-title" className="font-bold uppercase tracking-widest text-sm">Adicionar Várias Fotos</h4>
                      </div>
                      <button type="button" onClick={() => setShowBulkImageForm(false)} aria-label="Fechar galeria" className="text-gray-500 hover:text-white">
                        <X size={20} />
                      </button>
                    </div>

                    <div className="flex-grow flex flex-col gap-4">
                      <p className="text-xs text-gray-400">
                        Cole aqui uma lista de URLs (uma por linha). <br/>
                        <span className="text-[#ff4d79] font-bold">IMPORTANTE:</span> Use apenas o <span className="underline">Link Direto</span> (que termina em .jpg ou .png).
                      </p>
                      <textarea
                        value={bulkImages}
                        onChange={e => setBulkImages(e.target.value)}
                        maxLength={20000}
                        placeholder="https://i.postimg.cc/xxxx/foto.jpg"
                        className="flex-grow bg-black border border-gray-800 rounded-xl p-4 text-sm outline-none focus:border-[#ff4d79] resize-none"
                      />
                      {bulkImages && !bulkImages.split('\n').every(u => u.trim() === '' || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(u.trim())) && (
                        <p className="text-[10px] text-yellow-500 bg-yellow-500/10 p-2 rounded border border-yellow-500/20">
                          Atenção: Alguns links parecem não ser "Links Diretos". Verifique se eles terminam em .jpg ou .png.
                        </p>
                      )}
                      <div className="flex gap-4 pt-4">
                        <button
                          type="button"
                          onClick={() => {
                            const urls = [...new Set<string>(bulkImages.split('\n').map(u => u.trim()).filter(Boolean))];
                            if (urls.length === 0 || urls.some(url => !isHttpUrl(url))) {
                              setErrorMessage('Informe ao menos uma URL HTTP ou HTTPS válida.');
                              return;
                            }
                            setEditingProduct({
                              ...editingProduct,
                              imagens: [...(editingProduct.imagens || []), ...urls]
                            });
                            setBulkImages('');
                            setShowBulkImageForm(false);
                          }}
                          className="flex-grow bg-[#ff4d79] py-3 rounded-xl font-bold hover:bg-[#e6004c] transition-colors"
                        >
                          Adicionar à Galeria
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowBulkImageForm(false)}
                          className="flex-grow bg-gray-800 py-3 rounded-xl font-bold hover:bg-gray-700 transition-colors"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* AI Custom Prompt Overlay */}
              <AnimatePresence>
                {showCustomAiPrompt && (
                  <motion.div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="custom-ai-dialog-title"
                    tabIndex={-1}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-20 bg-[#111111] flex flex-col p-4 sm:p-8 rounded-2xl"
                  >
                    <div className="flex justify-between items-center mb-6">
                      <div className="flex items-center gap-2 text-[#ff4d79]">
                        <Sparkles size={20} />
                        <h4 id="custom-ai-dialog-title" className="font-bold uppercase tracking-widest text-sm">Comando Personalizado</h4>
                      </div>
                      <button type="button" onClick={() => setShowCustomAiPrompt(false)} aria-label="Fechar comando de IA" className="text-gray-500 hover:text-white">
                        <X size={20} />
                      </button>
                    </div>

                    <div className="flex-grow flex flex-col gap-4">
                      <p className="text-xs text-gray-400">Diga à IA exatamente o que você quer na descrição (ex: dimensões, materiais, tom de voz):</p>
                      <textarea
                        value={customAiPrompt}
                        onChange={e => setCustomAiPrompt(e.target.value)}
                        maxLength={1000}
                        placeholder="Ex: Faça para panfletos de 10x15 falando sobre a qualidade do papel e entrega rápida..."
                        className="flex-grow bg-black border border-gray-800 rounded-xl p-4 text-sm outline-none focus:border-[#ff4d79] resize-none"
                      />
                      <div className="flex gap-4 pt-4">
                        <button
                          type="button"
                          onClick={() => {
                            if (customAiPrompt.trim()) {
                              handleAiAction('custom', customAiPrompt);
                              setShowCustomAiPrompt(false);
                              setCustomAiPrompt('');
                            }
                          }}
                          className="flex-grow bg-[#ff4d79] py-3 rounded-xl font-bold hover:bg-[#e6004c] transition-colors"
                        >
                          Gerar Descrição
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowCustomAiPrompt(false)}
                          className="flex-grow bg-gray-800 py-3 rounded-xl font-bold hover:bg-gray-700 transition-colors"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* AI Preview Overlay */}
              <AnimatePresence>
                {aiPreview && (
                  <motion.div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="ai-preview-dialog-title"
                    tabIndex={-1}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-10 bg-[#111111] flex flex-col p-4 sm:p-8 rounded-2xl"
                  >
                    <div className="flex justify-between items-center mb-6">
                      <div className="flex items-center gap-2 text-[#ff4d79]">
                        <Sparkles size={20} />
                        <h4 id="ai-preview-dialog-title" className="font-bold uppercase tracking-widest text-sm">Sugestão da IA</h4>
                      </div>
                      {!aiPreview.loading && (
                        <button type="button" onClick={() => setAiPreview(null)} aria-label="Fechar sugestão" className="text-gray-500 hover:text-white">
                          <X size={20} />
                        </button>
                      )}
                    </div>

                    {aiPreview.loading ? (
                      <div className="flex-grow flex flex-col items-center justify-center gap-4">
                        <Loader2 size={40} className="animate-spin text-[#ff4d79]" />
                        <p className="text-gray-400 animate-pulse">Consultando o Gemini...</p>
                      </div>
                    ) : (
                      <div className="flex-grow flex flex-col gap-6 overflow-hidden">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-gray-500 uppercase">Original</label>
                          <div className="bg-black/50 border border-gray-800 p-4 rounded-lg text-sm text-gray-400 italic">
                            {aiPreview.original || "(Vazio)"}
                          </div>
                        </div>
                        <div className="flex-grow space-y-2 overflow-hidden flex flex-col">
                          <label className="text-[10px] font-bold text-[#ff4d79] uppercase">Sugestão</label>
                          <div className="flex-grow bg-black border border-[#ff4d79]/30 p-4 rounded-lg text-sm overflow-y-auto whitespace-pre-wrap">
                            {aiPreview.suggested}
                          </div>
                        </div>
                        <div className="flex gap-4 pt-4">
                          <button
                            type="button"
                            onClick={() => {
                              if (editingProduct) {
                                setEditingProduct({
                                  ...editingProduct,
                                  [aiPreview.field]: aiPreview.suggested
                                });
                              }
                              setAiPreview(null);
                            }}
                            className="flex-grow bg-[#ff4d79] py-3 rounded-xl font-bold hover:bg-[#e6004c] transition-colors"
                          >
                            Aprovar e Usar
                          </button>
                          <button
                            type="button"
                            onClick={() => setAiPreview(null)}
                            className="flex-grow bg-gray-800 py-3 rounded-xl font-bold hover:bg-gray-700 transition-colors"
                          >
                            Descartar
                          </button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Editor de Promoção */}
      <AnimatePresence>
        {editingPromotion && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={() => setEditingPromotion(null)} />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="promotion-editor-title"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative bg-[#111111] border border-gray-800 w-full max-w-lg rounded-2xl shadow-2xl p-4 sm:p-8"
            >
              <div className="flex justify-between items-center mb-8">
                <h3 id="promotion-editor-title" className="text-xl font-bold">{editingPromotion.id ? 'Editar Promoção' : 'Nova Promoção'}</h3>
                <button type="button" onClick={() => setEditingPromotion(null)} aria-label="Fechar editor de promoção"><X size={24} /></button>
              </div>

              <form onSubmit={handleSavePromotion} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase">Título da Promoção</label>
                  <input
                      required
                      value={editingPromotion.titulo}
                      maxLength={199}
                    onChange={e => setEditingPromotion({...editingPromotion, titulo: e.target.value})}
                    className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase">Banner URL</label>
                  <input
                    required
                    value={editingPromotion.imagem}
                    onChange={e => setEditingPromotion({...editingPromotion, imagem: e.target.value})}
                    placeholder="https://exemplo.com/promo.jpg"
                    className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase">Link de Destino (Opcional)</label>
                  <input
                    value={editingPromotion.link || ''}
                    onChange={e => setEditingPromotion({...editingPromotion, link: e.target.value})}
                    placeholder="https://..."
                    className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="promo-ativa"
                    checked={editingPromotion.ativa}
                    onChange={e => setEditingPromotion({...editingPromotion, ativa: e.target.checked})}
                    className="w-4 h-4 accent-[#ff4d79]"
                  />
                  <label htmlFor="promo-ativa" className="text-sm font-bold">Promoção Ativa</label>
                </div>

                <div className="pt-4 flex gap-4">
                  <button type="submit" disabled={isSaving} className="flex-grow bg-[#ff4d79] py-3 rounded-lg font-bold hover:bg-[#e6004c] transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                    {isSaving ? <><Loader2 size={18} className="animate-spin" /> Salvando...</> : 'Salvar Promoção'}
                  </button>
                  <button type="button" onClick={() => setEditingPromotion(null)} className="px-6 py-3 border border-gray-800 rounded-lg font-bold hover:bg-gray-800 transition-colors">
                    Cancelar
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

function generateCombinations(attributes: ProductAttribute[]): string[] {
  if (attributes.length === 0) return [];

  let results: string[] = [ "" ];

  for (const attr of attributes) {
    const newResults: string[] = [];
    for (const res of results) {
      for (const option of attr.opcoes) {
        newResults.push(res ? `${res}|${option}` : option);
        if (newResults.length > 500) return newResults;
      }
    }
    results = newResults;
  }

  return results;
}

function isPaymentConfirmed(order: Order): boolean {
  return order.paymentStatus ? order.paymentStatus === 'pago' : order.status === 'Pago';
}

function adminPaymentLabel(order: Order): string {
  const labels: Partial<Record<NonNullable<Order['paymentStatus']>, string>> = {
    pago: 'Pago',
    pendente: 'Aguardando pagamento',
    em_analise: 'Em análise',
    recusado: 'Recusado',
    cancelado: 'Cancelado',
    expirado: 'Expirado',
    erro: 'Erro no checkout',
  };
  return order.paymentStatus ? labels[order.paymentStatus] || order.paymentStatus : order.status;
}

function formatAdminDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function OrderCard({
  order,
  handleStatusChange,
  handleOpenArtwork,
}: {
  order: Order;
  handleStatusChange: (id: string, status: FulfillmentStatus) => void;
  handleOpenArtwork: (orderId: string, itemId: string) => void;
  key?: string;
}) {
  const paymentConfirmed = isPaymentConfirmed(order);
  const fulfillment = order.fulfillmentStatus || legacyFulfillmentStatus(order.status, order.paymentStatus);
  const transitionOptions = Array.from(new Set([
    fulfillment,
    ...allowedFulfillmentTransitions(
      fulfillment,
      paymentConfirmed ? 'pago' : order.paymentStatus,
      order.metodoEntrega,
    ),
  ]));
  return (
    <div className="bg-[#111111] border border-gray-800 rounded-xl p-6 space-y-6">
      <div className="flex justify-between items-start border-b border-gray-800 pb-4">
        <div>
          <div className="text-xs text-[#ff4d79] font-bold uppercase tracking-widest mb-1">Pedido #{order.id}</div>
          <div className="text-sm text-gray-400">{formatAdminDate(order.data)}</div>
          <div className="text-xs text-gray-300 mt-2 font-semibold">{order.clienteNome || 'Cliente não informado'}</div>
          {order.clienteEmail && <div className="text-xs text-gray-500 mt-1">{order.clienteEmail}</div>}
          {order.clienteTelefone && <div className="text-xs text-gray-500 mt-1">Telefone: {order.clienteTelefone}</div>}
          <div className="text-[10px] text-gray-600 mt-1">ID Usuário: {order.userId}</div>
          <div className="mt-2 flex items-center gap-2">
            <span className={cn(
               "text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded flex items-center gap-1.5",
               order.metodoEntrega === 'retirada'
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                : "bg-purple-500/20 text-purple-400 border border-purple-500/30"
            )}>
              {order.metodoEntrega === 'retirada' ? (
                <><Settings size={10} className="stroke-[3px]" /> RETIRADA NA GRÁFICA</>
              ) : (
                <><Package size={10} className="stroke-[3px]" /> ENTREGA</>
              )}
            </span>
            <span className={cn(
               "text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded flex items-center gap-1.5",
               order.metodoPagamento === 'pagbank'
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                : order.metodoPagamento === 'pix'
                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                : "bg-orange-500/20 text-orange-400 border border-orange-500/30"
            )}>
              {order.metodoPagamento === 'pagbank' ? (
                <><CreditCard size={10} className="stroke-[3px]" /> PAGBANK: CARTÃO / PIX / BOLETO</>
              ) : order.metodoPagamento === 'pix' ? (
                <><QrCode size={10} className="stroke-[3px]" /> PIX</>
              ) : (
                <><CreditCard size={10} className="stroke-[3px]" /> CARTÃO / BOLETO</>
              )}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-col items-end">
            <span className={cn(
              "text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded mb-2",
              paymentConfirmed
                ? "bg-green-500/20 text-green-500 border border-green-500/30"
                : "bg-yellow-500/20 text-yellow-500 border border-yellow-500/30"
            )}>
              {adminPaymentLabel(order)}
            </span>
            <select
              aria-label={`Andamento do pedido ${order.id}`}
              value={fulfillment}
              onChange={(e) => handleStatusChange(order.id, e.target.value as FulfillmentStatus)}
              disabled={transitionOptions.length <= 1}
              className="bg-black border border-gray-700 rounded px-3 py-1 text-xs outline-none focus:border-[#ff4d79]"
            >
              {transitionOptions.map(status => (
                <option key={status} value={status}>{fulfillmentStatusLabel(status)}</option>
              ))}
            </select>
          </div>
          <div className="text-xl font-bold">{formatMoney(order.total)}</div>
        </div>
      </div>

      {order.metodoEntrega === 'entrega' && order.enderecoEntrega && (
        <div className="rounded-lg border border-gray-800 bg-black/30 p-4 text-xs text-gray-400">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-600">Endereço de entrega</div>
          <div className="text-gray-300">
            {order.enderecoEntrega.rua}, {order.enderecoEntrega.numero}
            {order.enderecoEntrega.complemento ? ` - ${order.enderecoEntrega.complemento}` : ''}
          </div>
          <div>{order.enderecoEntrega.bairro} — {order.enderecoEntrega.cidade}/{order.enderecoEntrega.estado}</div>
          <div>CEP {order.enderecoEntrega.cep}</div>
        </div>
      )}

      <div>
        <div className="space-y-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Itens do Pedido</div>
          {order.itens.map((item) => (
            <div key={item.id} className="flex gap-3 items-center bg-black/40 p-3 rounded-lg border border-gray-800/50">
              <img src={item.imagem || DEFAULT_LOGO_URL} alt={item.nome} className="w-10 h-10 object-cover rounded" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
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
                {item.arquivoPath && (
                  <button
                    type="button"
                    onClick={() => handleOpenArtwork(order.id, item.id)}
                    className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:underline mt-1"
                  >
                    <Upload size={10} /> Abrir arte
                  </button>
                )}
                {item.artePendente && (
                  <div className="text-[10px] text-amber-400 mt-1 font-bold">
                    Arte pendente: cliente enviará pelo WhatsApp
                  </div>
                )}
                {item.arquivoUrl && !item.arquivoPath && (
                  <div className="text-[10px] text-amber-400 mt-1 font-bold">
                    Arte legada por link externo: confirme o arquivo diretamente com o cliente
                  </div>
                )}
              </div>
              <div className="text-xs font-bold">{formatMoney(((parseMoneyToCents(item.preco) || 0) * item.quantidade) / 100)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
