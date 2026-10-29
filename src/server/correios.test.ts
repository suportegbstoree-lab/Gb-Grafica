import assert from 'node:assert/strict';
import test from 'node:test';
import { CorreiosClient, CorreiosError, correiosConfig, correiosMoneyToCents, type CorreiosTransport } from './correios.js';
import { shippingParcelsForCart } from './shippingCart.js';
import { parseShippingProfile, type ShippingParcel } from '../lib/shipping.js';

const env = { CORREIOS_TOKEN: 'token-ficticio', CORREIOS_ORIGIN_CEP: '14400-000', CORREIOS_SERVICES: '03298:PAC,03220:SEDEX' };
const parcel: ShippingParcel = { weightGrams: 750, lengthCm: 25, widthCm: 20, heightCm: 15 };
const profile = { unitWeightGrams: 300, packagingWeightGrams: 150, lengthCm: 25, widthCm: 20, heightCm: 15, unitsPerParcel: 2 };
const hasCode = (code: string) => (error: unknown) => error instanceof CorreiosError && error.code === code;

function successfulResponse(url: string, body: any) {
  if (url.includes('/preco/')) return { status: 200, data: body.parametrosProduto.map((p: any) => ({
    coProduto: p.coProduto, nuRequisicao: p.nuRequisicao, pcFinal: p.coProduto === '03298' ? '12,90' : '25,30',
  })).reverse() };
  return { status: 200, data: body.parametrosPrazo.map((p: any) => ({
    coProduto: p.coProduto, nuRequisicao: p.nuRequisicao, prazoEntrega: 4, entregaDomiciliar: 'S', entregaSabado: 'N',
  })) };
}

test('configuração exige origem, códigos explícitos e token ou credenciais completas', () => {
  assert.equal(correiosConfig(env).originCep, '14400000');
  assert.equal(correiosConfig({ ...env, CORREIOS_TOKEN: 'Bearer token-ficticio' }).token, 'token-ficticio');
  for (const changes of [ { CORREIOS_ORIGIN_CEP: '' }, { CORREIOS_ENV: 'https://atacante.test' },
    { CORREIOS_SERVICES: '03298:PAC,03298:SEDEX' }, { CORREIOS_SERVICES: '' },
    { CORREIOS_TOKEN: 'secret\r\nheader' }, { CORREIOS_USER: 'parcial' }, { CORREIOS_CONTRACT: 'abc' } ]) {
    assert.throws(() => correiosConfig({ ...env, ...changes }), hasCode('CORREIOS_CONFIGURATION'));
  }
});

test('interpreta centavos brasileiros sem aceitar moeda negativa ou ambígua', () => {
  for (const [input, expected] of [['12,90', 1290], ['1.234,56', 123456], ['1234.56', 123456], ['10', 1000]] as const) {
    assert.equal(correiosMoneyToCents(input), expected);
  }
  for (const input of ['0,00', '-1,00', '12,9', '1.23,45', '1e3', 'R$ 10,00', 12.9, 'Infinity']) assert.equal(correiosMoneyToCents(input), null);
});

test('cota todos os volumes em lote e correlaciona respostas sem depender da ordem', async () => {
  const calls: any[] = [];
  const client = new CorreiosClient(correiosConfig(env), async (url, body, auth) => {
    calls.push({ url, body, auth }); return successfulResponse(url, body);
  });
  const options = await client.quote('01001000', [parcel, { ...parcel, weightGrams: 450 }]);
  assert.deepEqual(options.map(o => [o.service_code, o.amount_cents]), [['03298', 2580], ['03220', 5060]]);
  assert.equal(calls.length, 2);
  const price = calls.find(c => c.url.endsWith('/preco/v1/nacional'));
  assert.equal(price.body.parametrosProduto.length, 4);
  assert.equal(price.body.parametrosProduto[0].psObjeto, '750');
  assert.equal(price.body.parametrosProduto[0].comprimento, '25');
  assert.equal(price.auth, 'Bearer token-ficticio');
});

