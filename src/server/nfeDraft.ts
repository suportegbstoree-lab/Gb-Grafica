import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { parseMoneyToCents } from '../lib/commerce.js';
import { fiscalRecord, fiscalText, parseNfeDocument, parseNfeProductFields, type NfeAddress, type NfeDraft, type NfeItemDraft, type NfeReview } from '../lib/nfe.js';
import type { Order } from '../types.js';

export class NfeDraftError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function nfeEnvironment(): NfeReview['environment'] {
  const value = process.env.NFE_ENV?.trim() || 'disabled';
  return value === 'disabled' || value === 'homologacao' ? value : 'invalid';
}

export function nfeCheckoutSnapshot(
  items: Order['itens'], payerCpf: string,
  paymentEnvironment: 'production' | 'sandbox',
  couponByItem: number[],
  catalog: ReadonlyMap<string, Record<string, unknown>>,
) {
  return {
    payerCpf, paymentEnvironment,
    couponByItem: items.map((_, index) => couponByItem[index] ?? 0),
    products: items.map(item => parseNfeProductFields(catalog.get(item.productId)?.fiscal) ?? {}),
  };
}

function field(value: unknown, length: number, label: string): string {
  const checked = fiscalText(value, length);
  if (checked === null) throw new NfeDraftError(422, 'Revise o campo ' + label + '.');
  return checked;
}

const states = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
function parseAddress(input: unknown): NfeAddress {
  const data = fiscalRecord(input);
  if (!data) throw new NfeDraftError(422, 'Revise o endereço fiscal.');
  const cep = field(data.cep, 9, 'CEP').replace('-', '');
  const estado = field(data.estado, 2, 'UF').toUpperCase();
  const cityCode = field(data.cityCode, 7, 'Código IBGE do município');
  if ((cep && !/^\d{8}$/.test(cep)) || (estado && !states.has(estado)) || (cityCode && !/^\d{7}$/.test(cityCode))) {
    throw new NfeDraftError(422, 'Informe CEP, UF e código de município em formatos válidos.');
  }
  return {
    cep, estado, cityCode,
    rua: field(data.rua, 160, 'Logradouro'),
    numero: field(data.numero, 20, 'Número'),
    complemento: field(data.complemento, 60, 'Complemento'),
    bairro: field(data.bairro, 60, 'Bairro'),
    cidade: field(data.cidade, 60, 'Município'),
  };
}

const cents = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function paymentTotals(order: Order): Pick<NfeReview, 'lines' | 'totals'> {
  if (!Array.isArray(order.itens) || order.itens.length < 1 || order.itens.length > 50) {
    throw new NfeDraftError(422, 'A lista de itens do pedido está indisponível para conferência fiscal.');
  }
  const lines = order.itens.map(item => {
    const unitCents = parseMoneyToCents(item?.preco);
    if (!item || !cents(unitCents) || !Number.isSafeInteger(item.quantidade) || item.quantidade < 1 ||
      !Number.isSafeInteger(unitCents * item.quantidade)) {
      throw new NfeDraftError(422, 'Confira os preços e as quantidades no pedido antes da conferência fiscal.');
    }
    return { name: item.nome, sku: item.sku || item.productId, quantity: item.quantidade, unitCents, bundle: Boolean(item.bundleItems?.length) };
  });
  const itemsCents = lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0);
  const shippingCents = order.frete === undefined && order.metodoEntrega !== 'entrega' ? 0 : parseMoneyToCents(order.frete);
  const shippingCouponCents = order.cupom?.shippingDiscountCents ?? 0;
  const itemCouponCents = (order.cupom?.discountCents ?? 0) - shippingCouponCents;
  const totalCents = order.totalCents ?? parseMoneyToCents(order.total);
  if (!cents(itemsCents) || !cents(shippingCents) || !cents(shippingCouponCents) || !cents(itemCouponCents) ||
    !cents(totalCents) || totalCents < 1 || shippingCouponCents > shippingCents || itemCouponCents > itemsCents ||
    itemsCents + shippingCents - itemCouponCents - shippingCouponCents !== totalCents ||
    (order.subtotal !== undefined && parseMoneyToCents(order.subtotal) !== itemsCents)) {
    throw new NfeDraftError(422, 'Os valores registrados no pedido não fecham. Confira o pedido antes da conferência fiscal.');
  }
  return { lines, totals: { itemsCents, itemCouponCents, shippingCents, shippingCouponCents, totalCents } };
}

