import { isValidCpf } from './commerce.js';
import type { DeliveryAddress, Order } from '../types.js';

export const NFE_PRODUCT_FIELDS = [
  { key: 'ncm', label: 'NCM', max: 8, pattern: /^\d{8}$/ },
  { key: 'cest', label: 'CEST (quando aplicável)', max: 7, pattern: /^\d{7}$/ },
  { key: 'origin', label: 'Código de origem', max: 1, pattern: /^[0-8]$/ },
  { key: 'unit', label: 'Unidade comercial', max: 6, pattern: /^[A-Z0-9]{1,6}$/ },
] as const;

export type NfeProductFields = Partial<Record<typeof NFE_PRODUCT_FIELDS[number]['key'], string>>;
export type NfeItemDraft = NfeProductFields & { cfop?: string; icmsCode?: string; couponCents: number | null };
export type NfeAddress = DeliveryAddress;
export const NFE_ADDRESS_FIELDS = [
  ['cep', 'CEP', 9], ['estado', 'UF', 2], ['cidade', 'Município', 60], ['cityCode', 'Código IBGE do município', 7],
  ['rua', 'Logradouro', 160], ['numero', 'Número', 20], ['bairro', 'Bairro', 60], ['complemento', 'Complemento', 60],
] as const satisfies ReadonlyArray<[keyof NfeAddress, string, number]>;

export const NFE_TAX_REGIMES = [
  ['1', 'Simples Nacional'],
  ['2', 'Simples Nacional — excesso de sublimite'],
  ['3', 'Regime Normal'],
  ['4', 'MEI'],
] as const;

export interface NfeIssuer {
  legalName: string;
  cnpj: string;
  stateRegistration: string;
  taxRegime: '' | typeof NFE_TAX_REGIMES[number][0];
  address: NfeAddress;
}

export const EMPTY_NFE_ISSUER: NfeIssuer = {
  legalName: '', cnpj: '', stateRegistration: '', taxRegime: '',
  address: { cep: '', estado: '', cidade: '', cityCode: '', rua: '', numero: '', bairro: '', complemento: '' },
};
export interface NfeRecipient {
  recipientName: string;
  recipientDocument: string;
  stateRegistration: string;
}
export const EMPTY_NFE_RECIPIENT: NfeRecipient = { recipientName: '', recipientDocument: '', stateRegistration: '' };
export const NFE_RECIPIENT_FIELDS = [
  ['recipientName', 'Nome ou razão social', 120],
  ['recipientDocument', 'CPF ou CNPJ', 24],
  ['stateRegistration', 'Inscrição estadual (quando aplicável)', 20],
] as const;
export interface NfeSalesRule {
  cfop: string;
  icmsCode: string;
}
export interface NfeDefaults {
  issuerState: string;
  operation: string;
  intrastate: NfeSalesRule;
  interstate: NfeSalesRule;
}
export interface NfeDefaultsConfig {
  revision: string | null;
  defaults: NfeDefaults;
  issuer: NfeIssuer;
}
export const EMPTY_NFE_DEFAULTS: NfeDefaults = {
  issuerState: '', operation: '', intrastate: { cfop: '', icmsCode: '' }, interstate: { cfop: '', icmsCode: '' },
};
const ufCodes = {
  AC: '12', AL: '27', AP: '16', AM: '13', BA: '29', CE: '23', DF: '53', ES: '32', GO: '52',
  MA: '21', MT: '51', MS: '50', MG: '31', PA: '15', PB: '25', PR: '41', PE: '26', PI: '22',
  RJ: '33', RN: '24', RS: '43', RO: '11', RR: '14', SC: '42', SP: '35', SE: '28', TO: '17',
};
export function isFiscalState(value: string): value is keyof typeof ufCodes {
  return Object.hasOwn(ufCodes, value);
}
export function validCityCode(code: string, state: string): boolean {
  return /^\d{7}$/.test(code) && isFiscalState(state) && code.startsWith(ufCodes[state]);
}
export interface NfeDraft extends NfeRecipient {
  address: NfeAddress;
  operation: string;
  items: NfeItemDraft[];
}
export interface NfeReview {
  environment: 'disabled' | 'simulacao' | 'homologacao' | 'invalid';
  revision: string | null;
  reviewedAt?: string;
  editable: boolean;
  paymentEnvironment: 'sandbox' | 'production' | null;
  draft: NfeDraft;
  issues: string[];
  issuerMissing: string[];
  lines: Array<{ name: string; sku: string; quantity: number; unitCents: number; bundle: boolean }>;
  totals: { itemsCents: number; itemCouponCents: number; shippingCents: number; shippingCouponCents: number; totalCents: number };
  couponFromCheckout: boolean;
}