test('falha em um volume ou prazo remove o serviço inteiro, sem frete parcial ou fixo', async () => {
  const client = new CorreiosClient(correiosConfig(env), async (url, body: any) => {
    const result = successfulResponse(url, body);
    if (url.includes('/preco/')) return { status: 206, data: result.data.filter((r: any) => r.nuRequisicao !== '03298-1') };
    return result;
  });
  assert.deepEqual((await client.quote('01001000', [parcel, parcel])).map(o => o.service_code), ['03220']);
  const missingDeadlines = new CorreiosClient(correiosConfig(env), async (url, body) => url.includes('/prazo/')
    ? { status: 200, data: [] } : successfulResponse(url, body));
  await assert.rejects(missingDeadlines.quote('01001000', [parcel]), hasCode('SHIPPING_UNAVAILABLE'));
});

test('duplicação, erro explícito e preço inválido não produzem uma cotação', async () => {
  for (const mode of ['duplicate', 'error', 'price']) {
    const client = new CorreiosClient(correiosConfig(env), async (url, body) => {
      const result = successfulResponse(url, body);
      if (url.includes('/preco/')) {
        if (mode === 'duplicate') result.data.push(...result.data);
        else result.data = result.data.map((r: any) => ({ ...r, ...(mode === 'error' ? { txErro: 'restrito' } : { pcFinal: '-10,00' }) }));
      }
      return result;
    });
    await assert.rejects(client.quote('01001000', [parcel]), hasCode('SHIPPING_UNAVAILABLE'));
  }
});

test('renova uma única vez após 401; token temporário exige intervenção ao expirar', async () => {
  let generations = 0;
  const config = correiosConfig({ ...env, CORREIOS_USER: 'usuario', CORREIOS_ACCESS_CODE: 'senha-api', CORREIOS_POSTING_CARD: '1234567890' });
  const client = new CorreiosClient(config, async (url, body, auth) => {
    if (url.includes('/token/')) {
      generations += 1;
      assert.equal(auth, `Basic ${Buffer.from('usuario:senha-api').toString('base64')}`);
      assert.deepEqual(body, { numero: '1234567890' });
      return { status: 201, data: { token: `token-${generations}`, expiraEm: new Date(Date.now() + 3600_000).toISOString() } };
    }
    if (auth === 'Bearer token-1') return { status: 401, data: { segredo: 'não exibir' } };
    return successfulResponse(url, body);
  });
  await client.quote('01001000', [parcel]);
  await client.quote('01001000', [parcel]);
  assert.equal(generations, 2);
  const temporary = new CorreiosClient(correiosConfig(env), async () => ({ status: 401, data: { secret: 'provider-secret' } }));
  await assert.rejects(temporary.quote('01001000', [parcel]), error => {
    assert.ok(hasCode('CORREIOS_TOKEN_EXPIRED')(error));
    assert.ok(!String(error).includes('provider-secret')); return true;
  });
});

test('compartilha geração concorrente e renova perto do vencimento usando zoneOffset', async () => {
  let now = Date.parse('2026-10-29T15:00:00Z');
  let generations = 0;
  const config = correiosConfig({ ...env, CORREIOS_USER: 'usuario', CORREIOS_ACCESS_CODE: 'codigo', CORREIOS_POSTING_CARD: '1234567890' });
  const client = new CorreiosClient(config, async (url, body) => {
    if (url.includes('/token/')) {
      generations += 1;
      return { status: 201, data: { token: `token-${generations}`, expiraEm: '2026-10-29T13:00:00', zoneOffset: '-03:00' } };
    }
    return successfulResponse(url, body);
  }, () => now);
  await Promise.all([client.quote('01001000', [parcel]), client.quote('01001000', [parcel])]);
  assert.equal(generations, 1);
  now = Date.parse('2026-10-29T15:59:30Z');
  // A próxima emissão precisa retornar um vencimento futuro.
  await assert.rejects(client.quote('01001000', [parcel]), hasCode('CORREIOS_UNAVAILABLE'));
  assert.equal(generations, 2);
});

