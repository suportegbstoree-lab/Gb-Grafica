import type { Anuncio, Category, ProductAttribute, Promocao, SiteConfig } from '../types';
import { isHttpUrl, isValidBrazilianPhone, parseMoneyToCents, slugifyDocumentId } from './commerce';

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
  draft: { nome: string; icon: string },
  categories: Category[],
): ValidationResult<Category> {
  const nome = normalizedSpaces(draft.nome);
  const icon = normalizedText(draft.icon);
  if (!nome) return { ok: false, message: 'Informe o nome da categoria.' };
  if (nome.length > ADMIN_LIMITS.categoryName) {
    return { ok: false, message: `O nome da categoria deve ter no máximo ${ADMIN_LIMITS.categoryName} caracteres.` };
  }
  if (icon && !isSafeAdminUrl(icon)) return { ok: false, message: 'A URL do ícone da categoria é inválida.' };

  const id = slugifyDocumentId(nome);
  if (!id) return { ok: false, message: 'O nome da categoria não gera um identificador válido.' };
  const duplicate = categories.some(category => (
    category.id === id || category.nome.trim().toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR')
  ));
  if (duplicate) return { ok: false, message: 'Já existe uma categoria com esse nome.' };
  return { ok: true, value: { id, nome, icon } };
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
  if (tipoInput === 'texto' && !labelTexto) {
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

export function validatePromotionDraft(draft: Partial<Promocao>): ValidationResult<Omit<Promocao, 'id'>> {
  const titulo = normalizedSpaces(draft.titulo);
  const imagem = normalizedText(draft.imagem);
  const link = normalizedText(draft.link);
  if (!titulo || !imagem) return { ok: false, message: 'Preencha o título e a imagem da promoção.' };
  if (titulo.length > ADMIN_LIMITS.promotionTitle) {
    return { ok: false, message: `O título deve ter no máximo ${ADMIN_LIMITS.promotionTitle} caracteres.` };
  }
  if (!isSafeAdminUrl(imagem) || (link && !isSafeAdminUrl(link))) {
    return { ok: false, message: 'A promoção contém uma URL inválida.' };
  }
  return { ok: true, value: { titulo, imagem, link, ativa: draft.ativa ?? true } };
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
  return { ok: true, value: normalized };
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
