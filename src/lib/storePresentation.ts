import type { Anuncio, SiteConfig, StoreBenefit, StoreContact } from '../types';
import { isValidBrazilianPhone } from './commerce';

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const validId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const email = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function parseStoreContacts(value: unknown): StoreContact[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const result: StoreContact[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || !validId(item.id) || result.some(contact => contact.id === item.id) ||
        !['whatsapp', 'phone', 'email'].includes(item.type) || !clean(item.label) || clean(item.label).length > 60 ||
        !clean(item.value) || clean(item.value).length > 160 || /[\r\n\x00]/.test(item.value)) return null;
    const normalized = clean(item.value);
    if (item.type === 'email' ? !email.test(normalized) : !isValidBrazilianPhone(normalized)) return null;
    result.push({ id: item.id, type: item.type, label: clean(item.label), value: item.type === 'email' ? normalized.toLowerCase() : normalized });
  }
  return result;
}

export function storeContacts(config: Partial<SiteConfig>): StoreContact[] {
  if (config.contatos !== undefined) return parseStoreContacts(config.contatos) || [];
  const legacy: StoreContact[] = [];
  for (const [index, value] of [config.telefone1, config.telefone2].entries()) {
    if (clean(value) && isValidBrazilianPhone(value) && !legacy.some(contact => contact.value.replace(/\D/g, '') === value!.replace(/\D/g, ''))) {
      legacy.push({ id: `legacy-phone-${index}`, type: 'whatsapp', label: index ? 'WhatsApp alternativo' : 'WhatsApp principal', value: clean(value) });
    }
  }
  if (email.test(clean(config.email_atendimento))) legacy.push({ id: 'legacy-email', type: 'email', label: 'E-mail', value: clean(config.email_atendimento).toLowerCase() });
  return legacy;
}

export function contactHref(contact: StoreContact): string {
  if (contact.type === 'email') return `mailto:${encodeURIComponent(contact.value).replace('%40', '@')}`;
  const digits = contact.value.replace(/\D/g, '');
  return contact.type === 'whatsapp' ? `https://wa.me/55${digits}` : `tel:+55${digits}`;
}

export function parseStoreBenefits(value: unknown): StoreBenefit[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const result: StoreBenefit[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || !validId(item.id) || result.some(benefit => benefit.id === item.id) ||
        !clean(item.title) || clean(item.title).length > 100 || clean(item.description).length > 180 || typeof item.description !== 'string') return null;
    result.push({ id: item.id, title: clean(item.title), description: clean(item.description) });
  }
  return result;
}

export function storeBenefits(config: Partial<SiteConfig>): StoreBenefit[] {
  if (config.beneficios !== undefined) return parseStoreBenefits(config.beneficios) || [];
  return [1, 2, 3].flatMap(number => {
    const title = clean(config[`beneficio${number}_titulo` as keyof SiteConfig]);
    return title ? [{ id: `legacy-benefit-${number}`, title, description: clean(config[`beneficio${number}_desc` as keyof SiteConfig]) }] : [];
  });
}

export function featuredProducts(products: Anuncio[]): Anuncio[] {
  return products.filter(product => product.destaque === true && clean(product.imagem))
    .sort((a, b) => (a.destaqueOrdem || 0) - (b.destaqueOrdem || 0) || a.nome.localeCompare(b.nome, 'pt-BR'));
}
