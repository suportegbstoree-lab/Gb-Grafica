import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostedCheckout, isTrustedPagBankPaymentUrl } from './checkoutService';

test('aceita somente endereços HTTPS de pagamento do PagBank', () => {
  assert.equal(isTrustedPagBankPaymentUrl('https://pagamento.sandbox.pagbank.com.br/pagamento?code=teste'), true);
  assert.equal(isTrustedPagBankPaymentUrl('https://pagamento.pagbank.com.br/checkout'), true);
  assert.equal(isTrustedPagBankPaymentUrl('http://pagamento.pagbank.com.br/checkout'), false);
  assert.equal(isTrustedPagBankPaymentUrl('https://pagamento.pagbank.com.br:444/checkout'), false);
  assert.equal(isTrustedPagBankPaymentUrl('https://pagbank.example.com/checkout'), false);
});

test('envia o token e retorna o checkout hospedado', async () => {
  let receivedRequest: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    receivedRequest = { input, init };
    return new Response(JSON.stringify({
      init_point: 'https://pagamento.pagbank.com.br/exemplo',
      order_id: 'GB-TESTE',
      checkout_id: 'CHEC_TESTE',
    }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await createHostedCheckout({ items: [{ productId: 'produto-1' }] }, 'token-teste', fakeFetch);

  assert.equal(receivedRequest?.input, '/api/checkout');
  assert.equal(receivedRequest?.init?.method, 'POST');
  assert.equal((receivedRequest?.init?.headers as Record<string, string>).Authorization, 'Bearer token-teste');
  assert.deepEqual(result, {
    initPoint: 'https://pagamento.pagbank.com.br/exemplo',
    orderId: 'GB-TESTE',
    checkoutId: 'CHEC_TESTE',
  });
});

test('propaga a mensagem pública de erro da API simulada', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({
    error: 'CPF recusado.',
    request_id: 'trace-checkout-1234',
  }), {
    status: 422,
    headers: { 'Content-Type': 'application/json' },
  });

  await assert.rejects(
    createHostedCheckout({}, 'token-teste', fakeFetch),
    /CPF recusado\. Referência: trace-checkout-1234/,
  );
});

test('recusa resposta de sucesso sem URL do PagBank', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ order_id: 'GB-TESTE' }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });

  await assert.rejects(
    createHostedCheckout({}, 'token-teste', fakeFetch),
    /não retornou o link de pagamento/,
  );
});

test('recusa redirecionamento externo mesmo em resposta 201', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ init_point: 'https://example.com/phishing' }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });

  await assert.rejects(
    createHostedCheckout({}, 'token-teste', fakeFetch),
    /não retornou o link de pagamento/,
  );
});