test('token JWT vencido é recusado localmente e 403 não é repetido', async () => {
  const expired = `a.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.b`;
  let calls = 0;
  const request: CorreiosTransport = async () => { calls++; return { status: 403, data: {} }; };
  await assert.rejects(new CorreiosClient(correiosConfig({ ...env, CORREIOS_TOKEN: expired }), request).quote('01001000', [parcel]), hasCode('CORREIOS_TOKEN_EXPIRED'));
  assert.equal(calls, 0);
  await assert.rejects(new CorreiosClient(correiosConfig(env), request).quote('01001000', [parcel]), hasCode('CORREIOS_ACCESS_DENIED'));
  assert.equal(calls, 2);
});

test('limita a espera total da cotação', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new CorreiosClient(correiosConfig(env), async () => new Promise(() => {}));
  const promise = client.quote('01001000', [parcel]);
  const rejection = assert.rejects(promise, hasCode('CORREIOS_TIMEOUT'));
  t.mock.timers.tick(22_000);
  await rejection;
});

test('rejeita volumes e perfis fora dos limites', async () => {
  assert.ok(parseShippingProfile(profile));
  for (const changes of [{ unitWeightGrams: -1 }, { unitsPerParcel: 0 }, { lengthCm: 101 }, { unitWeightGrams: 20000 }, { heightCm: 100, widthCm: 100, lengthCm: 100 }]) {
    assert.equal(parseShippingProfile({ ...profile, ...changes }), null);
  }
  await assert.rejects(new CorreiosClient(correiosConfig(env)).quote('01001000', Array(21).fill(parcel)), hasCode('SHIPPING_INVALID_PACKAGE'));
});

test('usa somente peso do catálogo, agrupa linhas iguais e divide pela capacidade real', async () => {
  const load = async () => ({ shipping: profile });
  const parcels = await shippingParcelsForCart([
    { productId: 'p', selecoes: {}, quantidade: 2, weightGrams: 1 },
    { productId: 'p', selecoes: {}, quantidade: 1, shipping: { ...profile, unitWeightGrams: 1 } },
  ], load);
  assert.deepEqual(parcels.map(p => p.weightGrams), [750, 450]);
});

test('não mistura produtos e considera perfil específico da combinação', async () => {
  const p = { atributos: [{ nome: 'Tamanho', opcoes: ['P', 'G'] }], combinacoes: { P: '10', G: '20' },
    shipping: profile, shippingByCombination: { G: { ...profile, unitWeightGrams: 1000 } } };
  const parcels = await shippingParcelsForCart([
    { productId: 'p', selecoes: { Tamanho: 'G' }, quantidade: 1 },
    { productId: 'q', selecoes: { Tamanho: 'P' }, quantidade: 1 },
  ], async () => p);
  assert.deepEqual(parcels.map(p => p.weightGrams), [1150, 450]);
  await assert.rejects(shippingParcelsForCart([{ productId: 'p', selecoes: {}, quantidade: 1 }], async () => p), hasCode('SHIPPING_INVALID_CART'));
});

test('não inventa medidas para produto sem perfil e impede excesso de volumes', async () => {
  await assert.rejects(shippingParcelsForCart([{ productId: 'p', selecoes: {}, quantidade: 1 }], async () => ({})), hasCode('SHIPPING_PRODUCT_NOT_CONFIGURED'));
  await assert.rejects(shippingParcelsForCart([{ productId: 'p', selecoes: {}, quantidade: 999 }], async () => ({ shipping: profile })), hasCode('SHIPPING_TOO_MANY_PARCELS'));
  for (const quantidade of [0, -1, 0.5, '2', 1000]) await assert.rejects(shippingParcelsForCart([{ productId: 'p', selecoes: {}, quantidade }], async () => ({ shipping: profile })), hasCode('SHIPPING_INVALID_CART'));
});