function initialAddress(address: Order['enderecoEntrega']): NfeAddress {
  return { cep: '', rua: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '', cityCode: '', ...address };
}

function draftFromInput(input: unknown, lines: NfeReview['lines'], coupon: number[] | null): NfeDraft {
  const data = fiscalRecord(input);
  if (!data || !Array.isArray(data.items) || data.items.length !== lines.length) {
    throw new NfeDraftError(422, 'Revise os dados fiscais dos itens deste pedido.');
  }
  const document = parseNfeDocument(field(data.recipientDocument, 24, 'CPF ou CNPJ'));
  if (document === null) throw new NfeDraftError(422, 'Informe um CPF ou CNPJ válido para o destinatário.');
  const items = data.items.map((item, index): NfeItemDraft => {
    const row = fiscalRecord(item);
    if (!row) throw new NfeDraftError(422, 'Revise a classificação fiscal do item ' + (index + 1) + '.');
    const { cfop, icmsCode, couponCents, ...product } = row;
    const parsed = parseNfeProductFields(product);
    const operation = field(cfop, 4, 'CFOP');
    const icms = field(icmsCode, 3, 'CST ou CSOSN do ICMS');
    const discount = coupon ? coupon[index] : couponCents;
    if (!parsed || (operation && !/^\d{4}$/.test(operation)) || (icms && !/^\d{2,3}$/.test(icms)) ||
      (discount !== null && (!cents(discount) || discount > lines[index].unitCents * lines[index].quantity))) {
      throw new NfeDraftError(422, 'Revise os códigos fiscais e o desconto do item ' + (index + 1) + '.');
    }
    return { ...parsed, cfop: operation, icmsCode: icms, couponCents: discount as number | null };
  });
  return {
    recipientName: field(data.recipientName, 120, 'Nome ou razão social'),
    recipientDocument: document,
    stateRegistration: field(data.stateRegistration, 20, 'Inscrição estadual'),
    address: parseAddress(data.address),
    operation: field(data.operation, 60, 'Natureza da operação'),
    items,
  };
}

function reviewIssues(draft: NfeDraft, lines: NfeReview['lines'], expectedDiscount: number): string[] {
  const issues: string[] = [];
  if (!draft.recipientName || !draft.recipientDocument) issues.push('Confirme o nome e o documento do destinatário.');
  const { cep, rua, numero, bairro, cidade, estado, cityCode } = draft.address;
  if (!cep || !rua || !numero || !bairro || !cidade || !estado || !cityCode) issues.push('Complete o endereço fiscal e o código IBGE do município.');
  if (!draft.operation) issues.push('Informe a natureza da operação.');
  if (draft.items.some(item => !item.ncm || !item.cfop || !item.unit || !item.origin || !item.icmsCode)) issues.push('Complete a classificação fiscal dos itens com a contabilidade.');
  if (draft.items.some(item => item.couponCents === null) ||
    draft.items.reduce((sum, item) => sum + (item.couponCents ?? 0), 0) !== expectedDiscount) issues.push('A soma dos descontos por item deve fechar com o desconto dos produtos no pedido.');
  if (lines.some(line => line.bundle)) issues.push('Confirme com a contabilidade como discriminar os componentes dos pacotes.');
  return issues;
}

