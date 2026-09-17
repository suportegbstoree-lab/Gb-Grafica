import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Edit2, Save, X, ArrowLeft, ArrowUp, ArrowDown, ChevronDown, ChevronUp, Package, Layout, List, Settings, LogOut, Upload, Loader2, Sparkles, CheckCircle2, Tag, QrCode, CreditCard, Image, Type } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Anuncio, SiteConfig, Order, Category, Promocao, type FulfillmentStatus } from '../types';
import { cn } from '../lib/utils';
import { db, setDoc, doc, deleteDoc, handleFirestoreError, OperationType, logout } from '../firebase';
import { INITIAL_PRODUCTS, INITIAL_CATEGORIES } from '../constants';
import { generateDescriptionFromTitle, improveTitle, improveDescription, generateDescriptionWithCustomPrompt } from '../services/geminiService';
import { formatMoney, isHttpUrl, parseMoneyToCents, slugifyDocumentId } from '../lib/commerce';
import { allowedFulfillmentTransitions, fulfillmentStatusLabel, legacyFulfillmentStatus, ORDER_QUEUE_ORDER, orderQueueFor, orderQueueLabel, type OrderQueue } from '../lib/orderStatus';
import { requestArtworkUrl } from '../services/artworkService';
import {
  removeCatalogImage,
  storedCatalogImagePath,
  uploadCatalogImage,
  type UploadedCatalogImage,
} from '../services/catalogImageService';
import { updateOrderFulfillment } from '../services/orderService';
import { missingLegalBusinessFields } from '../lib/legal';
import { DEFAULT_LOGO_URL, resolvePublicImage, usePageMetadata } from '../lib/seo';
import { isAllowedCatalogImage, MAX_CATALOG_IMAGE_BYTES } from '../lib/catalogImage';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  ADMIN_LIMITS,
  draftFingerprint,
  generateProductCombinations,
  validateCategoryDraft,
  validateProductDraft,
  validatePromotionDraft,
  validateSiteConfig,
} from '../lib/adminValidation';
import { textFontCssFamily, textFontLabel } from '../lib/textCustomization';
import { normalizePersonalizationFonts, type PersonalizationFont } from '../lib/textCustomization';
import {
  removeAdminAsset,
  storedAdminAssetPath,
  uploadAdminFont,
  uploadAdminImage,
  type UploadedAdminAsset,
} from '../services/adminAssetService';
import type { AdminImageScope } from '../lib/adminAsset';
import { formattedDiscountPercentage } from '../lib/promotions';

type AdminTab = 'products' | 'categories' | 'config' | 'orders' | 'promotions';

export interface AdminPersistence {
  setDocument: (collectionName: string, documentId: string, value: unknown) => Promise<void>;
  deleteDocument: (collectionName: string, documentId: string) => Promise<void>;
}

export interface AdminCatalogImageStorage {
  uploadImage: (productId: string, file: File) => Promise<UploadedCatalogImage>;
  deleteImage: (path: string) => Promise<void>;
  pathFromUrl: (url: string, productId?: string) => string | null;
}

export interface AdminAssetStorage {
  uploadImage: (scope: AdminImageScope, ownerId: string, file: File) => Promise<UploadedAdminAsset>;
  uploadFont: (fontId: string, file: File) => Promise<UploadedAdminAsset>;
  deleteAsset: (path: string) => Promise<void>;
  pathFromUrl: (url: string) => string | null;
}

export interface AdminProps {
  products: Anuncio[];
  config: SiteConfig;
  categories: Category[];
  orders: Order[];
  ordersReady: boolean;
  ordersError: string | null;
  promotions: Promocao[];
  persistence?: AdminPersistence;
  catalogImageStorage?: AdminCatalogImageStorage;
  adminAssetStorage?: AdminAssetStorage;
  onLogout?: () => void | Promise<void>;
}

interface ConfirmationState {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

const FIREBASE_PERSISTENCE: AdminPersistence = {
  async setDocument(collectionName, documentId, value) {
    await setDoc(doc(db, collectionName, documentId), value);
  },
  async deleteDocument(collectionName, documentId) {
    await deleteDoc(doc(db, collectionName, documentId));
  },
};

const FIREBASE_CATALOG_IMAGE_STORAGE: AdminCatalogImageStorage = {
  uploadImage: uploadCatalogImage,
  deleteImage: removeCatalogImage,
  pathFromUrl: storedCatalogImagePath,
};

const FIREBASE_ADMIN_ASSET_STORAGE: AdminAssetStorage = {
  uploadImage: uploadAdminImage,
  uploadFont: uploadAdminFont,
  deleteAsset: removeAdminAsset,
  pathFromUrl: storedAdminAssetPath,
};

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

const ORDER_QUEUE_STYLES: Record<OrderQueue, string> = {
  aguardando_pagamento: 'text-amber-400 border-amber-500/30',
  pagamento_confirmado: 'text-green-400 border-green-500/30',
  em_producao: 'text-blue-400 border-blue-500/30',
  pronto_retirada: 'text-purple-400 border-purple-500/30',
  entregue: 'text-gray-400 border-gray-700',
};

function adminPersistenceError(error: unknown, fallback: string): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  if (code.endsWith('permission-denied')) {
    return 'O Firebase recusou a gravação. Publique as regras atuais e saia e entre novamente para renovar a permissão administrativa.';
  }
  if (code.endsWith('unauthenticated')) return 'Sua sessão expirou. Saia e entre novamente no painel.';
  if (code.endsWith('unavailable')) return 'O Firebase está indisponível ou sem conexão. Tente novamente em instantes.';
  if (code.endsWith('invalid-argument')) return 'O Firebase recusou um campo do cadastro. Atualize a página e revise os dados informados.';
  return fallback;
}

