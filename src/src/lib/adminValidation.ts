import type { Anuncio, Category, ProductAttribute, Promocao, SiteConfig } from '../types';
import { isHttpUrl, isValidBrazilianPhone, parseMoneyToCents, slugifyDocumentId } from './commerce';
import {
  isProductCustomizationType,
  normalizePersonalizationFonts,
  productRequiresText,
} from './textCustomization';

export const ADMIN_LIMITS = {
  categoryName: 80,
  productName: 199,
  productDescription: 999,
  promotionTitle: 199,
  galleryImages: 50,
  attributes: 8,
  optionsPerAttribute: 50,
  combinations: 500,
} as const;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

function normalizedSpaces(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isSafeAdminUrl(value: string, allowEmpty = false): boolean {
  const normalized = value.trim();
  if (!normalized) return allowEmpty;
  if (normalized.startsWith('/') && !normalized.startsWith('//') && !normalized.includes('\\')) return true;
  return isHttpUrl(normalized);
}

function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = value.toLocaleLowerCase('pt-BR');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function generateProductCombinations(attributes: ProductAttribute[]): string[] {
  if (attributes.length === 0) return [];

  let results = [''];
  for (const attribute of attributes) {
    const next: string[] = [];
    for (const current of results) {
      for (const option of attribute.opcoes) {
        next.push(current ? `${current}|${option}` : option);
        if (next.length > ADMIN_LIMITS.combinations) return next;
      }
    }
    results = next;
  }
  return results;
}

export function validateCategoryDraft(
  draft: Partial<Category> & { nome: string; icon?: string },
  categories: Category[],
  currentId?: string,
): ValidationResult<Category> {
  const nome = normalizedSpaces(draft.nome);
  const icon = normalizedText(draft.icon);
  if (!nome) return { ok: false, message: 'Informe o nome da categoria.' };
  if (nome.length > ADMIN_LIMITS.categoryName) {
    return { ok: false, message: `O nome da categoria deve ter no máximo ${ADMIN_LIMITS.categoryName} caracteres.` };
  }
  if (icon && !isSafeAdminUrl(icon)) return { ok: false, message: 'A URL do ícone da categoria é inválida.' };

  const id = currentId || slugifyDocumentId(nome);
  if (!id) return { ok: false, message: 'O nome da categoria não gera um identificador válido.' };
  const duplicate = categories.some(category => (
    category.id !== currentId && (
      category.id === id || category.nome.trim().toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR')
    )
  ));
  if (duplicate) return { ok: false, message: 'Já existe uma categoria com esse nome.' };
  const ordem = Number.isInteger(draft.ordem) && Number(draft.ordem) >= 0
    ? Number(draft.ordem)
    : categories.length;
  return { ok: true, value: { id, nome, icon, ordem } };
}

export function validateProductDraft(
  draft: Partial<Anuncio>,
  categories: Category[],
  products: Anuncio[],
): ValidationResult<Omit<Anuncio, 'id'>> {
  const nome = normalizedSpaces(draft.nome);
  const desc = normalizedText(draft.desc);
  const categoria = normalizedSpaces(draft.categoria);
  const imagem = normalizedText(draft.imagem);
  const precoBase = normalizedText(draft.preco_base);
  if (draft.tipoInput !== undefined && !isProductCustomizationType(draft.tipoInput)) {
    return { ok: false, message: 'Selecione um tipo de personalização válido.' };
  }
  const tipoInput = draft.tipoInput || 'nenhum';
  const labelTexto = normalizedSpaces(draft.labelTexto);

  if (!nome || !desc || !categoria || !imagem) {
    return { ok: false, message: 'Preencha os campos obrigatórios: nome, descrição, categoria e imagem principal.' };
  }
  if (nome.length > ADMIN_LIMITS.productName || desc.length > ADMIN_LIMITS.productDescription) {
    return {
      ok: false,
      message: `O nome deve ter no máximo ${ADMIN_LIMITS.productName} caracteres e a descrição, ${ADMIN_LIMITS.productDescription}.`,
    };
  }
  if (!categories.some(category => category.nome === categoria)) {
    return { ok: false, message: 'Selecione uma categoria cadastrada.' };
  }
  const duplicateName = products.some(product => (
    product.id !== draft.id && product.nome.trim().toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR')
  ));
  if (duplicateName) return { ok: false, message: 'Já existe um produto com esse nome.' };
  if (!isSafeAdminUrl(imagem)) return { ok: false, message: 'A URL da imagem principal é inválida.' };

  const imagens = uniqueCaseInsensitive((draft.imagens || []).map(normalizedText).filter(Boolean));
  if (imagens.length > ADMIN_LIMITS.galleryImages) {
    return { ok: false, message: `A galeria aceita no máximo ${ADMIN_LIMITS.galleryImages} imagens.` };
  }
  if (imagens.some(image => !isSafeAdminUrl(image))) {
    return { ok: false, message: 'A galeria contém uma URL inválida.' };
  }

  if ((draft.atributos || []).length > ADMIN_LIMITS.attributes) {
    return { ok: false, message: `Use no máximo ${ADMIN_LIMITS.attributes} atributos por produto.` };
  }
  const atributos = (draft.atributos || []).map(attribute => ({
    nome: normalizedSpaces(attribute.nome),
    opcoes: uniqueCaseInsensitive(attribute.opcoes.map(normalizedSpaces).filter(Boolean)),
  }));
  if (atributos.some(attribute => !attribute.nome || attribute.opcoes.length === 0)) {
    return { ok: false, message: 'Cada atributo precisa de nome e pelo menos uma opção.' };
  }
  if (atributos.some(attribute => attribute.opcoes.length > ADMIN_LIMITS.optionsPerAttribute)) {
    return { ok: false, message: `Cada atributo aceita no máximo ${ADMIN_LIMITS.optionsPerAttribute} opções.` };
  }
  if (new Set(atributos.map(attribute => attribute.nome.toLocaleLowerCase('pt-BR'))).size !== atributos.length) {
    return { ok: false, message: 'Cada atributo precisa ter um nome único.' };
  }

  const combinationKeys = generateProductCombinations(atributos);
  if (combinationKeys.length > ADMIN_LIMITS.combinations) {
    return { ok: false, message: 'Este produto gera combinações demais. Reduza a quantidade de atributos ou opções.' };
  }
  const combinacoes = Object.fromEntries(
    combinationKeys.map(key => [key, normalizedText(draft.combinacoes?.[key])]),
  );
  if (combinationKeys.some(key => {
    const cents = parseMoneyToCents(combinacoes[key]);
    return cents === null || cents <= 0;
  })) {
    return { ok: false, message: 'Defina um preço válido e maior que zero para todas as combinações.' };
  }
  if (atributos.length === 0) {
    const cents = parseMoneyToCents(precoBase);
    if (cents === null || cents <= 0) {
      return { ok: false, message: 'Defina um preço base válido e maior que zero.' };
    }
  }
  if (productRequiresText(tipoInput) && !labelTexto) {
    return { ok: false, message: 'Informe o rótulo do texto que o cliente deverá preencher.' };
  }

  return {
    ok: true,
    value: {
      nome,
      desc,
      categoria,
      imagem,
      imagens,
      preco_base: precoBase,
      atributos,
      combinacoes,
      tipoInput,
      labelTexto,
    },
  };
}

function productConfiguredPrices(product: Anuncio): number[] {
  const rawValues = product.atributos.length > 0
    ? Object.values(product.combinacoes)
    : [product.preco_base];
  return rawValues
    .map(parseMoneyToCents)
    .filter((value): value is number => value !== null && value > 0);
}

export function validatePromotionDraft(
  draft: Partial<Promocao>,
  products: Anuncio[] = [],
  categories: Category[] = [],
): ValidationResult<Omit<Promocao, 'id'>> {
  const titulo = normalizedSpaces(draft.titulo);
  const imagem = normalizedText(draft.imagem);
  if (!titulo) return { ok: false, message: 'Informe o título da promoção.' };
  if (titulo.length > ADMIN_LIMITS.promotionTitle) {
    return { ok: false, message: `O título deve ter no máximo ${ADMIN_LIMITS.promotionTitle} caracteres.` };
  }
  if (imagem && !isSafeAdminUrl(imagem)) return { ok: false, message: 'A imagem da promoção possui uma URL inválida.' };

  if (draft.alvoTipo !== 'produto' && draft.alvoTipo !== 'categoria') {
    return { ok: false, message: 'Escolha se a promoção será aplicada a um produto ou a uma categoria.' };
  }
  const target = draft.alvoTipo === 'produto'
    ? products.find(product => product.id === draft.alvoId)
    : categories.find(category => category.id === draft.alvoId);
  if (!target) return { ok: false, message: 'Selecione um produto ou categoria cadastrada para a promoção.' };

  if (draft.descontoTipo !== 'percentual' && draft.descontoTipo !== 'valor_fixo') {
    return { ok: false, message: 'Escolha o tipo de desconto.' };
  }

  let descontoPercentual: number | undefined;
  let descontoFixoCentavos: number | undefined;
  if (draft.descontoTipo === 'percentual') {
    const value = Number(draft.descontoPercentual);
    if (!Number.isFinite(value) || value <= 0 || value >= 100) {
      return { ok: false, message: 'O desconto percentual deve ser maior que 0 e menor que 100.' };
    }
    descontoPercentual = Math.round(value * 100) / 100;
  } else {
    const value = Number(draft.descontoFixoCentavos);
    if (!Number.isInteger(value) || value <= 0) {
      return { ok: false, message: 'Informe um valor fixo de desconto válido.' };
    }
    const targetedProducts = draft.alvoTipo === 'produto'
      ? products.filter(product => product.id === draft.alvoId)
      : products.filter(product => product.categoria === target.nome);
    const configuredPrices = targetedProducts.flatMap(productConfiguredPrices);
    if (configuredPrices.length > 0 && configuredPrices.some(price => value >= price)) {
      return { ok: false, message: 'O desconto fixo precisa ser menor que todos os preços atingidos pela promoção.' };
    }
    descontoFixoCentavos = value;
  }

  return {
    ok: true,
    value: {
      titulo,
      imagem,
      link: draft.alvoTipo === 'produto' ? `#produto-${target.id}` : '#produtos',
      ativa: draft.ativa ?? true,
      alvoTipo: draft.alvoTipo,
      alvoId: target.id,
      alvoNome: target.nome,
      descontoTipo: draft.descontoTipo,
      ...(descontoPercentual !== undefined ? { descontoPercentual } : {}),
      ...(descontoFixoCentavos !== undefined ? { descontoFixoCentavos } : {}),
    },
  };
}

export function validateSiteConfig(config: SiteConfig): ValidationResult<SiteConfig> {
  const normalized = Object.fromEntries(Object.entries(config).map(([key, value]) => [
    key,
    typeof value === 'string' ? value.trim() : value,
  ])) as unknown as SiteConfig;

  if (!normalized.telefone1 || !normalized.telefone2) {
    return { ok: false, message: 'Informe os dois números de atendimento.' };
  }
  if (!isValidBrazilianPhone(normalized.telefone1) || !isValidBrazilianPhone(normalized.telefone2)) {
    return { ok: false, message: 'Informe números de atendimento válidos, incluindo o DDD.' };
  }
  if (normalized.logo_url && !isSafeAdminUrl(normalized.logo_url)) {
    return { ok: false, message: 'A URL do logo é inválida.' };
  }
  if (!isSafeAdminUrl(normalized.banner_principal)) {
    return { ok: false, message: 'A URL do banner principal é inválida.' };
  }
  if (normalized.email_atendimento && !isValidEmail(normalized.email_atendimento)) {
    return { ok: false, message: 'O e-mail de atendimento é inválido.' };
  }
  if (normalized.email_privacidade && !isValidEmail(normalized.email_privacidade)) {
    return { ok: false, message: 'O e-mail de privacidade é inválido.' };
  }
  const fonts = normalizePersonalizationFonts(config.fontes_personalizacao);
  if ((config.fontes_personalizacao || []).length !== fonts.length) {
    return { ok: false, message: 'Revise as fontes de personalização: há nome, identificador, família ou URL inválidos ou duplicados.' };
  }
  return { ok: true, value: { ...normalized, fontes_personalizacao: fonts } };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function draftFingerprint(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
