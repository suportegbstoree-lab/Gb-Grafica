import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import axios, { type AxiosRequestConfig } from 'axios';
import { memoryFirestore } from '../../test/helpers/memoryFirestore.js';
import { shipmentLabelOperation } from './shipmentLabelOperation.js';

const orderId = 'GB-ETIQUETA-TESTE', orderPath = `orders/${orderId}`;
const providerId = 'a33865e5-6c42-484d-9ec2-8a94e29484b7';
const labelPath = `_melhorEnvioLabels/${orderId}`;
const chargeId = 'CHAR_ETIQUETA';
const fields = { action: 'prepare', invoiceKey: '1'.repeat(44), recipientDocument: '52998224725' };
const baseOrder = {
  metodoEntrega: 'entrega', paymentStatus: 'pago', fulfillmentStatus: 'em_producao', pagbankChargeId: chargeId,
  shipping: {
    provider: 'melhor_envio', service_code: 'me:3', carrier_name: 'Jadlog', environment: 'sandbox',
    origin_cep: '14400000', destination_cep: '01001000', parcels: [{ lengthCm: 25, widthCm: 20, heightCm: 15, weightGrams: 750 }],
  },
  itens: [{ nome: 'Caderno', preco: '20.00', quantidade: 2 }],
  clienteNome: 'Cliente de Teste', clienteEmail: 'cliente@example.test', clienteTelefone: '11999999999',
  enderecoEntrega: { cep: '01001000', rua: 'Praça da Sé', numero: '10', bairro: 'Sé', cidade: 'São Paulo', estado: 'SP' },
};
const env = {
  MELHOR_ENVIO_ENV: 'sandbox', MELHOR_ENVIO_TOKEN: 'token-de-teste', MELHOR_ENVIO_SERVICES: '',
  MELHOR_ENVIO_ORIGIN_CEP: '14400000', MELHOR_ENVIO_CONTACT_EMAIL: 'tecnico@example.test',
  MELHOR_ENVIO_SENDER: JSON.stringify({
    name: 'Gráfica de Teste', email: 'loja@example.test', phone: '16999999999', document: '11.222.333/0001-81',
    state_register: '123456789012', address: 'Rua de Teste', number: '1', district: 'Centro', city: 'Franca', state_abbr: 'SP',
  }),
};
const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
beforeEach(() => { Object.assign(process.env, env); });
afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
});

