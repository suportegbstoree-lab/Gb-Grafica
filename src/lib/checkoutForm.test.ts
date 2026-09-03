import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCheckoutForm, type CheckoutFormInput } from './checkoutForm';

const validForm: CheckoutFormInput = {
  acceptedLegalTerms: true,
  customerName: 'Cliente Teste',
  cpf: '529.982.247-25',
  phone: '(16) 99999-9999',
  deliveryMethod: 'entrega',
  hasShippingQuote: true,
  addressStreet: 'Rua Teste',
  addressNeighborhood: 'Centro',
  addressNumber: '100',
  hasInvalidCartPrice: false,
};

test('normaliza um formulário válido de checkout', () => {
  assert.deepEqual(validateCheckoutForm({ ...validForm, customerName: '  Cliente   Teste  ' }), {
    ok: true,
    customerName: 'Cliente Teste',
    cpf: '52998224725',
    phone: '16999999999',
  });
});

test('bloqueia checkout sem aceite jurídico', () => {
  const result = validateCheckoutForm({ ...validForm, acceptedLegalTerms: false });
  assert.deepEqual(result, { ok: false, message: 'Leia e aceite os termos da compra para continuar.' });
});

test('bloqueia dados pessoais inválidos', () => {
  assert.equal(validateCheckoutForm({ ...validForm, customerName: 'Cliente' }).ok, false);
  assert.equal(validateCheckoutForm({ ...validForm, cpf: '111.111.111-11' }).ok, false);
  assert.equal(validateCheckoutForm({ ...validForm, phone: '1234' }).ok, false);
});

test('bloqueia entrega sem cotação ou endereço completo', () => {
  assert.equal(validateCheckoutForm({ ...validForm, hasShippingQuote: false }).ok, false);
  assert.equal(validateCheckoutForm({ ...validForm, addressNumber: '' }).ok, false);
});

test('permite retirada sem cotação ou endereço', () => {
  const result = validateCheckoutForm({
    ...validForm,
    deliveryMethod: 'retirada',
    hasShippingQuote: false,
    addressStreet: '',
    addressNeighborhood: '',
    addressNumber: '',
  });
  assert.equal(result.ok, true);
});

test('bloqueia preço inválido antes da chamada de pagamento', () => {
  const result = validateCheckoutForm({ ...validForm, hasInvalidCartPrice: true });
  assert.equal(result.ok, false);
});
