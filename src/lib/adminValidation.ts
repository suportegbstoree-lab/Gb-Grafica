import { cleanSku, MAX_COMBINATION_SKU, MAX_PRODUCT_SKU, MAX_VARIATION_SKU } from './productSales.js';
import { bindingValid, productMinimum } from './productCustomization.js';
import { parseBundle, bundleMinimum } from './bundles.js';
import { validPdfTemplates } from './pdfTemplate.js';
import { validPromotionWindow } from './promotions.js';
import { parsePrintProfile } from './printProfile.js';
import { parseStoreContacts, parseStoreBenefits } from './storePresentation.js';
import type { Anuncio, Category, ProductAttribute, Promocao, SiteConfig } from '../types.js';
import { isHttpUrl, isValidBrazilianPhone, parseMoneyToCents, slugifyDocumentId } from './commerce.js';
import { parseShippingProfile, type ProductShippingProfile } from './shipping.js';
import {
  isProductCustomizationType,
  normalizePersonalizationFonts,
  personalizationFontsIssue,
  productRequiresText,
} from './textCustomization.js';

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
  let precoBase = normalizedText(draft.preco_base);
  const bundle = draft.pacote === undefined ? undefined : parseBundle(draft.pacote);
  if (draft.pacote !== undefined && !bundle) return { ok: false, message: 'Revise a composição do pacote.' };
  if (bundle) { try { precoBase = (bundleMinimum(bundle, products, draft.id) / 100).toFixed(2); } catch (error) { return { ok: false, message: (error as Error).message }; } if (draft.atributos?.length || (draft.tipoInput && draft.tipoInput !== 'nenhum')) return { ok: false, message: 'A personalização do pacote é feita em cada componente.' }; }
  if (draft.tags !== undefined && (!Array.isArray(draft.tags) || draft.tags.length > 20 || draft.tags.some(tag => typeof tag !== 'string' || tag.trim().length > 50))) return { ok: false, message: 'Use até 20 tags de até 50 caracteres.' };
  if (draft.lancamento !== undefined && typeof draft.lancamento !== 'boolean') return { ok: false, message: 'Informe se o produto é um lançamento.' };
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

  const sku = cleanSku(draft.sku, MAX_PRODUCT_SKU);
  if (sku === null) return { ok: false, message: 'Revise o SKU principal.' };
  if (!Array.isArray(draft.atributos ?? []) || (draft.atributos || []).some(attr => !attr || !Array.isArray(attr.opcoes))) return { ok: false, message: 'Revise as variações do produto.' };
  if ((draft.atributos || []).length > ADMIN_LIMITS.attributes) {
    return { ok: false, message: `Use no máximo ${ADMIN_LIMITS.attributes} atributos por produto.` };
  }
  if(draft.precificacao !== undefined && !['combinacoes','adicionais'].includes(draft.precificacao)) return {ok:false,message:'Modo de preço inválido.'};
  if(draft.imagemBase && !isSafeAdminUrl(draft.imagemBase)) return {ok:false,message:'Arte-base inválida.'};
  if(draft.moldePdf && draft.printProfile) return {ok:false,message:'O formato de impressão segue a base PDF vinculada. Atualize o vínculo para usar suas medidas originais.'};
  if(draft.moldePdf !== undefined && !bindingValid(draft.moldePdf,draft.id||'')) return {ok:false,message:'Revise o vínculo com o molde PDF.'};
  for(const attr of draft.atributos || []) {
    if(attr.configuracao && (typeof attr.configuracao!=='object' || Array.isArray(attr.configuracao) || Object.entries(attr.configuracao).some(([key,option])=>!attr.opcoes.includes(key) || !option || typeof option!=='object' || Array.isArray(option) || Object.keys(option).some(k=>!['adicional','texto','imagem','sku','referencia'].includes(k)) || (cleanSku(option.sku, MAX_VARIATION_SKU) === null) || (option.referencia !== undefined && (typeof option.referencia !== 'string' || !isSafeAdminUrl(option.referencia))) || (option.texto!==undefined && typeof option.texto!=='boolean') || (option.imagem!==undefined && typeof option.imagem!=='boolean') || (option.adicional!==undefined && (parseMoneyToCents(option.adicional)===null || parseMoneyToCents(option.adicional)!<0))))) return {ok:false,message:'Revise os adicionais e a personalização de cada opção.'};
  }
  const atributos = (draft.atributos || []).map(attribute => ({
    ...(attribute.configuracao ? {configuracao:Object.fromEntries(Object.entries(attribute.configuracao).map(([key,value])=>[normalizedSpaces(key),value]))} : {}),
    ...(attribute.tipoId !== undefined ? { tipoId: attribute.tipoId } : {}),
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

  const typed = atributos.filter(attribute => attribute.tipoId !== undefined);
  if (typed.some(attribute => typeof attribute.tipoId !== 'string' || !/^[a-f0-9]{32}$/.test(attribute.tipoId) ||
    attribute.nome.length > 80 || Object.hasOwn(Object.prototype, attribute.nome) ||
    attribute.opcoes.some(option => option.length > 80 || option.includes('|') || Object.hasOwn(Object.prototype, option))) ||
    new Set(typed.map(attribute => attribute.tipoId)).size !== typed.length || (typed.length && atributos.length > 2)) {
    return { ok: false, message: 'Selecione até dois tipos diferentes e opções de até 80 caracteres.' };
  }
  const combinationKeys = generateProductCombinations(atributos);
  const skus = draft.skuPorCombinacao ?? {};
  if (typeof skus !== 'object' || Array.isArray(skus) ||
    Object.entries(skus).some(([key, value]) => !combinationKeys.includes(key) || cleanSku(value, MAX_COMBINATION_SKU) === null)) {
    return { ok: false, message: 'Revise os SKUs da lista de variações.' };
  }
  const skuPorCombinacao = Object.fromEntries(Object.entries(skus).flatMap(([key, value]) => {
    const normalized = cleanSku(value, MAX_COMBINATION_SKU);
    return normalized ? [[key, normalized]] : [];
  }));
  if (draft.precificacao !== 'adicionais' && combinationKeys.length > ADMIN_LIMITS.combinations) {
    return { ok: false, message: 'Este produto gera combinações demais. Reduza a quantidade de atributos ou opções.' };
  }
  if (draft.modelosPdf !== undefined && !validPdfTemplates(draft.modelosPdf, draft.id || '', [imagem, ...imagens])) return { ok: false, message: 'Revise as páginas dos modelos PDF e as imagens da galeria.' };
  const imagensPorCombinacao = draft.imagensPorCombinacao || {};
  if (typeof imagensPorCombinacao !== 'object' || Array.isArray(imagensPorCombinacao) || Object.entries(imagensPorCombinacao).some(([key, url]) => !combinationKeys.includes(key) || ![imagem, ...imagens].includes(url))) return { ok: false, message: 'Vincule cada combinação a uma imagem da galeria do produto.' };
  const combinacoes = Object.fromEntries(
    combinationKeys.map(key => [key, normalizedText(draft.combinacoes?.[key])]),
  );
  if (draft.precificacao !== 'adicionais' && combinationKeys.some(key => {
    const cents = parseMoneyToCents(combinacoes[key]);
    return cents === null || cents <= 0;
  })) {
    return { ok: false, message: 'Defina um preço válido e maior que zero para todas as combinações.' };
  }
  if (atributos.length === 0 || draft.precificacao === 'adicionais') {
    const cents = parseMoneyToCents(precoBase);
    if (cents === null || cents <= 0) {
      return { ok: false, message: 'Defina um preço base válido e maior que zero.' };
    }
  }
  if ((productRequiresText(tipoInput) || atributos.some(a=>Object.values(a.configuracao||{}).some(o=>o.texto===true))) && !labelTexto) {
    return { ok: false, message: 'Informe o rótulo do texto que o cliente deverá preencher.' };
  }

  const printProfile = draft.printProfile === undefined ? undefined : parsePrintProfile(draft.printProfile);
  if (printProfile === null) return { ok: false, message: 'Revise o formato de impressão: medidas, sangria, margem segura e resolução devem ser válidas.' };

  const shipping = draft.shipping === undefined ? undefined : parseShippingProfile(draft.shipping);
  const shippingByCombination: Record<string, ProductShippingProfile> = {};
  if (shipping === null) return { ok: false, message: 'Revise o peso e a embalagem: máximo de 30 kg por volume, 100 cm por lado e soma de até 200 cm.' };
  for (const key of combinationKeys) {
    if (!Object.hasOwn(draft.shippingByCombination || {}, key)) continue;
    const profile = parseShippingProfile(draft.shippingByCombination![key]);
    if (!profile) return { ok: false, message: `Revise o peso e a embalagem da combinação ${key}.` };
    shippingByCombination[key] = profile;
  }

  return {
    ok: true,
    value: {
      ...(bundle ? { pacote: bundle } : {}),
      ...(draft.tags !== undefined ? { tags: [...new Set(draft.tags.map(tag => tag.trim()).filter(Boolean))] } : {}),
      ...(draft.lancamento !== undefined ? { lancamento: draft.lancamento } : {}),
      ...(draft.destaque !== undefined ? { destaque: draft.destaque === true } : {}),
      ...(Number.isSafeInteger(draft.destaqueOrdem) && draft.destaqueOrdem! >= 0 ? { destaqueOrdem: draft.destaqueOrdem } : {}),
      ...(sku ? { sku } : {}),
      ...(Object.keys(skuPorCombinacao).length ? { skuPorCombinacao } : {}),
      nome,
      desc,
      categoria,
      imagem,
      ...(draft.imagemBase ? {imagemBase:draft.imagemBase} : {}),
      ...(draft.moldePdf ? {moldePdf:draft.moldePdf} : {}),
      ...(draft.precificacao ? {precificacao:draft.precificacao} : {}),
      imagens,
      imagensPorCombinacao,
      ...(draft.modelosPdf ? { modelosPdf: draft.modelosPdf } : {}),
      preco_base: precoBase,
      atributos,
      combinacoes,
      tipoInput,
      labelTexto,
      ...(printProfile ? { printProfile } : {}),
      ...(shipping ? { shipping } : {}),
      ...(Object.keys(shippingByCombination).length ? { shippingByCombination } : {}),
    },
  };
}

function productConfiguredPrices(product: Anuncio): number[] {
  if(product.precificacao==='adicionais') return [productMinimum(product)].filter((n):n is number=>n!==null);
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
  const ids = draft.alvoIds ?? (draft.alvoId ? [draft.alvoId] : []);
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) return { ok: false, message: 'Selecione de 1 a 100 produtos ou categorias distintos.' };
  const options = draft.alvoTipo === 'produto' ? products : categories;
  const targets = ids.map(id => options.find(option => option.id === id));
  if (targets.some(target => !target)) return { ok: false, message: 'Selecione produtos ou categorias cadastrados.' };
  if (draft.alvoTipo === 'produto' && targets.some(target => (target as Anuncio).pacote)) return {ok:false,message:'Defina o desconto dos pacotes na seção Pacotes. Ele não acumula promoções dos componentes.'};
  const target = targets[0]!;
  const names = targets.map(target => target!.nome);

  if (draft.descontoTipo !== 'percentual' && draft.descontoTipo !== 'valor_fixo') {
    return { ok: false, message: 'Escolha o tipo de desconto.' };
  }

  if (!validPromotionWindow(draft)) return { ok: false, message: 'Defina um prazo válido para a promoção relâmpago.' };

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
      ? products.filter(product => ids.includes(product.id))
      : products.filter(product => names.includes(product.categoria));
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
      ...(draft.relampago ? { relampago: true, startsAt: draft.startsAt, endsAt: draft.endsAt } : {}),
      link: draft.alvoTipo === 'produto' ? `#produto-${target.id}` : '#produtos',
      ativa: draft.ativa ?? true,
      alvoTipo: draft.alvoTipo,
      alvoId: target.id,
      alvoIds: ids,
      alvoNomes: names,
      alvoNome: target.nome,
      descontoTipo: draft.descontoTipo,
      ...(descontoPercentual !== undefined ? { descontoPercentual } : {}),
      ...(descontoFixoCentavos !== undefined ? { descontoFixoCentavos } : {}),
    },
  };
}