function scenario() {
  const { db, docs } = memoryFirestore([[orderPath, structuredClone(baseOrder)]]);
  let paid = false, issued = false, amount = '14.25', ambiguous = false, reject = false;
  let verified = 0;
  const calls: AxiosRequestConfig[] = [];
  mock.method(axios, 'request', async (request: AxiosRequestConfig) => {
    calls.push(request);
    assert.match(request.url!, /^https:\/\/sandbox\.melhorenvio\.com\.br\/api\/v2\/me\//);
    assert.equal(request.maxRedirects, 0);
    assert.equal(request.headers?.Authorization, 'Bearer token-de-teste');
    const path = request.url!.split('/api/v2/me/')[1];
    if (path === 'cart') return { status: 201, data: { id: providerId, price: amount } };
    if (path === `orders/${providerId}`) return { status: 200, data: {
      id: providerId, price: amount, status: paid ? 'released' : 'pending',
      paid_at: paid ? 'now' : null, generated_at: issued ? 'now' : null,
      tracking: issued ? '12345678901234' : null, service_id: 3, tags: [{ tag: orderId }],
    } };
    if (path === 'shipment/checkout') {
      assert.deepEqual(request.data, { orders: [providerId] });
      if (reject) return { status: 422, data: { error: 'informação privada do provedor' } };
      if (ambiguous) throw new Error('informação privada do provedor');
      paid = true; return { status: 200, data: {} };
    }
    if (path === 'shipment/generate') {
      assert.deepEqual(request.data, { orders: [providerId] });
      issued = true; return { status: 200, data: {} };
    }
    if (path === `imprimir/pdf/${providerId}`) return { status: 200, data: Buffer.from('%PDF-1.7\nfixture') };
    throw new Error('Chamada inesperada');
  });
  const invoke = (body: Record<string, unknown>, environment = 'sandbox') =>
    shipmentLabelOperation({ db, orderId, actor: 'staff', body,
      paymentEnvironment: () => environment, verifyPayment: async () => { verified++; return chargeId; } });
  const count = (path: string) => calls.filter(request => request.url?.endsWith(path)).length;
  return {
    docs, calls, invoke, count, verified: () => verified,
    changePrice: (value: string) => { amount = value; },
    failPayment: (value: 'ambiguous' | 'rejected' | null) => { ambiguous = value === 'ambiguous'; reject = value === 'rejected'; },
    markPaid: () => { paid = true; },
  };
}

test('creates, purchases, generates and downloads a shipping label for a simulated paid order', async () => {
  const s = scenario();
  assert.deepEqual(await s.invoke({ action: 'status' }), { phase: 'none', amountCents: null });
  assert.deepEqual(await s.invoke(fields), { phase: 'cart', amountCents: 1425, providerId });
  const payload = s.calls[0].data;
  assert.equal(payload.from.company_document, '11222333000181');
  assert.equal(payload.to.document, fields.recipientDocument);
  assert.equal(payload.options.invoice.key, fields.invoiceKey);
  assert.deepEqual(payload.products, [{ name: 'Caderno', quantity: 2, unitary_value: '20.00' }]);
  assert.deepEqual(payload.volumes, [{ height: 15, width: 20, length: 25, weight: 0.75 }]);
  assert.ok(!JSON.stringify(s.docs.get(labelPath)).includes(fields.recipientDocument));
  assert.ok(!JSON.stringify(s.docs.get(labelPath)).includes(fields.invoiceKey));
  assert.equal(s.verified(), 1);
  s.changePrice('15.00');
  assert.deepEqual(await s.invoke({ action: 'issue', expectedAmountCents: 1425 }), { phase: 'cart', amountCents: 1500, providerId });
  assert.equal(s.count('/shipment/checkout'), 0);
  assert.deepEqual(await s.invoke({ action: 'issue', expectedAmountCents: 1500 }), { phase: 'paid', amountCents: 1500, providerId });
  assert.deepEqual(await s.invoke({ action: 'issue' }), { phase: 'issued', amountCents: 1500, providerId, tracking: '12345678901234' });
  assert.deepEqual(await s.invoke({ action: 'print' }), Buffer.from('%PDF-1.7\nfixture'));
  await s.invoke({ action: 'issue' });
  assert.equal(s.count('/cart'), 1);
  assert.equal(s.count('/shipment/checkout'), 1);
  assert.equal(s.count('/shipment/generate'), 1);
  assert.equal(s.docs.get(orderPath)?.fulfillmentStatus, 'em_producao');
});

test('rejects unpaid or refunded orders and mixed environments before reaching Melhor Envio', async () => {
  const s = scenario();
  await assert.rejects(s.invoke(fields, 'production'), /mesmo ambiente/);
  s.docs.get(orderPath)!.paymentStatus = 'pendente';
  await assert.rejects(s.invoke(fields), /pagamento confirmado/);
  s.docs.get(orderPath)!.paymentStatus = 'pago';
  s.docs.get(orderPath)!.pagbankRefundedAmountCents = 1;
  await assert.rejects(s.invoke(fields), /sem estorno/);
  assert.equal(s.calls.length, 0);
  assert.equal(s.verified(), 0);
});

test('concurrent requests cannot create or charge the same label twice', async () => {
  const s = scenario();
  await Promise.allSettled([s.invoke(fields), s.invoke(fields)]);
  assert.equal(s.count('/cart'), 1);
  const request = { action: 'issue', expectedAmountCents: 1425 };
  await Promise.allSettled([s.invoke(request), s.invoke(request)]);
  assert.equal(s.count('/shipment/checkout'), 1);
  assert.equal(s.docs.get(labelPath)?.phase, 'paid');
});

test('a definitive refusal permits correction and an ambiguous payment is reconciled without another checkout', async () => {
  const s = scenario();
  await s.invoke(fields);
  const request = { action: 'issue', expectedAmountCents: 1425 };
  s.failPayment('rejected');
  await assert.rejects(s.invoke(request), /recusou a operação/);
  assert.equal(s.docs.get(labelPath)?.phase, 'cart');
  s.failPayment('ambiguous');
  await assert.rejects(s.invoke(request), /não confirmou/);
  assert.equal(s.docs.get(labelPath)?.phase, 'buying');
  await s.invoke(request);
  assert.equal(s.count('/shipment/checkout'), 2);
  s.markPaid();
  await s.invoke(request);
  assert.equal(s.docs.get(labelPath)?.phase, 'issued');
  assert.equal(s.count('/shipment/checkout'), 2);
});

test('rejects unallocated multiple parcels for carriers that require one shipment per parcel', async () => {
  const s = scenario();
  const order = s.docs.get(orderPath)!;
  order.shipping = { ...baseOrder.shipping, carrier_name: 'Loggi', service_code: 'me:31', parcels: [...baseOrder.shipping.parcels, ...baseOrder.shipping.parcels] };
  await assert.rejects(s.invoke(fields), /distribuição de produtos por volume/);
  assert.equal(s.calls.length, 0);
});
