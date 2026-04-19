import { Anuncio, SiteConfig } from "./types";

export const INITIAL_CONFIG: SiteConfig = {
  logo_url: "/logo.png",
  telefone1: "(16) 99999-9999",
  telefone2: "(16) 3333-3333",
  banner_principal: "https://picsum.photos/seed/grafica-banner/1920/600",
  beneficio1_titulo: "ENVIO RÁPIDO",
  beneficio1_desc: "EM ATÉ 2 DIAS ÚTEIS",
  beneficio2_titulo: "FRETE GRÁTIS",
  beneficio2_desc: "PARA PEDIDOS ACIMA DE R$ 150",
  beneficio3_titulo: "ALTA QUALIDADE",
  beneficio3_desc: "IMPRESSÃO PREMIUM"
};

export const INITIAL_CATEGORIES = [
  { nome: "Etiquetas p/ Objetos", icon: "https://cdn-icons-png.flaticon.com/512/3063/3063822.png" },
  { nome: "Etiquetas p/ Roupas", icon: "https://cdn-icons-png.flaticon.com/512/3531/3531821.png" },
  { nome: "Chaveiros", icon: "https://cdn-icons-png.flaticon.com/512/1048/1048953.png" },
  { nome: "Pulseiras", icon: "https://cdn-icons-png.flaticon.com/512/2965/2965301.png" },
  { nome: "Rótulos", icon: "https://cdn-icons-png.flaticon.com/512/2666/2666505.png" },
  { nome: "Saquinhos Multiuso", icon: "https://cdn-icons-png.flaticon.com/512/2554/2554922.png" },
  { nome: "Adesivos de Parede", icon: "https://cdn-icons-png.flaticon.com/512/2910/2910791.png" },
  { nome: "Luminárias", icon: "https://cdn-icons-png.flaticon.com/512/2590/2590525.png" },
  { nome: "Painéis Educativos", icon: "https://cdn-icons-png.flaticon.com/512/2618/2618245.png" }
];

export const INITIAL_PRODUCTS: Anuncio[] = [
  {
    id: "1",
    nome: "Cartão de Visita Premium",
    desc: "Cartões de visita com acabamento fosco e verniz localizado.",
    categoria: "Cartões de Visita",
    imagem: "https://picsum.photos/seed/business-card/400/300",
    preco_base: "A partir de R$ 45,00",
    atributos: [
      { nome: "Quantidade", opcoes: ["100", "500", "1000"] },
      { nome: "Papel", opcoes: ["Couché 250g", "Couché 300g"] }
    ],
    combinacoes: {
      "100|Couché 250g": "45.00",
      "100|Couché 300g": "55.00",
      "500|Couché 250g": "120.00",
      "500|Couché 300g": "150.00",
      "1000|Couché 250g": "180.00",
      "1000|Couché 300g": "220.00"
    }
  }
];