export function validateSiteConfig(config: SiteConfig): ValidationResult<SiteConfig> {
  if (new TextEncoder().encode(JSON.stringify(config)).byteLength > 768 * 1024)
    return { ok: false, message: 'As configurações excedem o limite de 768 KB. Reduza os dados antes de salvar.' };
  const normalized = Object.fromEntries(Object.entries(config).map(([key, value]) => [
    key,
    typeof value === 'string' ? value.trim() : value,
  ])) as unknown as SiteConfig;

  if (normalized.contatos !== undefined && !parseStoreContacts(normalized.contatos)) return { ok: false, message: 'Revise os meios de contato: nome, e-mail ou telefone inválido, ou limite de 12 itens excedido.' };
  if (normalized.beneficios !== undefined && !parseStoreBenefits(normalized.beneficios)) return { ok: false, message: 'Revise os benefícios: título, descrição ou limite de 12 itens inválido.' };
  if (normalized.contatos === undefined && [normalized.telefone1, normalized.telefone2].some(value => value && !isValidBrazilianPhone(value))) {
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
  const fontIssue = personalizationFontsIssue(config.fontes_personalizacao);
  if (fontIssue) return { ok: false, message: fontIssue };
  return { ok: true, value: { ...normalized, ...(normalized.contatos !== undefined ? { contatos: parseStoreContacts(normalized.contatos)! } : {}), ...(normalized.beneficios !== undefined ? { beneficios: parseStoreBenefits(normalized.beneficios)! } : {}), fontes_personalizacao: fonts } };
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