export async function orderNfeDraft(db: Firestore, orderId: string, actor: string, change?: unknown): Promise<NfeReview> {
  if (!/^GB-[A-Z0-9]{8,64}$/.test(orderId)) throw new NfeDraftError(422, 'Pedido inválido.');
  const orderRef = db.collection('orders').doc(orderId);
  const fiscal = orderRef.collection('fiscal');
  const draftRef = fiscal.doc('draft');
  return db.runTransaction(async tx => {
    const [orderSnapshot, checkoutSnapshot, draftSnapshot] = await Promise.all([
      tx.get(orderRef), tx.get(fiscal.doc('checkout')), tx.get(draftRef),
    ]);
    const order = orderSnapshot.data() as Order | undefined;
    if (!order) throw new NfeDraftError(404, 'Pedido não encontrado.');
    const { lines, totals } = paymentTotals(order);
    const checkout = checkoutSnapshot.data();
    const saved = draftSnapshot.data() as { revision: string; data: NfeDraft } | undefined;
    let revision = saved?.revision ?? null;
    const paid = order.paymentStatus ? order.paymentStatus === 'pago' : order.status === 'Pago';
    const editable = paid && order.fulfillmentStatus !== 'cancelado' && !Number(order.pagbankRefundedAmountCents);
    const amounts: unknown = checkout?.couponByItem;
    const coupon = totals.itemCouponCents === 0 ? lines.map(() => 0)
      : Array.isArray(amounts) && amounts.length === lines.length &&
        amounts.every((amount, index) => cents(amount) && amount <= lines[index].unitCents * lines[index].quantity) &&
        amounts.reduce((sum, amount) => sum + amount, 0) === totals.itemCouponCents ? amounts as number[] : null;
    let draft: NfeDraft;
    if (change !== undefined) {
      const request = fiscalRecord(change);
      if (!request) throw new NfeDraftError(422, 'Rascunho fiscal inválido.');
      if (!editable) throw new NfeDraftError(409, 'Somente pedidos pagos, sem cancelamento ou estorno, aceitam alterações no rascunho fiscal.');
      if (request.revision !== revision) throw new NfeDraftError(409, 'Outro operador salvou este rascunho. Reabra a NF-e para revisar a versão mais recente.');
      draft = draftFromInput(request.draft, lines, coupon);
      revision = randomUUID();
      tx.set(draftRef, { revision, data: draft, updatedAt: new Date().toISOString(), updatedBy: actor });
    } else if (saved) draft = saved.data;
    else {
      const atPurchase = order.itens.map((_, index) => {
        const fields = parseNfeProductFields(checkout?.products?.[index]);
        return fields && Object.keys(fields).length ? fields : null;
      });
      const catalogIds = order.itens.flatMap((item, index) =>
        !atPurchase[index] && /^[A-Za-z0-9_-]{1,100}$/.test(item.productId) ? [item.productId] : []);
      const products = new Map(await Promise.all([...new Set(catalogIds)]
        .map(async id => [id, (await tx.get(db.collection('anuncios').doc(id))).data()] as const)));
      draft = {
        recipientName: order.clienteNome || '',
        recipientDocument: typeof checkout?.payerCpf === 'string' ? checkout.payerCpf : '',
        stateRegistration: '', operation: '', address: initialAddress(order.enderecoEntrega),
        items: order.itens.map((item, index) => {
          const fields = atPurchase[index] ?? parseNfeProductFields(products.get(item.productId)?.fiscal);
          return { ...fields, couponCents: coupon?.[index] ?? null };
        }),
      };
    }
    const paymentEnvironment = checkout?.paymentEnvironment;
    return {
      environment: nfeEnvironment(), revision, editable,
      paymentEnvironment: paymentEnvironment === 'production' || paymentEnvironment === 'sandbox' ? paymentEnvironment : null,
      draft, lines, totals, couponFromCheckout: coupon !== null, issues: reviewIssues(draft, lines, totals.itemCouponCents),
    };
  });
}
