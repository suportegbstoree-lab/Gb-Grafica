import type { DeliveryMethod, FulfillmentStatus, PaymentStatus } from './lib/orderStatus';

export type { DeliveryMethod, FulfillmentStatus, PaymentStatus };

export interface ProductAttribute {
  nome: string;
  opcoes: string[];
}

export interface Anuncio {
  id: string;
  nome: string;
  desc: string;
  categoria: string;
  imagem: string;
  imagens?: string[];
  preco_base: string;
  atributos: ProductAttribute[];
  combinacoes: Record<string, string>;
  tipoInput?: 'arte' | 'texto' | 'nenhum';
  labelTexto?: string;
}

export interface CartItem {
  id: string;
  productId: string;
  nome: string;
  imagem: string;
  preco: string;
  selecoes: Record<string, string>;
  quantidade: number;
  arquivoUrl?: string;
  arquivoPath?: string;
  arquivoNome?: string;
  artePendente?: boolean;
  textoPersonalizado?: string;
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
}

export interface Promocao {
  id: string;
  titulo: string;
  imagem: string;
  link?: string;
  ativa: boolean;
}

export interface SiteConfig {
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
  pix_chave?: string;
  pix_beneficiario?: string;
  razao_social?: string;
  documento_fiscal?: string;
  endereco_comercial?: string;
  email_atendimento?: string;
  email_privacidade?: string;
  prazo_producao?: string;
}
