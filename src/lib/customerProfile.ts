import { isValidCpf, isValidBrazilianPhone } from './commerce.js';
import { isFiscalState, parseNfeRecipient, type NfeRecipient } from './nfe.js';
export interface CustomerProfile {
  fullName: string;
  phone: string;
  cpf: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  fiscalRecipient: NfeRecipient | null;
  revision: string | null;
}
export const EMPTY_PROFILE: CustomerProfile = {
  fullName: '',
  phone: '',
  cpf: '',
  cep: '',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  fiscalRecipient: null,
  revision: null,
};
export function parseCustomerProfile(input: unknown): Omit<CustomerProfile, 'revision'> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const { fiscalRecipient, ...data } = input as Record<string, unknown>;
  const recipient = fiscalRecipient == null ? null : parseNfeRecipient(fiscalRecipient);
  if (fiscalRecipient != null && (!recipient?.recipientName || !recipient.recipientDocument)) return null;
  const allowed = Object.keys(EMPTY_PROFILE).filter(key => key !== 'fiscalRecipient').concat('expectedRevision');
  if (
    Object.keys(data).some(
      (key) =>
        !allowed.includes(key) || (!['revision', 'expectedRevision'].includes(key) && typeof data[key] !== 'string'),
    )
  )
    return null;
  const result = Object.fromEntries(
    Object.keys(EMPTY_PROFILE)
      .filter((key) => key !== 'revision' && key !== 'fiscalRecipient')
      .map((key) => [key, typeof data[key] === 'string' ? data[key].trim() : '']),
  ) as Omit<CustomerProfile, 'revision' | 'fiscalRecipient'>;
  if (
    Object.entries(result).some(
      ([key, value]) =>
        /[\x00-\x1f\x7f]/.test(value) ||
        value.length > (['number', 'state', 'cep', 'cpf', 'phone'].includes(key) ? 30 : 160),
    )
  )
    return null;
  result.cpf = result.cpf.replace(/\D/g, '');
  result.phone = result.phone.replace(/\D/g, '');
  result.cep = result.cep.replace(/\D/g, '');
  result.state = result.state.toUpperCase();
  if (
    (result.fullName && (result.fullName.length < 3 || result.fullName.split(/\s+/).length < 2)) ||
    (result.cpf && !isValidCpf(result.cpf)) ||
    (result.phone && !isValidBrazilianPhone(result.phone)) ||
    (result.cep && result.cep.length !== 8) ||
    (result.state && !isFiscalState(result.state))
  )
    return null;
  return { ...result, fiscalRecipient: recipient };
}