export default function Admin({
  products,
  config,
  categories,
  orders,
  ordersReady,
  ordersError,
  promotions,
  persistence = FIREBASE_PERSISTENCE,
  catalogImageStorage = FIREBASE_CATALOG_IMAGE_STORAGE,
  adminAssetStorage = FIREBASE_ADMIN_ASSET_STORAGE,
  onLogout = logout,
}: AdminProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('products');
  const [editingProduct, setEditingProduct] = useState<Partial<Anuncio> | null>(null);
  const [editingPromotion, setEditingPromotion] = useState<Partial<Promocao> | null>(null);
  const [productBaseline, setProductBaseline] = useState<string | null>(null);
  const [promotionBaseline, setPromotionBaseline] = useState<string | null>(null);
  const [configDirty, setConfigDirty] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState<Partial<Category> & { nome: string; icon: string }>({ nome: '', icon: '' });
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryUpload, setCategoryUpload] = useState<UploadedAdminAsset | null>(null);
  const [promotionUpload, setPromotionUpload] = useState<UploadedAdminAsset | null>(null);
  const [configUploads, setConfigUploads] = useState<Partial<Record<'logo_url' | 'banner_principal', UploadedAdminAsset>>>({});
  const [isUploadingAdminAsset, setIsUploadingAdminAsset] = useState(false);
  const [configDraft, setConfigDraft] = useState<SiteConfig>(() => structuredClone(config));
  const [newSystemFont, setNewSystemFont] = useState({ nome: '', cssFamily: '' });
  const [promotionDiscountInput, setPromotionDiscountInput] = useState('');
  const [collapsedOrderQueues, setCollapsedOrderQueues] = useState<Set<OrderQueue>>(() => new Set(['entregue']));
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [productStorageId, setProductStorageId] = useState<string | null>(null);
  const [sessionCatalogUploads, setSessionCatalogUploads] = useState<UploadedCatalogImage[]>([]);
  const [isUploadingCatalogImages, setIsUploadingCatalogImages] = useState(false);
  const originalProductImagesRef = React.useRef<{ productId: string; urls: string[] } | null>(null);
  const missingCommercialFields = missingLegalBusinessFields(configDraft);

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

  React.useEffect(() => {
    if (!configDirty) setConfigDraft(structuredClone(config));
  }, [config]);
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

  const forceCloseProductEditor = React.useCallback(() => {
    setEditingProduct(null);
    setProductBaseline(null);
    setProductStorageId(null);
    setSessionCatalogUploads([]);
    setIsUploadingCatalogImages(false);
    originalProductImagesRef.current = null;
    setShowAttrForm(false);
    setShowBulkImageForm(false);
    setShowCustomAiPrompt(false);
    setAiPreview(null);
    setBulkImages('');
    setCustomAiPrompt('');
    setNewAttr({ nome: '', opcoes: '' });
  }, []);

  const deleteCatalogPaths = React.useCallback(async (paths: string[]) => {
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    const results = await Promise.allSettled(uniquePaths.map(path => catalogImageStorage.deleteImage(path)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) throw failed.reason;
  }, [catalogImageStorage]);

  const deleteAdminPaths = React.useCallback(async (paths: string[]) => {
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    const results = await Promise.allSettled(uniquePaths.map(path => adminAssetStorage.deleteAsset(path)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) throw failed.reason;
  }, [adminAssetStorage]);

  const discardProductEditor = React.useCallback(async () => {
    await deleteCatalogPaths(sessionCatalogUploads.map(upload => upload.path));
    forceCloseProductEditor();
  }, [deleteCatalogPaths, forceCloseProductEditor, sessionCatalogUploads]);

  const forceClosePromotionEditor = React.useCallback(() => {
    setEditingPromotion(null);
    setPromotionBaseline(null);
  }, []);

  const openProductEditor = (draft: Partial<Anuncio>) => {
    const copy = structuredClone(draft);
    const storageId = copy.id || crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const originalUrls = [copy.imagem, ...(copy.imagens || [])]
      .filter((value): value is string => typeof value === 'string' && Boolean(value));
    setEditingProduct(copy);
    setProductBaseline(draftFingerprint(copy));
    setProductStorageId(storageId);
    setSessionCatalogUploads([]);
    originalProductImagesRef.current = { productId: storageId, urls: originalUrls };
  };

  const openPromotionEditor = (draft: Partial<Promocao>) => {
    const copy = structuredClone(draft);
    copy.alvoTipo ||= 'produto';
    copy.descontoTipo ||= 'percentual';
    if (copy.descontoTipo === 'percentual' && copy.descontoPercentual === undefined) {
      copy.descontoPercentual = 10;
    }
    setEditingPromotion(copy);
    setPromotionBaseline(draftFingerprint(copy));
    setPromotionDiscountInput(
      copy.descontoTipo === 'valor_fixo' && Number.isInteger(copy.descontoFixoCentavos)
        ? (Number(copy.descontoFixoCentavos) / 100).toFixed(2).replace('.', ',')
        : '',
    );
    setPromotionUpload(null);
  };

  const discardPromotionEditor = React.useCallback(async () => {
    if (promotionUpload) await deleteAdminPaths([promotionUpload.path]);
    setPromotionUpload(null);
    setPromotionDiscountInput('');
    forceClosePromotionEditor();
  }, [deleteAdminPaths, forceClosePromotionEditor, promotionUpload]);

  const hasUnsavedProduct = Boolean(
    editingProduct && productBaseline !== null && draftFingerprint(editingProduct) !== productBaseline,
  );
  const hasUnsavedPromotion = Boolean(
    editingPromotion && promotionBaseline !== null && draftFingerprint(editingPromotion) !== promotionBaseline,
  );

  const requestCloseProductEditor = React.useCallback(() => {
    if (isSaving || isUploadingCatalogImages) return;
    if (editingProduct && productBaseline !== null && draftFingerprint(editingProduct) !== productBaseline) {
      setConfirmation({
        title: 'Descartar alterações?',
        message: 'As mudanças feitas neste produto ainda não foram salvas.',
        confirmLabel: 'Descartar',
        danger: true,
        onConfirm: discardProductEditor,
      });
      return;
    }
    void discardProductEditor().catch(error => {
      console.error('Não foi possível limpar as imagens temporárias do catálogo:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível fechar o editor de produto.');
    });
  }, [discardProductEditor, editingProduct, isSaving, isUploadingCatalogImages, productBaseline]);

  const requestClosePromotionEditor = React.useCallback(() => {
    if (isSaving) return;
    if (editingPromotion && promotionBaseline !== null && draftFingerprint(editingPromotion) !== promotionBaseline) {
      setConfirmation({
        title: 'Descartar alterações?',
        message: 'As mudanças feitas nesta promoção ainda não foram salvas.',
        confirmLabel: 'Descartar',
        danger: true,
        onConfirm: discardPromotionEditor,
      });
      return;
    }
    void discardPromotionEditor().catch(error => {
      console.error('Não foi possível limpar o banner temporário da promoção:', error);
      setErrorMessage('Não foi possível fechar o editor de promoção.');
    });
  }, [discardPromotionEditor, editingPromotion, isSaving, promotionBaseline]);

  const requestCloseProductEditorRef = React.useRef(requestCloseProductEditor);
  const requestClosePromotionEditorRef = React.useRef(requestClosePromotionEditor);
  requestCloseProductEditorRef.current = requestCloseProductEditor;
  requestClosePromotionEditorRef.current = requestClosePromotionEditor;

  const productEditorOpen = editingProduct !== null;
  const promotionEditorOpen = editingPromotion !== null;
  const confirmationOpen = confirmation !== null;
  const aiPreviewOpen = aiPreview !== null;

  const requestTabChange = (nextTab: AdminTab) => {
    if (nextTab === activeTab) return;
    if (activeTab === 'config' && configDirty) {
      setConfirmation({
        title: 'Sair sem salvar?',
        message: 'As alterações feitas nas configurações serão perdidas.',
        confirmLabel: 'Sair sem salvar',
        danger: true,
        onConfirm: async () => {
          await deleteAdminPaths(Object.values(configUploads)
            .filter((upload): upload is UploadedAdminAsset => Boolean(upload))
            .map(upload => upload.path));
          setConfigUploads({});
          setConfigDraft(structuredClone(config));
          setConfigDirty(false);
          setActiveTab(nextTab);
        },
      });
      return;
    }
    setActiveTab(nextTab);
  };

  const runConfirmedAction = async () => {
    if (!confirmation || isConfirming) return;
    setIsConfirming(true);
    try {
      await confirmation.onConfirm();
      setConfirmation(null);
    } catch (error) {
      console.error('Erro ao executar ação confirmada:', error);
      setErrorMessage('Não foi possível concluir a ação. Tente novamente.');
    } finally {
      setIsConfirming(false);
    }
  };

  React.useEffect(() => {
    const hasUnsavedChanges = configDirty || hasUnsavedProduct || hasUnsavedPromotion;
    if (!hasUnsavedChanges) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [configDirty, hasUnsavedProduct, hasUnsavedPromotion]);

  React.useEffect(() => {
    if (!editingProduct && !editingPromotion && !confirmation) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';

    const activeDialog = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'))
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
        else if (productEditorOpen) requestCloseProductEditorRef.current();
        else if (promotionEditorOpen) requestClosePromotionEditorRef.current();
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
  }, [productEditorOpen, promotionEditorOpen, confirmationOpen, aiPreviewOpen, showCustomAiPrompt, showBulkImageForm]);

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
    if (isBootstrapping) return;
    setIsBootstrapping(true);
    setErrorMessage(null);
    try {
      // Categories
      for (const cat of INITIAL_CATEGORIES) {
        const id = slugifyDocumentId(cat.nome);
        if (!id) continue;
        await persistence.setDocument('categories', id, { ...cat, id });
      }
      // Products
      for (const prod of INITIAL_PRODUCTS) {
        const id = prod.id || crypto.randomUUID().replace(/-/g, '').slice(0, 20);
        await persistence.setDocument('anuncios', id, { ...prod, id });
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
    if (isSaving) return;
    setErrorMessage(null);
    const formData = new FormData(e.currentTarget);
    const updatedConfig: SiteConfig = {
      ...config,
      logo_url: configDraft.logo_url,
      telefone1: formData.get('telefone1') as string,
      telefone2: formData.get('telefone2') as string,
      banner_principal: configDraft.banner_principal,
      banner_titulo: formData.get('banner_titulo') as string,
      banner_subtitulo: formData.get('banner_subtitulo') as string,
      banner_botao: formData.get('banner_botao') as string,
      beneficio1_titulo: formData.get('beneficio1_titulo') as string,
      beneficio1_desc: formData.get('beneficio1_desc') as string,
      beneficio2_titulo: formData.get('beneficio2_titulo') as string,
      beneficio2_desc: formData.get('beneficio2_desc') as string,
      beneficio3_titulo: formData.get('beneficio3_titulo') as string,
      beneficio3_desc: formData.get('beneficio3_desc') as string,
      fontes_personalizacao: configDraft.fontes_personalizacao || [],
      razao_social: String(formData.get('razao_social') || '').trim(),
      documento_fiscal: String(formData.get('documento_fiscal') || '').trim(),
      endereco_comercial: String(formData.get('endereco_comercial') || '').trim(),
      email_atendimento: String(formData.get('email_atendimento') || '').trim().toLowerCase(),
      email_privacidade: String(formData.get('email_privacidade') || '').trim().toLowerCase(),
      prazo_producao: String(formData.get('prazo_producao') || '').trim(),
    };

    const validation = validateSiteConfig(updatedConfig);
    if (validation.ok === false) {
      setErrorMessage(validation.message);
      return;
    }

    setIsSaving(true);
    try {
      await persistence.setDocument('config', 'main', validation.value);
      const usedConfigUrls = new Set([validation.value.logo_url, validation.value.banner_principal]);
      const unusedConfigPaths = Object.values(configUploads)
        .filter((upload): upload is UploadedAdminAsset => Boolean(upload))
        .filter(upload => !usedConfigUrls.has(upload.url))
        .map(upload => upload.path);
      const replacedAssetPaths = [
        config.logo_url && config.logo_url !== validation.value.logo_url ? adminAssetStorage.pathFromUrl(config.logo_url) : null,
        config.banner_principal !== validation.value.banner_principal ? adminAssetStorage.pathFromUrl(config.banner_principal) : null,
      ].filter((path): path is string => Boolean(path));
      if (unusedConfigPaths.length > 0 || replacedAssetPaths.length > 0) {
        try {
          await deleteAdminPaths([...unusedConfigPaths, ...replacedAssetPaths]);
        } catch (cleanupError) {
          console.error('Configurações salvas, mas um arquivo substituído não pôde ser removido:', cleanupError);
        }
      }
      setConfigDraft(validation.value);
      setConfigUploads({});
      setConfigDirty(false);
      setSuccessMessage('Configurações salvas com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'config/main');
      setErrorMessage(adminPersistenceError(error, 'Não foi possível salvar as configurações.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfigImageUpload = async (
    field: 'logo_url' | 'banner_principal',
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || isUploadingAdminAsset) return;
    setIsUploadingAdminAsset(true);
    setErrorMessage(null);
    try {
      const uploaded = await adminAssetStorage.uploadImage('site', field === 'logo_url' ? 'logo' : 'banner', file);
      const previousPendingUpload = configUploads[field];
      if (previousPendingUpload) await deleteAdminPaths([previousPendingUpload.path]);
      setConfigUploads(current => ({ ...current, [field]: uploaded }));
      setConfigDraft(current => ({ ...current, [field]: uploaded.url }));
      setConfigDirty(true);
      setSuccessMessage('Imagem enviada. Salve as configurações para publicar.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível enviar a imagem.');
    } finally {
      setIsUploadingAdminAsset(false);
    }
  };

  const addSystemFont = () => {
    const nome = newSystemFont.nome.trim();
    const cssFamily = newSystemFont.cssFamily.trim();
    const id = slugifyDocumentId(nome).slice(0, 64);
    if (!nome || !cssFamily || !id) {
      setErrorMessage('Informe o nome e a família CSS da fonte.');
      return;
    }
    const nextFonts = [...(configDraft.fontes_personalizacao || []), { id, nome, cssFamily, ativo: true }];
    if (normalizePersonalizationFonts(nextFonts).length !== nextFonts.length) {
      setErrorMessage('A fonte possui dados inválidos ou já existe na lista.');
      return;
    }
    setConfigDraft(current => ({ ...current, fontes_personalizacao: nextFonts }));
    setNewSystemFont({ nome: '', cssFamily: '' });
    setConfigDirty(true);
  };

  const handleFontUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || isUploadingAdminAsset) return;
    const nome = file.name.replace(/\.woff2$/i, '').replace(/[-_]+/g, ' ').trim() || 'Fonte personalizada';
    const baseId = slugifyDocumentId(nome).slice(0, 48) || 'fonte';
    const existingIds = new Set((configDraft.fontes_personalizacao || []).map(font => font.id));
    let id = baseId;
    let suffix = 2;
    while (existingIds.has(id)) {
      id = `${baseId.slice(0, 58)}-${suffix}`;
      suffix += 1;
    }
    setIsUploadingAdminAsset(true);
    setErrorMessage(null);
    try {
      const uploaded = await adminAssetStorage.uploadFont(id, file);
      const font: PersonalizationFont = {
        id,
        nome,
        cssFamily: `GBFont_${id.replace(/-/g, '_')}`,
        arquivoUrl: uploaded.url,
        ativo: true,
      };
      setConfigDraft(current => ({
        ...current,
        fontes_personalizacao: [...(current.fontes_personalizacao || []), font],
      }));
      setConfigDirty(true);
      setSuccessMessage('Fonte enviada. Salve as configurações para disponibilizá-la.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível enviar a fonte.');
    } finally {
      setIsUploadingAdminAsset(false);
    }
  };

  const updateConfiguredFont = (index: number, patch: Partial<PersonalizationFont>) => {
    setConfigDraft(current => ({
      ...current,
      fontes_personalizacao: (current.fontes_personalizacao || []).map((font, fontIndex) => (
        fontIndex === index ? { ...font, ...patch } : font
      )),
    }));
    setConfigDirty(true);
  };

  const removeConfiguredFont = (index: number) => {
    setConfigDraft(current => ({
      ...current,
      fontes_personalizacao: (current.fontes_personalizacao || []).filter((_, fontIndex) => fontIndex !== index),
    }));
    setConfigDirty(true);
  };

  // Category Handlers
  const resetCategoryEditor = async (removePendingUpload = false) => {
    if (removePendingUpload && categoryUpload) await deleteAdminPaths([categoryUpload.path]);
    setCategoryDraft({ nome: '', icon: '' });
    setEditingCategoryId(null);
    setCategoryUpload(null);
  };

  const handleCategoryIconUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || isUploadingAdminAsset) return;
    const ownerId = editingCategoryId || slugifyDocumentId(categoryDraft.nome);
    if (!ownerId) {
      setErrorMessage('Informe o nome da categoria antes de enviar o ícone.');
      return;
    }
    setIsUploadingAdminAsset(true);
    setErrorMessage(null);
    try {
      const uploaded = await adminAssetStorage.uploadImage('categories', ownerId, file);
      if (categoryUpload) await deleteAdminPaths([categoryUpload.path]);
      setCategoryUpload(uploaded);
      setCategoryDraft(current => ({ ...current, icon: uploaded.url }));
      setSuccessMessage('Ícone enviado. Salve a categoria para concluir.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível enviar o ícone.');
    } finally {
      setIsUploadingAdminAsset(false);
    }
  };

  const handleSaveCategory = async () => {
    if (isSaving || isUploadingAdminAsset) return;
    setErrorMessage(null);
    const validation = validateCategoryDraft(categoryDraft, categories, editingCategoryId || undefined);
    if (validation.ok === false) {
      setErrorMessage(validation.message);
      return;
    }
    const previousCategory = editingCategoryId
      ? categories.find(category => category.id === editingCategoryId)
      : undefined;
    setIsSaving(true);
    try {
      await persistence.setDocument('categories', validation.value.id, validation.value);
      if (previousCategory && previousCategory.nome !== validation.value.nome) {
        await Promise.all([
          ...products
            .filter(product => product.categoria === previousCategory.nome)
            .map(product => persistence.setDocument('anuncios', product.id, {
              ...product,
              categoria: validation.value.nome,
            })),
          ...promotions
            .filter(promotion => promotion.alvoTipo === 'categoria' && promotion.alvoId === previousCategory.id)
            .map(promotion => persistence.setDocument('promocoes', promotion.id, {
              ...promotion,
              alvoNome: validation.value.nome,
            })),
        ]);
      }
      const oldIconPath = previousCategory?.icon && previousCategory.icon !== validation.value.icon
        ? adminAssetStorage.pathFromUrl(previousCategory.icon)
        : null;
      const unusedUploadPath = categoryUpload && categoryUpload.url !== validation.value.icon
        ? categoryUpload.path
        : null;
      let cleanupFailed = false;
      try {
        await deleteAdminPaths([oldIconPath, unusedUploadPath].filter((path): path is string => Boolean(path)));
      } catch (cleanupError) {
        cleanupFailed = true;
        console.error('Categoria salva, mas um ícone substituído não pôde ser removido:', cleanupError);
      }
      await resetCategoryEditor(false);
      setSuccessMessage(cleanupFailed
        ? 'Categoria salva, mas um ícone antigo não pôde ser removido do Storage.'
        : previousCategory ? 'Categoria atualizada.' : 'Categoria adicionada.');
    } catch (error) {
      handleFirestoreError(error, previousCategory ? OperationType.UPDATE : OperationType.CREATE, `categories/${validation.value.id}`);
      setErrorMessage(adminPersistenceError(error, 'Não foi possível salvar a categoria.'));
    } finally {
      setIsSaving(false);
    }
  };

  const startCategoryEdit = (category: Category) => {
    setEditingCategoryId(category.id);
    setCategoryDraft({ ...category, icon: category.icon || '' });
    setCategoryUpload(null);
  };

  const moveCategory = async (categoryId: string, direction: -1 | 1) => {
    if (isSaving) return;
    const currentIndex = categories.findIndex(category => category.id === categoryId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= categories.length) return;
    const reordered = [...categories];
    [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
    setIsSaving(true);
    try {
      await Promise.all(reordered.map((category, ordem) => (
        persistence.setDocument('categories', category.id, { ...category, ordem })
      )));
      setSuccessMessage('Ordem das categorias atualizada.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'categories');
      setErrorMessage('Não foi possível reorganizar as categorias.');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteCategory = async (catId: string) => {
    const category = categories.find(item => item.id === catId);
    try {
      await persistence.deleteDocument('categories', catId);
      const iconPath = category?.icon ? adminAssetStorage.pathFromUrl(category.icon) : null;
      if (iconPath) await deleteAdminPaths([iconPath]);
      setSuccessMessage('Categoria excluída.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `categories/${catId}`);
      setErrorMessage(adminPersistenceError(error, 'Não foi possível excluir a categoria.'));
    }
  };

  const handleDeleteCategory = (catId: string) => {
    const category = categories.find(item => item.id === catId);
    if (category && products.some(product => product.categoria === category.nome)) {
      setErrorMessage('Esta categoria ainda possui produtos. Mova-os antes de excluir.');
      return;
    }
    if (promotions.some(promotion => promotion.alvoTipo === 'categoria' && promotion.alvoId === catId)) {
      setErrorMessage('Esta categoria ainda possui uma promoção vinculada. Edite ou exclua a promoção primeiro.');
      return;
    }
    setConfirmation({
      title: 'Excluir categoria?',
      message: `A categoria “${category?.nome || catId}” será removida.`,
      confirmLabel: 'Excluir categoria',
      danger: true,
      onConfirm: () => deleteCategory(catId),
    });
  };

  // Product Handlers
  const uploadCatalogFiles = async (files: File[]): Promise<UploadedCatalogImage[]> => {
    if (!editingProduct || !productStorageId || isUploadingCatalogImages) return [];
    if (files.length === 0) return [];

    const invalidFile = files.find(file => !isAllowedCatalogImage(file.type, file.size));
    if (invalidFile) {
      throw new Error(`“${invalidFile.name}” não é JPG, PNG ou WebP válido de até ${MAX_CATALOG_IMAGE_BYTES / 1024 / 1024} MB.`);
    }

    setIsUploadingCatalogImages(true);
    const uploaded: UploadedCatalogImage[] = [];
    try {
      for (const file of files) {
        uploaded.push(await catalogImageStorage.uploadImage(productStorageId, file));
      }
      setSessionCatalogUploads(current => [...current, ...uploaded]);
      return uploaded;
    } catch (error) {
      await Promise.allSettled(uploaded.map(image => catalogImageStorage.deleteImage(image.path)));
      throw error;
    } finally {
      setIsUploadingCatalogImages(false);
    }
  };

  const handleMainImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setErrorMessage(null);
    try {
      const [uploaded] = await uploadCatalogFiles([file]);
      if (!uploaded) return;
      setEditingProduct(current => current ? { ...current, imagem: uploaded.url } : current);
      setSuccessMessage('Imagem principal enviada. Salve o produto para concluir.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível enviar a imagem principal.');
    }
  };

  const handleGalleryImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
    event.target.value = '';
    if (files.length === 0 || !editingProduct) return;

    const availableSlots = ADMIN_LIMITS.galleryImages - (editingProduct.imagens?.length || 0);
    if (files.length > availableSlots) {
      setErrorMessage(`A galeria aceita no máximo ${ADMIN_LIMITS.galleryImages} imagens. Restam ${Math.max(availableSlots, 0)} espaços.`);
      return;
    }

    setErrorMessage(null);
    try {
      const uploaded = await uploadCatalogFiles(files);
      if (uploaded.length === 0) return;
      setEditingProduct(current => current ? {
        ...current,
        imagens: [...(current.imagens || []), ...uploaded.map(image => image.url)],
      } : current);
      setSuccessMessage(`${uploaded.length} ${uploaded.length === 1 ? 'imagem adicionada' : 'imagens adicionadas'} à galeria. Salve o produto para concluir.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível enviar as imagens da galeria.');
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct || isSaving || isUploadingCatalogImages) return;
    setErrorMessage(null);
    const validation = validateProductDraft(editingProduct, categories, products);
    if (validation.ok === false) {
      setErrorMessage(validation.message);
      return;
    }

    const id = editingProduct.id || productStorageId || crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const productToSave: Anuncio = {
      ...validation.value,
      id,
    };

    setIsSaving(true);
    try {
      await persistence.setDocument('anuncios', id, productToSave);
      const finalUrls = new Set([productToSave.imagem, ...(productToSave.imagens || [])]);
      const original = originalProductImagesRef.current;
      const staleOriginalPaths = original
        ? original.urls
          .filter(url => !finalUrls.has(url))
          .map(url => catalogImageStorage.pathFromUrl(url, original.productId))
          .filter((path): path is string => Boolean(path))
        : [];
      const unusedSessionPaths = sessionCatalogUploads
        .filter(upload => !finalUrls.has(upload.url))
        .map(upload => upload.path);
      let cleanupFailed = false;
      try {
        await deleteCatalogPaths([...staleOriginalPaths, ...unusedSessionPaths]);
      } catch (cleanupError) {
        cleanupFailed = true;
        console.error('Produto salvo, mas houve falha ao limpar imagens substituídas:', cleanupError);
      }
      forceCloseProductEditor();
      setSuccessMessage(cleanupFailed
        ? 'Produto salvo, mas uma imagem antiga não pôde ser removida do Storage.'
        : 'Anúncio salvo com sucesso!');
    } catch (error) {
      console.error('Erro ao salvar anúncio:', error);
      setErrorMessage(adminPersistenceError(error, 'Não foi possível salvar o anúncio. Verifique os campos e tente novamente.'));
      handleFirestoreError(error, OperationType.WRITE, `anuncios/${id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteProduct = async (id: string) => {
    const product = products.find(item => item.id === id);
    try {
      await persistence.deleteDocument('anuncios', id);
      const catalogPaths = product
        ? [product.imagem, ...(product.imagens || [])]
          .map(url => catalogImageStorage.pathFromUrl(url, id))
          .filter((path): path is string => Boolean(path))
        : [];
      let cleanupFailed = false;
      try {
        await deleteCatalogPaths(catalogPaths);
      } catch (cleanupError) {
        cleanupFailed = true;
        console.error('Produto excluído, mas houve falha ao limpar suas imagens:', cleanupError);
      }
      setSuccessMessage(cleanupFailed
        ? 'Produto excluído, mas uma imagem não pôde ser removida do Storage.'
        : 'Anúncio excluído com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `anuncios/${id}`);
      setErrorMessage(adminPersistenceError(error, 'Não foi possível excluir o anúncio.'));
    }
  };

  const handleDeleteProduct = (id: string) => {
    const product = products.find(item => item.id === id);
    setConfirmation({
      title: 'Excluir produto?',
      message: `O produto “${product?.nome || id}” será excluído permanentemente.`,
      confirmLabel: 'Excluir produto',
      danger: true,
      onConfirm: () => deleteProduct(id),
    });
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

  const toggleOrderQueue = (queue: OrderQueue) => {
    setCollapsedOrderQueues(current => {
      const next = new Set(current);
      if (next.has(queue)) next.delete(queue);
      else next.add(queue);
      return next;
    });
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
  const handlePromotionImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !editingPromotion || isUploadingAdminAsset) return;
    const ownerId = editingPromotion.id || slugifyDocumentId(editingPromotion.titulo || '') || crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    setIsUploadingAdminAsset(true);
    setErrorMessage(null);
    try {
      const uploaded = await adminAssetStorage.uploadImage('promotions', ownerId, file);
      if (promotionUpload) await deleteAdminPaths([promotionUpload.path]);
      setPromotionUpload(uploaded);
      setEditingPromotion(current => current ? { ...current, imagem: uploaded.url } : current);
      setSuccessMessage('Banner enviado. Salve a promoção para concluir.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível enviar o banner.');
    } finally {
      setIsUploadingAdminAsset(false);
    }
  };

  const handleSavePromotion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPromotion || isSaving) return;
    setErrorMessage(null);
    const promotionDraft = editingPromotion.descontoTipo === 'valor_fixo'
      ? { ...editingPromotion, descontoFixoCentavos: parseMoneyToCents(promotionDiscountInput) ?? undefined }
      : editingPromotion;
    const validation = validatePromotionDraft(promotionDraft, products, categories);
    if (validation.ok === false) {
      setErrorMessage(validation.message);
      return;
    }

    const id = editingPromotion.id || crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const promotionToSave: Promocao = {
      ...validation.value,
      id,
    };

    setIsSaving(true);
    try {
      await persistence.setDocument('promocoes', id, promotionToSave);
      const previousPromotion = promotions.find(promotion => promotion.id === id);
      const previousImagePath = previousPromotion?.imagem && previousPromotion.imagem !== promotionToSave.imagem
        ? adminAssetStorage.pathFromUrl(previousPromotion.imagem)
        : null;
      const unusedUploadPath = promotionUpload && promotionUpload.url !== promotionToSave.imagem
        ? promotionUpload.path
        : null;
      let cleanupFailed = false;
      try {
        await deleteAdminPaths([previousImagePath, unusedUploadPath].filter((path): path is string => Boolean(path)));
      } catch (cleanupError) {
        cleanupFailed = true;
        console.error('Promoção salva, mas um banner substituído não pôde ser removido:', cleanupError);
      }
      setPromotionUpload(null);
      forceClosePromotionEditor();
      setSuccessMessage(cleanupFailed
        ? 'Promoção salva, mas um banner antigo não pôde ser removido do Storage.'
        : 'Promoção salva com sucesso!');
    } catch (error) {
      setErrorMessage(adminPersistenceError(error, 'Não foi possível salvar a promoção.'));
      handleFirestoreError(error, OperationType.WRITE, `promocoes/${id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const deletePromotion = async (id: string) => {
    const promotion = promotions.find(item => item.id === id);
    try {
      await persistence.deleteDocument('promocoes', id);
      const imagePath = promotion?.imagem ? adminAssetStorage.pathFromUrl(promotion.imagem) : null;
      if (imagePath) await deleteAdminPaths([imagePath]);
      setSuccessMessage('Promoção excluída com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `promocoes/${id}`);
      setErrorMessage(adminPersistenceError(error, 'Não foi possível excluir a promoção.'));
    }
  };

  const handleDeletePromotion = (id: string) => {
    const promotion = promotions.find(item => item.id === id);
    setConfirmation({
      title: 'Excluir promoção?',
      message: `A promoção “${promotion?.titulo || id}” será removida.`,
      confirmLabel: 'Excluir promoção',
      danger: true,
      onConfirm: () => deletePromotion(id),
    });
  };

  const performLogout = async () => {
    try {
      await onLogout();
    } catch (error) {
      console.error('Erro ao sair do painel:', error);
      setErrorMessage('Não foi possível encerrar a sessão. Tente novamente.');
    }
  };

  const handleStoreLink = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!configDirty) return;
    event.preventDefault();
    setConfirmation({
      title: 'Voltar sem salvar?',
      message: 'As alterações feitas nas configurações serão perdidas.',
      confirmLabel: 'Voltar para a loja',
      danger: true,
      onConfirm: () => {
        setConfigDirty(false);
        window.location.assign('/');
      },
    });
  };

  const handleLogout = () => {
    if (!configDirty) {
      void performLogout();
      return;
    }
    setConfirmation({
      title: 'Sair sem salvar?',
      message: 'As alterações feitas nas configurações serão perdidas e a sessão será encerrada.',
      confirmLabel: 'Sair do Admin',
      danger: true,
      onConfirm: async () => {
        setConfigDirty(false);
        await performLogout();
      },
    });
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
              onClick={() => requestTabChange('products')}
              aria-current={activeTab === 'products' ? 'page' : undefined}
              className={cn("w-auto shrink-0 lg:w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors", activeTab === 'products' ? "bg-[#ff4d79] text-white" : "text-gray-400 hover:bg-gray-800")}
            >
              <Layout size={18} /> Produtos
            </button>
            <button
              onClick={() => requestTabChange('categories')}
              aria-current={activeTab === 'categories' ? 'page' : undefined}
              className={cn("w-auto shrink-0 lg:w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors", activeTab === 'categories' ? "bg-[#ff4d79] text-white" : "text-gray-400 hover:bg-gray-800")}
            >
              <List size={18} /> Categorias
            </button>
            <button
              onClick={() => requestTabChange('orders')}
              aria-current={activeTab === 'orders' ? 'page' : undefined}
              className={cn("w-auto shrink-0 lg:w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors", activeTab === 'orders' ? "bg-[#ff4d79] text-white" : "text-gray-400 hover:bg-gray-800")}
            >
              <Package size={18} /> Pedidos
            </button>
            <button
              onClick={() => requestTabChange('promotions')}
              aria-current={activeTab === 'promotions' ? 'page' : undefined}
              className={cn("w-auto shrink-0 lg:w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors", activeTab === 'promotions' ? "bg-[#ff4d79] text-white" : "text-gray-400 hover:bg-gray-800")}
            >
              <Tag size={18} /> Promoções
            </button>
            <button
              onClick={() => requestTabChange('config')}
              aria-current={activeTab === 'config' ? 'page' : undefined}
              className={cn("w-auto shrink-0 lg:w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors", activeTab === 'config' ? "bg-[#ff4d79] text-white" : "text-gray-400 hover:bg-gray-800")}
            >
              <Settings size={18} /> Configurações
            </button>
          </nav>
        </div>

        <div className="mt-auto flex flex-wrap gap-4 px-4 pb-4 sm:px-6 sm:pb-6 lg:flex-col lg:p-8">
          <Link to="/" onClick={handleStoreLink} className="flex items-center gap-2 text-xs text-gray-500 hover:text-white transition-colors">
            <ArrowLeft size={14} /> Voltar para a Loja
          </Link>
          <button onClick={handleLogout} className="flex items-center gap-2 text-xs text-red-500 hover:text-red-400 transition-colors">
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
                onClick={() => openProductEditor({
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
                    <div className="absolute inset-0 bg-black/60 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity flex items-center justify-center gap-4">
                      <button type="button" onClick={() => openProductEditor(p)} aria-label={`Editar ${p.nome}`} className="p-3 bg-white text-black rounded-full hover:scale-110 transition-transform">
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
              <div>
                <h3 className="font-bold">{editingCategoryId ? 'Editar categoria' : 'Nova categoria'}</h3>
                <p className="mt-1 text-xs text-gray-500">O ícone pode ser enviado do computador e a ordem abaixo controla a navegação da loja.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor="category-name" className="text-xs font-bold uppercase tracking-widest text-gray-500">Nome da Categoria</label>
                  <input
                    id="category-name"
                    type="text"
                    maxLength={ADMIN_LIMITS.categoryName}
                    value={categoryDraft.nome}
                    onChange={(e) => setCategoryDraft(current => ({ ...current, nome: e.target.value }))}
                    placeholder="Ex: Etiquetas p/ Objetos"
                    className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                  />
                </div>
                <div className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Ícone</span>
                  <div className="flex items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[#ff4d79]/50 bg-[#ff4d79]/10 px-4 py-3 text-xs font-bold text-[#ff4d79] hover:border-[#ff4d79]">
                      {isUploadingAdminAsset ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                      {isUploadingAdminAsset ? 'Enviando...' : 'Enviar do computador'}
                      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleCategoryIconUpload} disabled={isUploadingAdminAsset} className="sr-only" />
                    </label>
                    {categoryDraft.icon && <img src={categoryDraft.icon} alt="Prévia do ícone" className="h-12 w-12 rounded-lg border border-gray-800 bg-white object-contain p-1" />}
                  </div>
                  <details className="text-xs text-gray-500">
                    <summary className="cursor-pointer hover:text-gray-300">Usar URL externa</summary>
                    <input
                      type="url"
                      aria-label="URL externa do ícone"
                      value={categoryDraft.icon}
                      onChange={(e) => setCategoryDraft(current => ({ ...current, icon: e.target.value }))}
                      placeholder="https://exemplo.com/icone.png"
                      className="mt-2 w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                    />
                  </details>
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button type="button" onClick={handleSaveCategory} disabled={isSaving || isUploadingAdminAsset} className="bg-[#ff4d79] px-8 py-3 rounded-lg font-bold hover:bg-[#e6004c] w-full sm:w-auto disabled:opacity-50">
                  {isSaving ? 'Salvando...' : editingCategoryId ? 'Salvar Categoria' : 'Adicionar Categoria'}
                </button>
                {editingCategoryId && (
                  <button type="button" onClick={() => void resetCategoryEditor(true)} disabled={isSaving || isUploadingAdminAsset} className="px-8 py-3 rounded-lg border border-gray-700 font-bold hover:bg-gray-800 disabled:opacity-50">
                    Cancelar edição
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {categories.map((cat, index) => (
                <div key={cat.id} className="bg-[#111111] border border-gray-800 p-4 rounded-lg flex justify-between items-center group">
                  <div className="flex items-center gap-4">
                    <span className="w-6 text-center text-xs font-black text-gray-600">{index + 1}</span>
                    {cat.icon && <img src={cat.icon} alt="" className="w-8 h-8 object-contain" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
                    <span className="font-bold text-sm uppercase tracking-wider">{cat.nome}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => void moveCategory(cat.id, -1)} disabled={index === 0 || isSaving} aria-label={`Mover ${cat.nome} para cima`} className="p-2 text-gray-500 hover:text-white disabled:opacity-20"><ArrowUp size={16} /></button>
                    <button type="button" onClick={() => void moveCategory(cat.id, 1)} disabled={index === categories.length - 1 || isSaving} aria-label={`Mover ${cat.nome} para baixo`} className="p-2 text-gray-500 hover:text-white disabled:opacity-20"><ArrowDown size={16} /></button>
                    <button type="button" onClick={() => startCategoryEdit(cat)} aria-label={`Editar ${cat.nome}`} className="p-2 text-gray-500 hover:text-[#ff4d79]"><Edit2 size={16} /></button>
                    <button type="button" onClick={() => handleDeleteCategory(cat.id)} aria-label={`Excluir ${cat.nome}`} className="p-2 text-gray-500 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'orders' && (
          <div className="space-y-8">
            <div>
              <h2 className="text-2xl font-bold">Pedidos Recebidos</h2>
              <p className="mt-2 text-sm text-gray-500">As filas seguem a prioridade operacional. Clique no título para minimizar uma etapa.</p>
            </div>
            {!ordersReady && <div role="status" className="text-sm text-gray-400 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Carregando pedidos...</div>}
            {ordersError && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{ordersError}</div>}
            {ORDER_QUEUE_ORDER.map(queue => {
              const queueOrders = orders.filter(order => orderQueueFor(order) === queue);
              const collapsed = collapsedOrderQueues.has(queue);
              return (
                <section key={queue} className="rounded-xl border border-gray-800 bg-[#0d0d0d] p-4 sm:p-6">
                  <button
                    type="button"
                    onClick={() => toggleOrderQueue(queue)}
                    aria-expanded={!collapsed}
                    className={`flex w-full items-center justify-between border-b pb-3 text-left ${ORDER_QUEUE_STYLES[queue]}`}
                  >
                    <span className="flex items-center gap-3">
                      <Package size={20} />
                      <span className="text-lg font-bold">{orderQueueLabel(queue)}</span>
                      <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs font-black text-gray-300">{queueOrders.length}</span>
                    </span>
                    {collapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                  </button>
                  {!collapsed && (
                    <div className="mt-5 space-y-4">
                      {queueOrders.length === 0 ? (
                        <div className="text-sm italic text-gray-600">Nenhum pedido nesta etapa.</div>
                      ) : queueOrders.map(order => (
                        <OrderCard key={order.id} order={order} handleStatusChange={handleStatusChange} handleOpenArtwork={handleOpenArtwork} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {activeTab === 'config' && (
          <div className="max-w-5xl space-y-8">
            <div>
              <h2 className="text-2xl font-bold">Configurações do Site</h2>
              <p className="mt-2 text-sm text-gray-500">Identidade, atendimento, conteúdo da página inicial, personalização e dados legais.</p>
            </div>

            <form key={draftFingerprint(config)} onSubmit={handleSaveConfig} onChange={() => setConfigDirty(true)} className="space-y-8">
              <section className="rounded-xl border border-gray-800 bg-[#111111] p-6 space-y-6">
                <div className="flex items-center gap-3">
                  <Image className="text-[#ff4d79]" size={20} />
                  <div><h3 className="font-bold">Identidade visual e banner</h3><p className="text-xs text-gray-500">Arquivos enviados ficam no Storage do projeto.</p></div>
                </div>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="space-y-3">
                    <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Logo do site</span>
                    <div className="flex items-center gap-4">
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[#ff4d79]/50 bg-[#ff4d79]/10 px-4 py-3 text-xs font-bold text-[#ff4d79] hover:border-[#ff4d79]">
                        {isUploadingAdminAsset ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Enviar logo
                        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void handleConfigImageUpload('logo_url', event)} disabled={isUploadingAdminAsset} className="sr-only" />
                      </label>
                      {configDraft.logo_url && <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-gray-800 bg-white p-2"><img src={resolvePublicImage(configDraft.logo_url)} alt="Prévia do logo" className="max-h-full max-w-full object-contain" /></div>}
                    </div>
                    <details className="text-xs text-gray-500"><summary className="cursor-pointer hover:text-gray-300">Usar URL externa</summary><input type="url" aria-label="URL externa do logo" value={configDraft.logo_url || ''} onChange={event => { setConfigDraft(current => ({ ...current, logo_url: event.target.value })); setConfigDirty(true); }} className="mt-2 w-full rounded-lg border border-gray-800 bg-black px-4 py-3 outline-none focus:border-[#ff4d79]" /></details>
                  </div>
                  <div className="space-y-3">
                    <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Imagem do banner principal</span>
                    <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[#ff4d79]/50 bg-[#ff4d79]/10 px-4 py-3 text-xs font-bold text-[#ff4d79] hover:border-[#ff4d79]">
                      {isUploadingAdminAsset ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Enviar banner
                      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void handleConfigImageUpload('banner_principal', event)} disabled={isUploadingAdminAsset} className="sr-only" />
                    </label>
                    {configDraft.banner_principal && <img src={configDraft.banner_principal} alt="Prévia do banner" className="h-28 w-full rounded-lg border border-gray-800 object-cover" />}
                    <details className="text-xs text-gray-500"><summary className="cursor-pointer hover:text-gray-300">Usar URL externa</summary><input type="url" aria-label="URL externa do banner principal" value={configDraft.banner_principal} onChange={event => { setConfigDraft(current => ({ ...current, banner_principal: event.target.value })); setConfigDirty(true); }} className="mt-2 w-full rounded-lg border border-gray-800 bg-black px-4 py-3 outline-none focus:border-[#ff4d79]" /></details>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2"><label htmlFor="config-banner-title" className="text-xs font-bold uppercase tracking-widest text-gray-500">Título do Banner</label><input id="config-banner-title" name="banner_titulo" defaultValue={config.banner_titulo} maxLength={160} className="w-full rounded-lg border border-gray-800 bg-black px-4 py-3 outline-none focus:border-[#ff4d79]" /></div>
                  <div className="space-y-2"><label htmlFor="config-banner-subtitle" className="text-xs font-bold uppercase tracking-widest text-gray-500">Subtítulo</label><input id="config-banner-subtitle" name="banner_subtitulo" defaultValue={config.banner_subtitulo} maxLength={300} className="w-full rounded-lg border border-gray-800 bg-black px-4 py-3 outline-none focus:border-[#ff4d79]" /></div>
                  <div className="space-y-2"><label htmlFor="config-banner-button" className="text-xs font-bold uppercase tracking-widest text-gray-500">Texto do botão</label><input id="config-banner-button" name="banner_botao" defaultValue={config.banner_botao} maxLength={80} className="w-full rounded-lg border border-gray-800 bg-black px-4 py-3 outline-none focus:border-[#ff4d79]" /></div>
                </div>
              </section>

              <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                <section className="rounded-xl border border-gray-800 bg-[#111111] p-6 space-y-5">
                  <div className="flex items-center gap-3"><Settings className="text-[#ff4d79]" size={20} /><h3 className="font-bold">Atendimento</h3></div>
                  <div className="space-y-2"><label htmlFor="config-phone-1" className="text-xs font-bold uppercase tracking-widest text-gray-500">WhatsApp principal</label><input id="config-phone-1" name="telefone1" type="tel" defaultValue={config.telefone1} autoComplete="tel" className="w-full rounded-lg border border-gray-800 bg-black px-4 py-3 outline-none focus:border-[#ff4d79]" /></div>
                  <div className="space-y-2"><label htmlFor="config-phone-2" className="text-xs font-bold uppercase tracking-widest text-gray-500">WhatsApp alternativo</label><input id="config-phone-2" name="telefone2" type="tel" defaultValue={config.telefone2} autoComplete="tel" className="w-full rounded-lg border border-gray-800 bg-black px-4 py-3 outline-none focus:border-[#ff4d79]" /></div>
                </section>
                <section className="rounded-xl border border-gray-800 bg-[#111111] p-6 space-y-5">
                  <div className="flex items-center gap-3"><Sparkles className="text-[#ff4d79]" size={20} /><h3 className="font-bold">Benefícios da loja</h3></div>
                  {BENEFIT_FIELDS.map(benefit => (
                    <div key={benefit.number} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input aria-label={`Título do benefício ${benefit.number}`} name={benefit.title} defaultValue={config[benefit.title]} maxLength={100} placeholder={`Título ${benefit.number}`} className="rounded border border-gray-800 bg-black px-3 py-2 text-sm" />
                      <input aria-label={`Descrição do benefício ${benefit.number}`} name={benefit.description} defaultValue={config[benefit.description]} maxLength={180} placeholder="Descrição" className="rounded border border-gray-800 bg-black px-3 py-2 text-sm" />
                    </div>
                  ))}
                </section>
              </div>

              <section className="rounded-xl border border-purple-500/30 bg-[#111111] p-6 space-y-6">
                <div className="flex items-center gap-3"><Type className="text-purple-400" size={20} /><div><h3 className="font-bold">Fontes da personalização</h3><p className="text-xs text-gray-500">Somente as fontes ativas aparecem para o cliente. Nenhuma opção é predefinida pelo código.</p></div></div>
                <div className="space-y-3">
                  {(configDraft.fontes_personalizacao || []).map((font, index) => (
                    <div key={font.id} className="grid grid-cols-1 items-center gap-3 rounded-lg border border-gray-800 bg-black p-4 sm:grid-cols-[1fr_1fr_auto_auto]">
                      <input aria-label={`Nome da fonte ${index + 1}`} value={font.nome} onChange={event => updateConfiguredFont(index, { nome: event.target.value })} className="rounded border border-gray-800 bg-[#111111] px-3 py-2 text-sm" />
                      <div className="min-w-0"><div style={{ fontFamily: font.cssFamily }} className="truncate text-lg">Texto de exemplo</div><div className="truncate text-[10px] text-gray-600">{font.arquivoUrl ? 'Arquivo WOFF2' : font.cssFamily}</div></div>
                      <label className="flex items-center gap-2 text-xs font-bold text-gray-400"><input type="checkbox" checked={font.ativo} onChange={event => updateConfiguredFont(index, { ativo: event.target.checked })} className="accent-[#ff4d79]" /> Ativa</label>
                      <button type="button" onClick={() => removeConfiguredFont(index)} aria-label={`Remover fonte ${font.nome}`} className="p-2 text-gray-500 hover:text-red-500"><Trash2 size={17} /></button>
                    </div>
                  ))}
                  {(configDraft.fontes_personalizacao || []).length === 0 && <p className="rounded-lg border border-dashed border-gray-800 p-5 text-sm text-gray-500">Nenhuma fonte cadastrada. Produtos com texto ficam indisponíveis até que ao menos uma fonte ativa seja salva.</p>}
                </div>
                <div className="grid grid-cols-1 gap-4 border-t border-gray-800 pt-5 md:grid-cols-[1fr_1fr_auto]">
                  <input aria-label="Nome da nova fonte do sistema" value={newSystemFont.nome} onChange={event => setNewSystemFont(current => ({ ...current, nome: event.target.value }))} placeholder="Nome exibido, ex.: Montserrat" className="rounded-lg border border-gray-800 bg-black px-4 py-3 text-sm" />
                  <input aria-label="Família CSS da nova fonte" value={newSystemFont.cssFamily} onChange={event => setNewSystemFont(current => ({ ...current, cssFamily: event.target.value }))} placeholder="Família CSS, ex.: Montserrat, sans-serif" className="rounded-lg border border-gray-800 bg-black px-4 py-3 text-sm" />
                  <button type="button" onClick={addSystemFont} className="rounded-lg border border-gray-700 px-5 py-3 text-xs font-bold hover:bg-gray-800">Adicionar fonte do sistema</button>
                </div>
                <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg bg-purple-500 px-5 py-3 text-xs font-bold text-white hover:bg-purple-600">
                  {isUploadingAdminAsset ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Enviar arquivo WOFF2
                  <input type="file" accept=".woff2,font/woff2,application/font-woff2" onChange={handleFontUpload} disabled={isUploadingAdminAsset} className="sr-only" />
                </label>
                <p className="text-[10px] text-gray-600">Remover uma fonte da lista não apaga o arquivo imediatamente, preservando a leitura de pedidos antigos.</p>
              </section>

              <section className="p-6 bg-[#111111] border border-amber-500/30 rounded-xl space-y-6">
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

              <div className="flex justify-end border-t border-gray-800 pt-6">
                <button type="submit" disabled={isSaving || isUploadingAdminAsset} className="bg-[#ff4d79] px-12 py-4 rounded-full font-bold hover:bg-[#e6004c] transition-colors shadow-lg shadow-[#ff4d79]/20 disabled:opacity-50 flex items-center justify-center gap-2">
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
                onClick={() => openPromotionEditor({
                  titulo: '',
                  imagem: '',
                  ativa: true,
                  alvoTipo: 'produto',
                  alvoId: products[0]?.id || '',
                  descontoTipo: 'percentual',
                  descontoPercentual: 10,
                })}
                className="bg-[#ff4d79] px-6 py-2 rounded-full font-bold text-sm flex items-center gap-2 hover:bg-[#e6004c] transition-colors"
              >
                <Plus size={18} /> Nova Promoção
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {promotions.map(promo => (
                <div key={promo.id} className="bg-[#111111] border border-gray-800 rounded-xl overflow-hidden group">
                  <div className="aspect-[21/9] relative">
                    {promo.imagem ? (
                      <img src={promo.imagem} alt={promo.titulo} className="w-full h-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-black text-gray-700"><Image size={36} /></div>
                    )}
                    <div className="absolute inset-0 bg-black/60 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity flex items-center justify-center gap-4">
                      <button type="button" onClick={() => openPromotionEditor(promo)} aria-label={`Editar ${promo.titulo}`} className="p-3 bg-white text-black rounded-full hover:scale-110 transition-transform">
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
                    <div className="text-[10px] text-gray-500 truncate">{promo.alvoNome || 'Promoção antiga sem alvo configurado'}</div>
                    <div className="mt-2 text-xs font-black text-[#ff4d79]">
                      {promo.descontoTipo === 'percentual' && promo.descontoPercentual
                        ? `${formattedDiscountPercentage(promo.descontoPercentual)}% OFF`
                        : promo.descontoTipo === 'valor_fixo' && promo.descontoFixoCentavos
                          ? `${formatMoney(promo.descontoFixoCentavos / 100)} de desconto`
                          : 'Desconto ainda não configurado'}
                    </div>
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
            <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={requestCloseProductEditor} />
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
                <button type="button" onClick={requestCloseProductEditor} disabled={isSaving || isUploadingCatalogImages} aria-label="Fechar editor de produto" className="disabled:opacity-50"><X size={24} /></button>
              </div>

              <form onSubmit={handleSaveProduct} className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label htmlFor="product-name" className="text-xs font-bold text-gray-500 uppercase">Nome do Produto</label>
                      <button
                        type="button"
                        onClick={() => handleAiAction('improveTitle')}
                        className="flex items-center gap-1 text-[10px] font-bold text-[#ff4d79] hover:underline"
                      >
                        <Sparkles size={10} /> Melhorar com IA
                      </button>
                    </div>
                    <input
                      id="product-name"
                      required
                      value={editingProduct.nome}
                      maxLength={199}
                      onChange={e => setEditingProduct({...editingProduct, nome: e.target.value})}
                      className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label htmlFor="product-description" className="text-xs font-bold text-gray-500 uppercase">Descrição</label>
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
                      id="product-description"
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
                      <label htmlFor="product-category" className="text-xs font-bold text-gray-500 uppercase">Categoria</label>
                      <select
                        id="product-category"
                        value={editingProduct.categoria}
                        onChange={e => setEditingProduct({...editingProduct, categoria: e.target.value})}
                        className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                      >
                        <option value="">Selecionar Categoria</option>
                        {categories.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="product-base-price" className="text-xs font-bold text-gray-500 uppercase">Preço Base (Texto)</label>
                      <input
                        id="product-base-price"
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
                      <span className="text-xs font-bold text-gray-500 uppercase">Imagem Principal</span>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <label className={cn(
                          "flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-3 text-xs font-bold transition-colors",
                          isUploadingCatalogImages
                            ? "cursor-wait border-gray-800 bg-black text-gray-600"
                            : "border-[#ff4d79]/50 bg-[#ff4d79]/10 text-[#ff4d79] hover:border-[#ff4d79]",
                        )}>
                          {isUploadingCatalogImages ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                          {isUploadingCatalogImages ? 'Enviando...' : 'Selecionar do computador'}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={handleMainImageUpload}
                            disabled={isUploadingCatalogImages}
                            aria-label="Selecionar imagem principal do computador"
                            className="sr-only"
                          />
                        </label>
                        {editingProduct.imagem && (
                          <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg border border-gray-800 bg-black">
                            <img
                              src={editingProduct.imagem}
                              alt="Prévia da imagem principal"
                              className="h-full w-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-500">JPG, PNG ou WebP, até 8 MB. A imagem será hospedada no Firebase Storage.</p>
                      <label htmlFor="product-main-image" className="text-[10px] font-bold text-gray-600 uppercase">Imagem Principal (URL)</label>
                      <input
                        id="product-main-image"
                        required
                        value={editingProduct.imagem || ''}
                        onChange={e => setEditingProduct(current => current ? { ...current, imagem: e.target.value } : current)}
                        placeholder="Preenchida automaticamente após o upload ou cole uma URL"
                        className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-gray-500 uppercase">Galeria de Fotos (Opcional)</span>
                        <div className="flex items-center gap-3">
                          <label
                            htmlFor="product-gallery-files"
                            className={cn(
                              "cursor-pointer text-[10px] font-bold hover:underline",
                              isUploadingCatalogImages ? "pointer-events-none text-gray-600" : "text-[#ff4d79]",
                            )}
                          >
                            + Do computador
                          </label>
                          <button
                            type="button"
                            onClick={() => setShowBulkImageForm(true)}
                            disabled={isUploadingCatalogImages}
                            className="text-gray-500 text-[10px] font-bold hover:text-[#ff4d79] hover:underline disabled:opacity-50"
                          >
                            + Por URL
                          </button>
                        </div>
                      </div>

                      <input
                        id="product-gallery-files"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        onChange={handleGalleryImageUpload}
                        disabled={isUploadingCatalogImages}
                        aria-label="Adicionar imagens do computador à galeria"
                        className="sr-only"
                      />

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
                              aria-label={`Remover imagem ${idx + 1} da galeria`}
                              className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ))}
                        <label
                          htmlFor="product-gallery-files"
                          aria-label="Adicionar imagem à galeria"
                          className={cn(
                            "aspect-square border border-dashed border-gray-700 rounded flex items-center justify-center text-gray-500 transition-colors",
                            isUploadingCatalogImages
                              ? "cursor-wait opacity-50"
                              : "cursor-pointer hover:border-[#ff4d79] hover:text-[#ff4d79]",
                          )}
                        >
                          {isUploadingCatalogImages ? <Loader2 size={20} className="animate-spin" /> : <Plus size={20} />}
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label htmlFor="product-customization-type" className="text-xs font-bold text-gray-500 uppercase">Tipo de Personalização</label>
                      <select
                        id="product-customization-type"
                        value={editingProduct.tipoInput || 'nenhum'}
                        onChange={e => setEditingProduct({...editingProduct, tipoInput: e.target.value as Anuncio['tipoInput']})}
                        className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                      >
                        <option value="nenhum">Nenhuma</option>
                        <option value="arte">Upload de Arte</option>
                        <option value="texto">Texto (Nome, etc)</option>
                        <option value="texto_arte">Texto + Imagem</option>
                      </select>
                    </div>
                    {(editingProduct.tipoInput === 'texto' || editingProduct.tipoInput === 'texto_arte') && (
                      <div className="space-y-2">
                        <label htmlFor="product-text-label" className="text-xs font-bold text-gray-500 uppercase">Rótulo do Texto</label>
                        <input
                          id="product-text-label"
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
                    <span className="text-xs font-bold text-gray-500 uppercase">Atributos e Preços</span>
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
                          <label htmlFor="new-attribute-name" className="text-[10px] text-gray-400 uppercase">Nome (ex: Tamanho)</label>
                          <input
                            id="new-attribute-name"
                            value={newAttr.nome}
                            onChange={e => setNewAttr({...newAttr, nome: e.target.value})}
                            className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="new-attribute-options" className="text-[10px] text-gray-400 uppercase">Opções (separadas por vírgula)</label>
                          <input
                            id="new-attribute-options"
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
                            const attrName = newAttr.nome.trim().replace(/\s+/g, ' ');
                            const options = Array.from(new Set(newAttr.opcoes.split(',').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean)));
                            if (!attrName || options.length === 0) {
                              setErrorMessage('Informe o nome e ao menos uma opção para o atributo.');
                              return;
                            }
                            if ((editingProduct.atributos || []).length >= ADMIN_LIMITS.attributes) {
                              setErrorMessage(`Use no máximo ${ADMIN_LIMITS.attributes} atributos por produto.`);
                              return;
                            }
                            if (options.length > ADMIN_LIMITS.optionsPerAttribute) {
                              setErrorMessage(`Cada atributo aceita no máximo ${ADMIN_LIMITS.optionsPerAttribute} opções.`);
                              return;
                            }
                            if ((editingProduct.atributos || []).some(attribute => attribute.nome.toLocaleLowerCase('pt-BR') === attrName.toLocaleLowerCase('pt-BR'))) {
                              setErrorMessage('Já existe um atributo com esse nome.');
                              return;
                            }
                            const nextAttributes = [...(editingProduct.atributos || []), { nome: attrName, opcoes: options }];
                            if (generateProductCombinations(nextAttributes).length > ADMIN_LIMITS.combinations) {
                              setErrorMessage('Esse atributo geraria combinações demais. Reduza a quantidade de opções.');
                              return;
                            }
                            setErrorMessage(null);
                            setEditingProduct({ ...editingProduct, atributos: nextAttributes });
                            setNewAttr({ nome: '', opcoes: '' });
                            setShowAttrForm(false);
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
                        {generateProductCombinations(editingProduct.atributos).map(combo => (
                          <div key={combo} className="flex items-center gap-3 bg-black/40 p-2 rounded border border-gray-800">
                            <span className="text-[10px] flex-grow">{combo.replace(/\|/g, ' + ')}</span>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-gray-500">R$</span>
                              <input
                                aria-label={`Preço da combinação ${combo.replace(/\|/g, ' + ')}`}
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
                  <button type="button" onClick={requestCloseProductEditor} disabled={isSaving || isUploadingCatalogImages} className="px-8 py-3 rounded-full font-bold text-sm text-gray-500 hover:text-white disabled:opacity-50">Cancelar</button>
                  <button type="submit" disabled={isSaving || isUploadingCatalogImages} className="bg-[#ff4d79] px-12 py-3 rounded-full font-bold text-sm hover:bg-[#e6004c] flex items-center gap-2 disabled:opacity-50">
                    {(isSaving || isUploadingCatalogImages) ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} {isUploadingCatalogImages ? 'Enviando imagem...' : isSaving ? 'Salvando...' : 'Salvar Produto'}
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
                            const nextImages = [...new Set([...(editingProduct.imagens || []), ...urls])];
                            if (nextImages.length > ADMIN_LIMITS.galleryImages) {
                              setErrorMessage(`A galeria aceita no máximo ${ADMIN_LIMITS.galleryImages} imagens.`);
                              return;
                            }
                            setErrorMessage(null);
                            setEditingProduct({
                              ...editingProduct,
                              imagens: nextImages,
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
            <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={requestClosePromotionEditor} />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="promotion-editor-title"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative bg-[#111111] border border-gray-800 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl p-4 sm:p-8"
            >
              <div className="flex justify-between items-center mb-8">
                <h3 id="promotion-editor-title" className="text-xl font-bold">{editingPromotion.id ? 'Editar Promoção' : 'Nova Promoção'}</h3>
                <button type="button" onClick={requestClosePromotionEditor} aria-label="Fechar editor de promoção"><X size={24} /></button>
              </div>

              <form onSubmit={handleSavePromotion} className="space-y-6">
                <div className="space-y-2">
                  <label htmlFor="promotion-title" className="text-xs font-bold text-gray-500 uppercase">Título da Promoção</label>
                  <input
                    id="promotion-title"
                    required
                    value={editingPromotion.titulo || ''}
                    maxLength={199}
                    onChange={e => setEditingPromotion({...editingPromotion, titulo: e.target.value})}
                    className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="promotion-target-type" className="text-xs font-bold text-gray-500 uppercase">Aplicar em</label>
                    <select
                      id="promotion-target-type"
                      value={editingPromotion.alvoTipo || 'produto'}
                      onChange={event => setEditingPromotion({
                        ...editingPromotion,
                        alvoTipo: event.target.value as Promocao['alvoTipo'],
                        alvoId: '',
                      })}
                      className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                    >
                      <option value="produto">Produto</option>
                      <option value="categoria">Categoria</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="promotion-target" className="text-xs font-bold text-gray-500 uppercase">
                      {editingPromotion.alvoTipo === 'categoria' ? 'Categoria' : 'Produto'}
                    </label>
                    <select
                      id="promotion-target"
                      required
                      value={editingPromotion.alvoId || ''}
                      onChange={event => setEditingPromotion({ ...editingPromotion, alvoId: event.target.value })}
                      className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                    >
                      <option value="">Selecionar</option>
                      {(editingPromotion.alvoTipo === 'categoria' ? categories : products).map(target => (
                        <option key={target.id} value={target.id}>{target.nome}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="promotion-discount-type" className="text-xs font-bold text-gray-500 uppercase">Tipo de desconto</label>
                    <select
                      id="promotion-discount-type"
                      value={editingPromotion.descontoTipo || 'percentual'}
                      onChange={event => {
                        const descontoTipo = event.target.value as Promocao['descontoTipo'];
                        setEditingPromotion({ ...editingPromotion, descontoTipo });
                        setPromotionDiscountInput('');
                      }}
                      className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                    >
                      <option value="percentual">Porcentagem</option>
                      <option value="valor_fixo">Valor fixo retirado</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="promotion-discount" className="text-xs font-bold text-gray-500 uppercase">
                      {editingPromotion.descontoTipo === 'valor_fixo' ? 'Valor retirado (R$)' : 'Desconto (%)'}
                    </label>
                    {editingPromotion.descontoTipo === 'valor_fixo' ? (
                      <input
                        id="promotion-discount"
                        required
                        inputMode="decimal"
                        value={promotionDiscountInput}
                        onChange={event => setPromotionDiscountInput(event.target.value)}
                        placeholder="10,00"
                        className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                      />
                    ) : (
                      <input
                        id="promotion-discount"
                        required
                        type="number"
                        min="0.01"
                        max="99.99"
                        step="0.01"
                        value={editingPromotion.descontoPercentual ?? ''}
                        onChange={event => setEditingPromotion({ ...editingPromotion, descontoPercentual: Number(event.target.value) })}
                        placeholder="10"
                        className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                      />
                    )}
                  </div>
                </div>
                <div className="space-y-3 rounded-xl border border-gray-800 bg-black/40 p-4">
                  <div>
                    <div className="text-xs font-bold uppercase text-gray-500">Banner da promoção (opcional)</div>
                    <p className="mt-1 text-[10px] text-gray-600">Se enviado, também aparece no carrossel principal e leva ao item ou categoria selecionada.</p>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[#ff4d79]/50 bg-[#ff4d79]/10 px-4 py-3 text-xs font-bold text-[#ff4d79] hover:border-[#ff4d79]">
                      {isUploadingAdminAsset ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                      {isUploadingAdminAsset ? 'Enviando...' : 'Enviar banner'}
                      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePromotionImageUpload} disabled={isUploadingAdminAsset} className="sr-only" />
                    </label>
                    {editingPromotion.imagem && <img src={editingPromotion.imagem} alt="Prévia do banner" className="h-16 w-32 rounded-lg border border-gray-800 object-cover" />}
                  </div>
                  <details className="text-xs text-gray-500">
                    <summary className="cursor-pointer hover:text-gray-300">Usar URL externa</summary>
                    <input
                      type="url"
                      aria-label="URL externa do banner da promoção"
                      value={editingPromotion.imagem || ''}
                      onChange={event => setEditingPromotion({ ...editingPromotion, imagem: event.target.value })}
                      placeholder="https://exemplo.com/promocao.jpg"
                      className="mt-2 w-full bg-black border border-gray-800 rounded-lg px-4 py-3 outline-none focus:border-[#ff4d79]"
                    />
                  </details>
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
                  <button type="submit" disabled={isSaving || isUploadingAdminAsset} className="flex-grow bg-[#ff4d79] py-3 rounded-lg font-bold hover:bg-[#e6004c] transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                    {isSaving ? <><Loader2 size={18} className="animate-spin" /> Salvando...</> : 'Salvar Promoção'}
                  </button>
                  <button type="button" onClick={requestClosePromotionEditor} className="px-6 py-3 border border-gray-800 rounded-lg font-bold hover:bg-gray-800 transition-colors">
                    Cancelar
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {confirmation && (
          <ConfirmDialog
            title={confirmation.title}
            message={confirmation.message}
            confirmLabel={confirmation.confirmLabel}
            danger={confirmation.danger}
            busy={isConfirming}
            onCancel={() => {
              if (!isConfirming) setConfirmation(null);
            }}
            onConfirm={() => {
              void runConfirmedAction();
            }}
          />
        )}
      </AnimatePresence>
      {/* Removidos modais de upload */}
    </div>
  );
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
            <div key={item.id} className="flex gap-3 items-start bg-black/40 p-3 rounded-lg border border-gray-800/50">
              <img src={item.imagem || DEFAULT_LOGO_URL} alt={item.nome} className="w-10 h-10 object-cover rounded" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              <div className="flex-grow">
                <div className="text-xs font-bold">{item.nome}</div>
                <div className="text-[10px] text-gray-500">
                  {item.quantidade}x - {Object.entries(item.selecoes).map(([k, v]) => `${k}: ${v}`).join(', ')}
                </div>
                {item.personalizacaoTexto ? (
                  <div className="mt-3 rounded-lg border border-[#ff4d79]/30 bg-[#ff4d79]/5 p-3">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-[#ff4d79]">Personalização para produção</div>
                    <div className="mt-2 break-words text-xs font-bold text-white">Texto: {item.personalizacaoTexto.texto}</div>
                    <div className="mt-1 text-[10px] text-gray-400">
                      Fonte: {textFontLabel(item.personalizacaoTexto.fonte, [], item.personalizacaoTexto.fonteNome)} · Posição: X {item.personalizacaoTexto.posicao.x}% / Y {item.personalizacaoTexto.posicao.y}%
                    </div>
                    <div className="relative mt-3 aspect-video w-full max-w-[240px] overflow-hidden rounded-md border border-gray-700 bg-gray-900">
                      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:20px_20px]" />
                      <span
                        className="absolute max-w-[90%] -translate-x-1/2 -translate-y-1/2 break-words rounded border border-[#ff4d79]/40 bg-black/70 px-2 py-1 text-center text-xs font-bold text-white"
                        style={{
                          left: `${item.personalizacaoTexto.posicao.x}%`,
                          top: `${item.personalizacaoTexto.posicao.y}%`,
                          fontFamily: textFontCssFamily(item.personalizacaoTexto.fonte, [], item.personalizacaoTexto.fonteCssFamily),
                        }}
                      >
                        {item.personalizacaoTexto.texto}
                      </span>
                    </div>
                    <div className="mt-2 text-[9px] text-gray-500">Mapa proporcional da posição informada pelo cliente.</div>
                  </div>
                ) : item.textoPersonalizado ? (
                  <div className="mt-1 text-[10px] font-bold text-[#ff4d79]">
                    Personalização legada: {item.textoPersonalizado}
                  </div>
                ) : null}
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
                    Pedido antigo sem arte anexada: confirme o arquivo diretamente com o cliente
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
