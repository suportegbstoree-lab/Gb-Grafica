import type { ProductProductionAssets } from './lib/productCustomization';
import type { PrintProfile, ArtworkApproval } from './lib/printProfile';
import type { DeliveryMethod, FulfillmentStatus, PaymentStatus } from './lib/orderStatus';
import type { PersonalizationFont, ProductCustomizationType, TextCustomization } from './lib/textCustomization';
import type { ProductShippingProfile, ShippingOption, ShippingParcel } from './lib/shipping';

export type { DeliveryMethod, FulfillmentStatus, PaymentStatus, PersonalizationFont, ProductCustomizationType, TextCustomization };

export interface ProductOptionConfig extends ProductProductionAssets {
  adicional?: string;
  texto?: boolean;
  imagem?: boolean;
  sku?: string;
  referencia?: string;
}

export interface ProductAttribute {
  nome: string;
  opcoes: string[];
  tipoId?: string;
  configuracao?: Record<string, ProductOptionConfig>;
}

export interface Anuncio {
  sku?: string;
  skuPorCombinacao?: Record<string, string>;
  pacote?: import('./lib/bundles').BundleDefinition;
  tags?: string[];
  lancamento?: boolean;
  id: string;
  nome: string;
  desc: string;
  categoria: string;
  imagem: string;
  imagens?: string[];
  imagensPorCombinacao?: Record<string, string>;
  modelosPdf?: import('./lib/pdfTemplate').ProductPdfTemplate[];
  /** Production assets are independent of advertising images. */
  imagemBase?: string;
  precificacao?: 'combinacoes' | 'adicionais';
  moldePdf?: import('./lib/productCustomization').ProductPdfBinding;
  preco_base: string;
  atributos: ProductAttribute[];
  combinacoes: Record<string, string>;
  tipoInput?: ProductCustomizationType;
  labelTexto?: string;
  destaque?: boolean;
  destaqueOrdem?: number;
  printProfile?: PrintProfile;
  shipping?: ProductShippingProfile;
  shippingByCombination?: Record<string, ProductShippingProfile>;
}

export interface CartItem {
  sku?: string;
  moldePedido?: import('./lib/productCustomization').ProductPdfOrder;
  textoMolde?: string;
  moldeRevisao?: string;
  imagemBaseReferencia?: string;
  imagemClientePath?: string;
  paginasModelo?: string[];
  baseImagemPedido?: boolean;
  bundleItems?: CartItem[];
  /** Present only on flattened order views; component prices are included in the package total. */
  bundleParentName?: string;
  bundleRevision?: string;
  bundleQuantityAllowed?: boolean;
  inicialReferencia?: string;
  inicialPath?: string;
  inicialLetra?: string;
  inicialTamanho?: number;
  templateId?: string;
  printProfile?: PrintProfile;
  aprovarArte?: boolean;
  aprovacaoArte?: ArtworkApproval;
  id: string;
  productId: string;
  nome: string;
  imagem: string;
  preco: string;
  selecoes: Record<string, string>;
  quantidade: number;
  precoOriginal?: string;
  promocaoId?: string;
  descontoPercentual?: number;
  arquivoUrl?: string;
  arquivoPath?: string;
  arquivoNome?: string;
  modeloPath?: string;
  modeloNome?: string;
  contracapaPath?: string;
  contracapaOriginalPath?: string;
  contracapaOriginalNome?: string;
  contracapaNome?: string;
  contracapaModo?: 'automatic' | 'custom';
  artePendente?: boolean;
  textoPersonalizado?: string;
  personalizacaoTexto?: TextCustomization;
}

export interface DeliveryAddress {
  cep: string;
  rua: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  estado: string;
}

export interface Order {
  cupom?: import('./lib/salesCoupons').AppliedCoupon;
  cupomLiberado?: boolean;
  etiquetaCriada?: boolean;
  observacoes?: string;
  tracking?: import('./lib/tracking').OrderTracking;
  id: string;
  userId: string;
  data: string;
  itens: CartItem[];
  total: string;
  status: 'Pendente' | 'Processando' | 'Enviado' | 'Entregue' | 'Pago';
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
  metodoEntrega?: DeliveryMethod;
  metodoPagamento?: 'cartao' | 'pix' | 'pagbank';
  subtotal?: string;
  frete?: string;
  shipping?: ShippingOption & { origin_cep: string; destination_cep: string; quoted_at: string; parcels: ShippingParcel[] };
  totalCents?: number;
  clienteNome?: string;
  clienteEmail?: string;
  clienteTelefone?: string;
  enderecoEntrega?: DeliveryAddress;
  pagbankCheckoutId?: string;
  pagbankOrderId?: string;
  pagbankChargeId?: string;
  pagbankStatus?: string;
  pagbankPayUrl?: string;
  checkoutExpiresAt?: string;
  legalAcceptance?: {
    acceptedAt: string;
    termsVersion: string;
    privacyVersion: string;
    exchangesVersion: string;
  };
}

export interface Category {
  id: string;
  nome: string;
  icon?: string;
  ordem?: number;
}

export type PromotionTargetType = 'produto' | 'categoria';
export type PromotionDiscountType = 'percentual' | 'valor_fixo';

export interface Promocao {
  relampago?: boolean;
  startsAt?: number;
  endsAt?: number;
  id: string;
  titulo: string;
  imagem?: string;
  link?: string;
  ativa: boolean;
  alvoTipo?: PromotionTargetType;
  alvoId?: string;
  alvoIds?: string[];
  alvoNomes?: string[];
  alvoNome?: string;
  descontoTipo?: PromotionDiscountType;
  descontoPercentual?: number;
  descontoFixoCentavos?: number;
}

export interface StoreContact { id: string; type: 'whatsapp' | 'phone' | 'email'; label: string; value: string; }
export interface StoreBenefit { id: string; title: string; description: string; }

export interface SiteConfig {
  contatos?: StoreContact[];
  beneficios?: StoreBenefit[];
  logo_url?: string;
  telefone1: string;
  telefone2: string;
  banner_principal: string;
  banner_titulo?: string;
  banner_subtitulo?: string;
  banner_botao?: string;
  beneficio1_titulo: string;
  beneficio1_desc: string;
  beneficio2_titulo: string;
  beneficio2_desc: string;
  beneficio3_titulo: string;
  beneficio3_desc: string;
  razao_social?: string;
  documento_fiscal?: string;
  endereco_comercial?: string;
  email_atendimento?: string;
  email_privacidade?: string;
  prazo_producao?: string;
  fontes_personalizacao?: PersonalizationFont[];
}