export const NFE_SUMMARY_PAGE_SIZE = 10;
export const NFE_ORDER_ID = /^GB-[A-Z0-9]{8,64}$/;
export interface NfeOrderSummary {
  status: 'pending' | 'ready' | 'reviewed' | 'unavailable';
  issues: string[];
  issueCount: number;
}

export function canReviewNfeOrder(order: Pick<Order, 'paymentStatus' | 'status' | 'fulfillmentStatus' | 'pagbankRefundedAmountCents'>) {
  const paid = order.paymentStatus ? order.paymentStatus === 'pago' : order.status === 'Pago';
  return paid && order.fulfillmentStatus !== 'cancelado' && !Number(order.pagbankRefundedAmountCents);
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

export function missingNfeProductFields(value?: NfeProductFields) {
  return NFE_PRODUCT_FIELDS
    .filter(({ key, pattern }) => key !== 'cest' && !pattern.test(value?.[key] ?? ''))
    .map(({ label }) => label);
}

export function parseNfeAddress(value: unknown): NfeAddress | null {
  const input = fiscalRecord(value);
  if (!input) return null;
  const address = { ...EMPTY_NFE_ISSUER.address };
  for (const [key, , max] of NFE_ADDRESS_FIELDS) {
    const value = fiscalText(input[key], max);
    if (value === null) return null;
    address[key] = value;
  }
  address.cep = address.cep.replace('-', '');
  address.estado = address.estado.toUpperCase();
  const cityCode = address.cityCode ?? '';
  if ((address.cep && !/^\d{8}$/.test(address.cep)) ||
    (address.estado && !isFiscalState(address.estado)) ||
    (cityCode && (!/^\d{7}$/.test(cityCode) || (address.estado && !validCityCode(cityCode, address.estado))))) return null;
  return address;
}

export function parseNfeIssuer(value: unknown): NfeIssuer | null {
  const input = fiscalRecord(value);
  if (!input) return null;
  const legalName = fiscalText(input.legalName, 60);
  const document = fiscalText(input.cnpj, 24);
  const registration = fiscalText(input.stateRegistration, 20);
  const taxRegime = NFE_TAX_REGIMES.find(([code]) => code === input.taxRegime)?.[0] ?? '';
  const address = parseNfeAddress(input.address);
  if (legalName === null || document === null || registration === null || !address ||
    (input.taxRegime !== undefined && input.taxRegime !== '' && !taxRegime)) return null;
  const cnpj = parseNfeDocument(document);
  const stateRegistration = registration.replace(/[. /-]/g, '');
  if (cnpj === null || (cnpj && cnpj.length !== 14) || (registration && !/^\d{2,14}$/.test(stateRegistration))) return null;
  return { legalName, cnpj, stateRegistration, taxRegime, address };
}

function missingNfeAddressFields(address: NfeAddress) {
  return NFE_ADDRESS_FIELDS.filter(([key]) => {
    if (key === 'complemento') return false;
    if (key === 'cityCode') return !validCityCode(address.cityCode ?? '', address.estado);
    if (key === 'estado') return !isFiscalState(address.estado);
    if (key === 'cep') return !/^\d{5}-?\d{3}$/.test(address.cep);
    return !address[key];
  }).map(([, label]) => label);
}

export function missingNfeIssuerFields(issuer: NfeIssuer) {
  return [
    ...(!issuer.legalName ? ['Razão social'] : []),
    ...(!issuer.cnpj ? ['CNPJ'] : []),
    ...(!issuer.stateRegistration ? ['Inscrição estadual'] : []),
    ...(!issuer.taxRegime ? ['Regime tributário'] : []),
    ...missingNfeAddressFields(issuer.address),
  ];
}

export function nfeDraftIssues(
  draft: NfeDraft, lines: NfeReview['lines'], expectedDiscount: number, issuerMissing: string[],
) {
  const issues: string[] = [];
  if (issuerMissing.length) issues.push('Complete o cadastro do emitente em Loja → Informações da Loja → Configuração de NF-e.');
  if (!draft.recipientName || !parseNfeDocument(draft.recipientDocument)) issues.push('Confirme o nome e o documento do destinatário.');
  const addressMissing = missingNfeAddressFields(draft.address);
  if (addressMissing.length) issues.push('Complete o endereço fiscal do destinatário (' + addressMissing.join(', ') + ').');
  if (!draft.operation) issues.push('Informe a natureza da operação.');
  draft.items.forEach((item, index) => {
    const { name, sku, bundle } = lines[index];
    const label = 'Item ' + (index + 1) + ' · ' + name + (sku && sku !== name ? ' (' + sku + ')' : '');
    const missing = [...missingNfeProductFields(item),
      ...(!/^\d{4}$/.test(item.cfop ?? '') ? ['CFOP'] : []),
      ...(!/^\d{2,3}$/.test(item.icmsCode ?? '') ? ['CST ou CSOSN do ICMS'] : []),
    ];
    if (missing.length) issues.push(label + ' · Confira ' + missing.join(', ') + '.');
    if (bundle) issues.push(label + ' · Confirme com a contabilidade como discriminar os componentes do pacote.');
  });
  if (draft.items.some(item => item.couponCents === null) ||
    draft.items.reduce((sum, item) => sum + (item.couponCents ?? 0), 0) !== expectedDiscount) issues.push('A soma dos descontos por item deve fechar com o desconto dos produtos no pedido.');
  return issues;
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

export function parseNfeRecipient(value: unknown): NfeRecipient | null {
  const input = fiscalRecord(value);
  if (!input) return null;
  const recipientName = fiscalText(input.recipientName, 120);
  const document = fiscalText(input.recipientDocument, 24);
  const stateRegistration = fiscalText(input.stateRegistration, 20);
  if (recipientName === null || document === null || stateRegistration === null) return null;
  const recipientDocument = parseNfeDocument(document);
  if (recipientDocument === null) return null;
  return { recipientName, recipientDocument, stateRegistration };
}

export function parseNfeDefaults(value: unknown): NfeDefaults | null {
  const input = fiscalRecord(value);
  if (!input) return null;
  const issuerState = fiscalText(input.issuerState, 2)?.toUpperCase();
  const operation = fiscalText(input.operation, 60);
  if (issuerState === undefined || (issuerState && !isFiscalState(issuerState)) || operation === null) return null;
  const rule = (key: 'intrastate' | 'interstate', prefix: string): NfeSalesRule | null => {
    const row = fiscalRecord(input[key]);
    if (!row) return null;
    const cfop = fiscalText(row.cfop, 4);
    const icmsCode = fiscalText(row.icmsCode, 3);
    if (cfop === null || icmsCode === null || (cfop && (!/^\d{4}$/.test(cfop) || !cfop.startsWith(prefix))) ||
      (icmsCode && !/^\d{2,3}$/.test(icmsCode))) return null;
    return { cfop, icmsCode };
  };
  const intrastate = rule('intrastate', '5');
  const interstate = rule('interstate', '6');
  return intrastate && interstate ? { issuerState, operation, intrastate, interstate } : null;
}
