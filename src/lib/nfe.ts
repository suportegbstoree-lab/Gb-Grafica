import { isValidCpf } from './commerce.js';
import type { DeliveryAddress } from '../types.js';

export const NFE_PRODUCT_FIELDS = [
  { key: 'ncm', label: 'NCM', max: 8, pattern: /^\d{8}$/ },
  { key: 'cest', label: 'CEST (quando aplicável)', max: 7, pattern: /^\d{7}$/ },
  { key: 'origin', label: 'Código de origem', max: 1, pattern: /^[0-8]$/ },
  { key: 'unit', label: 'Unidade comercial', max: 6, pattern: /^[A-Z0-9]{1,6}$/ },
] as const;

export type NfeProductFields = Partial<Record<typeof NFE_PRODUCT_FIELDS[number]['key'], string>>;
export type NfeItemDraft = NfeProductFields & { cfop?: string; icmsCode?: string; couponCents: number | null };
export type NfeAddress = DeliveryAddress & { cityCode?: string };
export interface NfeDraft {
  recipientName: string;
  recipientDocument: string;
  stateRegistration: string;
  address: NfeAddress;
  operation: string;
  items: NfeItemDraft[];
}
export interface NfeReview {
  environment: 'disabled' | 'homologacao' | 'invalid';
  revision: string | null;
  editable: boolean;
  paymentEnvironment: 'sandbox' | 'production' | null;
  draft: NfeDraft;
  issues: string[];
  lines: Array<{ name: string; sku: string; quantity: number; unitCents: number; bundle: boolean }>;
  totals: { itemsCents: number; itemCouponCents: number; shippingCents: number; shippingCouponCents: number; totalCents: number };
  couponFromCheckout: boolean;
}

export function fiscalRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function fiscalText(value: unknown, limit: number): string | null {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.trim();
}

export function parseNfeProductFields(value: unknown): NfeProductFields | null {
  const input = fiscalRecord(value);
  if (!input || Object.keys(input).some(key => !NFE_PRODUCT_FIELDS.some(field => field.key === key))) return null;
  const output: NfeProductFields = {};
  for (const { key, max, pattern } of NFE_PRODUCT_FIELDS) {
    const text = fiscalText(input[key], max)?.toUpperCase();
    if (text === undefined || (text && !pattern.test(text))) return null;
    if (text) output[key] = text;
  }
  return output;
}

export function parseNfeDocument(value: string): string | null {
  if (!/^[a-z0-9./\s-]{0,24}$/i.test(value)) return null;
  const document = value.replace(/[./\s-]/g, '').toUpperCase();
  if (!document) return '';
  if (/^\d{11}$/.test(document)) return isValidCpf(document) ? document : null;
  if (!/^[A-Z0-9]{12}\d{2}$/.test(document) || /^(\d)\1{13}$/.test(document)) return null;
  const digit = (prefix: string) => {
    const sum = [...prefix].reverse().reduce((total, char, index) => total + (char.charCodeAt(0) - 48) * (index % 8 + 2), 0);
    return (sum % 11 < 2 ? 0 : 11 - sum % 11).toString();
  };
  const base = document.slice(0, 12);
  const first = digit(base);
  return document === base + first + digit(base + first) ? document : null;
}
