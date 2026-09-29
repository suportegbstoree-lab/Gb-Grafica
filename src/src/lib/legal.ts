export const LEGAL_EFFECTIVE_DATE = '2 de setembro de 2026';

export const LEGAL_VERSIONS = {
  terms: '2026-09-02',
  privacy: '2026-09-02',
  exchanges: '2026-09-02',
} as const;

export const LEGAL_ROUTES = {
  about: '/sobre-nos',
  privacy: '/politica-de-privacidade',
  terms: '/termos-de-uso',
  exchanges: '/trocas-cancelamentos-e-reembolsos',
  production: '/prazos-de-producao',
  artwork: '/artes-personalizadas',
  lgpd: '/lgpd',
} as const;

export type LegalDocumentId = keyof typeof LEGAL_ROUTES;

export interface LegalAcceptance {
  accepted: true;
  termsVersion: string;
  privacyVersion: string;
  exchangesVersion: string;
}

export function currentLegalAcceptance(): LegalAcceptance {
  return {
    accepted: true,
    termsVersion: LEGAL_VERSIONS.terms,
    privacyVersion: LEGAL_VERSIONS.privacy,
    exchangesVersion: LEGAL_VERSIONS.exchanges,
  };
}

export function isCurrentLegalAcceptance(value: unknown): value is LegalAcceptance {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.accepted === true &&
    candidate.termsVersion === LEGAL_VERSIONS.terms &&
    candidate.privacyVersion === LEGAL_VERSIONS.privacy &&
    candidate.exchangesVersion === LEGAL_VERSIONS.exchanges;
}

export interface LegalBusinessData {
  razao_social?: string;
  documento_fiscal?: string;
  endereco_comercial?: string;
  email_atendimento?: string;
  email_privacidade?: string;
  prazo_producao?: string;
}

const REQUIRED_BUSINESS_FIELDS: Array<keyof LegalBusinessData> = [
  'razao_social',
  'documento_fiscal',
  'endereco_comercial',
  'email_atendimento',
  'email_privacidade',
  'prazo_producao',
];

export function missingLegalBusinessFields(data: LegalBusinessData): Array<keyof LegalBusinessData> {
  return REQUIRED_BUSINESS_FIELDS.filter(field => {
    const value = data[field];
    return typeof value !== 'string' || value.trim().length === 0;
  });
}

export function hasCompleteLegalBusinessData(data: LegalBusinessData): boolean {
  return missingLegalBusinessFields(data).length === 0;
}
