import { isValidBrazilianPhone, isValidCpf } from './commerce';
import type { DeliveryMethod } from './orderStatus';

export interface CheckoutFormInput {
  acceptedLegalTerms: boolean;
  customerName: string;
  cpf: string;
  phone: string;
  deliveryMethod: DeliveryMethod;
  hasShippingQuote: boolean;
  addressStreet: string;
  addressNeighborhood: string;
  addressNumber: string;
  hasInvalidCartPrice: boolean;
}

export type CheckoutFormResult =
  | { ok: true; customerName: string; cpf: string; phone: string }
  | { ok: false; message: string };

export interface CheckoutIssue { field: string; label: string; message: string; }
export function checkoutIssues(input: CheckoutFormInput): CheckoutIssue[] {
  const issues: CheckoutIssue[] = [];
  const add = (field: string, label: string) => issues.push({ field, label, message: `[${label} não preenchido ou inválido]` });
  if (input.customerName.trim().split(/\s+/).length < 2 || input.customerName.trim().length < 3) add('checkout-name', 'Nome completo');
  if (!isValidCpf(input.cpf.replace(/\D/g, ''))) add('checkout-cpf', 'CPF');
  if (!isValidBrazilianPhone(input.phone.replace(/\D/g, ''))) add('checkout-phone', 'Telefone');
  if (input.deliveryMethod === 'entrega') {
    if (!input.hasShippingQuote) add('shipping-cep', 'CEP e cálculo do frete');
    if (!input.addressStreet.trim()) add('shipping-street', 'Rua');
    if (!input.addressNeighborhood.trim()) add('shipping-neighborhood', 'Bairro');
    if (!input.addressNumber.trim()) add('shipping-number', 'Número');
  }
  if (!input.acceptedLegalTerms) add('checkout-legal-acceptance', 'Aceite dos termos');
  return issues;
}

export function validateCheckoutForm(input: CheckoutFormInput): CheckoutFormResult {
  if (!input.acceptedLegalTerms) {
    return { ok: false, message: 'Leia e aceite os termos da compra para continuar.' };
  }

  const customerName = input.customerName.trim().replace(/\s+/g, ' ');
  if (customerName.length < 3 || customerName.split(' ').filter(Boolean).length < 2) {
    return { ok: false, message: 'Informe nome e sobrenome para continuar.' };
  }

  const cpf = input.cpf.replace(/\D/g, '');
  if (!isValidCpf(cpf)) {
    return { ok: false, message: 'Informe um CPF válido para continuar.' };
  }

  const phone = input.phone.replace(/\D/g, '');
  if (!isValidBrazilianPhone(phone)) {
    return { ok: false, message: 'Informe um telefone válido para contato sobre o pedido.' };
  }

  if (input.deliveryMethod === 'entrega' && !input.hasShippingQuote) {
    return { ok: false, message: 'Calcule o frete antes de continuar.' };
  }

  if (
    input.deliveryMethod === 'entrega' &&
    (!input.addressStreet.trim() || !input.addressNeighborhood.trim() || !input.addressNumber.trim())
  ) {
    return { ok: false, message: 'Complete rua, bairro e número do endereço de entrega.' };
  }

  if (input.hasInvalidCartPrice) {
    return { ok: false, message: 'Há um item com preço inválido no carrinho. Remova-o e selecione novamente.' };
  }

  return { ok: true, customerName, cpf, phone };
}
