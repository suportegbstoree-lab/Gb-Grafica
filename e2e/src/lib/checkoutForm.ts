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
