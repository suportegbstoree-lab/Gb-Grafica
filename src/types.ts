export interface ProductAttribute {
  nome: string;
  opcoes: string[];
}

export interface Product {
  id: string;
  nome: string;
  desc: string;
  categoria: string;
  imagem: string;
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
  textoPersonalizado?: string;
}

export interface Order {
  id: string;
  userId: string;
  data: string;
  itens: CartItem[];
  total: string;
  status: 'Pendente' | 'Processando' | 'Enviado' | 'Entregue';
}

export interface Category {
  id: string;
  nome: string;
  icon?: string;
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
}
