import assert from 'node:assert/strict';
import test from 'node:test';
import { requestShippingQuote } from './shippingService.js';

const quote = () => ({ cep: '14400000', address: 'Franca/SP', state: 'SP', street: '', neighborhood: '', city: 'Franca',
  amount_cents: 1290, options: [{ service_code: '03298', service_name: 'PAC', amount_cents: 1290, delivery_days: 5, home_delivery: true, saturday_delivery: false }],
  parcel_count: 1, quoted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString() });

test('envia apenas identificadores, seleções e quantidades para cotar', async () => {
  const items = [{ productId: 'p', quantidade: 1, selecoes: {}, preco: '0.01', unitWeightGrams: 1 }];
  const controller = new AbortController();
  const result = await requestShippingQuote('14400000', items, controller.signal, async (_url, init) => {
    assert.equal(init?.signal, controller.signal);
    assert.deepEqual(JSON.parse(String(init?.body)), { cep: '14400000', items: [{ productId: 'p', quantidade: 1, selecoes: {} }] });
    return Response.json(quote());
  });
  assert.equal(result.options[0].amount_cents, 1290);
});

test('rejeita cotação vencida, CEP divergente e opção inválida', async () => {
  for (const changes of [{ expires_at: 'inválido' }, { expires_at: '2020-01-01T00:00:00Z' }, { cep: '01001000' }, { options: [] },
    { options: [{ ...quote().options[0], amount_cents: -1 }] }]) {
    await assert.rejects(requestShippingQuote('14400000', [], undefined, async () => Response.json({ ...quote(), ...changes })), /dados inválidos/);
  }
});

test('erro da API preserva mensagem e referência para diagnóstico', async () => {
  await assert.rejects(requestShippingQuote('14400000', [], undefined, async () => Response.json({
    error: 'Frete indisponível.', request_id: 'shipping-trace-1234', code: 'CORREIOS_UNAVAILABLE',
  }, { status: 502 })), /Frete indisponível\. Referência: shipping-trace-1234/);
});
