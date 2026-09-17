import { useEffect } from 'react';
import type { SiteConfig } from '../types';

export const SITE_NAME = 'GB Gráfica';
export const SITE_URL = 'https://www.gblgrafica.com.br';
export const DEFAULT_PAGE_TITLE = 'GB Gráfica | Loja Online Oficial';
export const DEFAULT_PAGE_DESCRIPTION = 'Produtos gráficos e personalizados da GB Gráfica, com pagamento seguro pelo PagBank.';
export const DEFAULT_LOGO_URL = 'https://i.postimg.cc/rFGyvS0w/gb-logo-pdf.png';

interface PageMetadata {
  title?: string;
  description?: string;
  path?: string;
  image?: string;
  noIndex?: boolean;
}

function upsertMeta(selector: string, attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

function upsertCanonical(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!element) {
    element = document.createElement('link');
    element.rel = 'canonical';
    document.head.appendChild(element);
  }
  element.href = href;
}

export function absoluteSiteUrl(path = '/'): string {
  const normalizedPath = `/${path.trim().replace(/^\/+/, '')}`;
  return new URL(normalizedPath, SITE_URL).toString();
}

export function resolvePublicImage(value?: string): string {
  const candidate = value?.trim();
  if (!candidate || candidate === '/logo.png') return DEFAULT_LOGO_URL;

  try {
    const url = new URL(candidate, SITE_URL);
    return url.protocol === 'https:' ? url.toString() : DEFAULT_LOGO_URL;
  } catch {
    return DEFAULT_LOGO_URL;
  }
}

export function buildStoreStructuredData(config: SiteConfig) {
  const telephone = config.telefone1?.trim();
  const email = config.email_atendimento?.trim();
  const address = config.endereco_comercial?.trim();
  const taxId = config.documento_fiscal?.trim();

  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    '@id': `${SITE_URL}/#store`,
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    logo: resolvePublicImage(config.logo_url),
    image: resolvePublicImage(config.banner_principal || config.logo_url),
    description: DEFAULT_PAGE_DESCRIPTION,
    ...(telephone ? { telephone } : {}),
    ...(email ? { email } : {}),
    ...(taxId ? { taxID: taxId } : {}),
    ...(address ? { address: { '@type': 'PostalAddress', streetAddress: address, addressCountry: 'BR' } } : {}),
  };
}

export function usePageMetadata({
  title = DEFAULT_PAGE_TITLE,
  description = DEFAULT_PAGE_DESCRIPTION,
  path = '/',
  image = DEFAULT_LOGO_URL,
  noIndex = false,
}: PageMetadata) {
  useEffect(() => {
    const canonicalUrl = absoluteSiteUrl(path);
    const imageUrl = resolvePublicImage(image);
    const robots = noIndex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large';

    document.title = title;
    upsertCanonical(canonicalUrl);
    upsertMeta('meta[name="description"]', 'name', 'description', description);
    upsertMeta('meta[name="robots"]', 'name', 'robots', robots);
    upsertMeta('meta[property="og:type"]', 'property', 'og:type', 'website');
    upsertMeta('meta[property="og:locale"]', 'property', 'og:locale', 'pt_BR');
    upsertMeta('meta[property="og:site_name"]', 'property', 'og:site_name', SITE_NAME);
    upsertMeta('meta[property="og:title"]', 'property', 'og:title', title);
    upsertMeta('meta[property="og:description"]', 'property', 'og:description', description);
    upsertMeta('meta[property="og:url"]', 'property', 'og:url', canonicalUrl);
    upsertMeta('meta[property="og:image"]', 'property', 'og:image', imageUrl);
    upsertMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image');
    upsertMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title);
    upsertMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description);
    upsertMeta('meta[name="twitter:image"]', 'name', 'twitter:image', imageUrl);
  }, [description, image, noIndex, path, title]);
}

export function useStructuredData(id: string, value: unknown) {
  const serializedValue = JSON.stringify(value).replace(/</g, '\\u003c');

  useEffect(() => {
    let element = document.getElementById(id) as HTMLScriptElement | null;
    if (!element) {
      element = document.createElement('script');
      element.id = id;
      element.type = 'application/ld+json';
      document.head.appendChild(element);
    }
    element.textContent = serializedValue;

    return () => element?.remove();
  }, [id, serializedValue]);
}
