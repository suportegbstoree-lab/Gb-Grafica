import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { parseMoneyToCents } from '../lib/commerce.js';
import { canReviewNfeOrder, fiscalRecord, fiscalText, isFiscalState, missingNfeIssuerFields, missingNfeProductFields, nfeDraftIssues, NFE_ORDER_ID, parseNfeAddress, parseNfeProductFields, parseNfeRecipient, type NfeAddress, type NfeDraft, type NfeItemDraft, type NfeOrderSummary, type NfeRecipient, type NfeReview } from '../lib/nfe.js';
import type { Order } from '../types.js';
import { NfeDraftError } from './nfeDraftError.js';
import { nfeDefaultsRef, readNfeSettings } from './nfeDefaults.js';
export { NfeDraftError } from './nfeDraftError.js';

function nfeEnvironment(): NfeReview['environment'] {
  const value = process.env.NFE_ENV?.trim() || 'disabled';
  return value === 'disabled' || value === 'homologacao' || value === 'simulacao' ? value : 'invalid';
}

export function nfeCheckoutSnapshot(
  items: Order['itens'], payerCpf: string,
  paymentEnvironment: 'production' | 'sandbox',
  couponByItem: number[],
  catalog: ReadonlyMap<string, Record<string, unknown>>,
  recipient?: NfeRecipient,
) {
  return {
    payerCpf, paymentEnvironment,
    ...(recipient ? { recipient } : {}),
    couponByItem: items.map((_, index) => couponByItem[index] ?? 0),
    products: items.map(item => parseNfeProductFields(catalog.get(item.productId)?.fiscal) ?? {}),
  };
}

function field(value: unknown, length: number, label: string): string {
  const checked = fiscalText(value, length);
  if (checked === null) throw new NfeDraftError(422, 'Revise o campo ' + label + '.');
  return checked;
}

function parseAddress(input: unknown): NfeAddress {
  const address = parseNfeAddress(input);
  if (!address) throw new NfeDraftError(422, 'Confira o endereço fiscal. O CEP deve ter oito dígitos e o código IBGE deve corresponder à UF.');
  return address;
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
  const recipient = parseNfeRecipient(data);
  if (!recipient) throw new NfeDraftError(422, 'Revise o nome, o CPF ou CNPJ e a inscrição estadual do destinatário.');
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
    ...recipient,
    address: parseAddress(data.address),
    operation: field(data.operation, 60, 'Natureza da operação'),
    items,
  };
}

export async function orderNfeDraft(db: Firestore, orderId: string, actor: string, change?: unknown): Promise<NfeReview> {
  if (!NFE_ORDER_ID.test(orderId)) throw new NfeDraftError(422, 'Pedido inválido.');
  const orderRef = db.collection('orders').doc(orderId);
  const fiscal = orderRef.collection('fiscal');
  const draftRef = fiscal.doc('draft');
  return db.runTransaction(async tx => {
    const [orderSnapshot, checkoutSnapshot, draftSnapshot, settingsSnapshot] = await Promise.all([
      tx.get(orderRef), tx.get(fiscal.doc('checkout')), tx.get(draftRef), tx.get(nfeDefaultsRef(db)),
    ]);
    const order = orderSnapshot.data() as Order | undefined;
    if (!order) throw new NfeDraftError(404, 'Pedido não encontrado.');
    const { lines, totals } = paymentTotals(order);
    const checkout = checkoutSnapshot.data();
    const { defaults, issuer, issuerRevision } = readNfeSettings(settingsSnapshot.data());
    const issuerMissing = missingNfeIssuerFields(issuer);
    const saved = draftSnapshot.data() as { revision: string; data: NfeDraft; reviewedAt?: string; reviewedIssuerRevision?: string } | undefined;
    let revision = saved?.revision ?? null;
    let reviewedAt = issuerRevision !== null && saved?.reviewedIssuerRevision === issuerRevision ? saved.reviewedAt : undefined;
    const editable = canReviewNfeOrder(order);
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
      if (request.confirm === true) {
        const issue = nfeDraftIssues(draft, lines, totals.itemCouponCents, issuerMissing)[0];
        if (issue) throw new NfeDraftError(422, issue);
      }
      revision = randomUUID();
      const updatedAt = new Date().toISOString();
      reviewedAt = request.confirm === true ? updatedAt : undefined;
      tx.set(draftRef, { revision, data: draft, updatedAt, updatedBy: actor, ...(reviewedAt ? { reviewedAt, reviewedIssuerRevision: issuerRevision } : {}) });
    } else if (saved) draft = saved.data;
    else {
      const atPurchase = order.itens.map((_, index) => parseNfeProductFields(checkout?.products?.[index]) ?? {});
      const catalogIds = order.itens.flatMap((item, index) =>
        missingNfeProductFields(atPurchase[index]).length && /^[A-Za-z0-9_-]{1,100}$/.test(item.productId) ? [item.productId] : []);
      const products = new Map(await Promise.all([...new Set(catalogIds)]
        .map(async id => [id, (await tx.get(db.collection('anuncios').doc(id))).data()] as const)));
      const address = initialAddress(order.enderecoEntrega);
      const recipient = parseNfeRecipient(checkout?.recipient);
      const recipientDocument = recipient?.recipientDocument || (typeof checkout?.payerCpf === 'string' ? checkout.payerCpf : '');
      const saleRule = defaults.issuerState && order.metodoEntrega === 'entrega' && isFiscalState(address.estado)
        && recipientDocument.length === 11 && !recipient?.stateRegistration
        ? (address.estado === defaults.issuerState ? defaults.intrastate : defaults.interstate)
        : undefined;
      draft = {
        recipientName: recipient?.recipientName || order.clienteNome || '',
        recipientDocument,
        stateRegistration: recipient?.stateRegistration ?? '', operation: defaults.operation, address,
        items: order.itens.map((item, index) => {
          const fields = parseNfeProductFields(products.get(item.productId)?.fiscal);
          return { ...fields, ...atPurchase[index], ...(!lines[index].bundle ? saleRule : undefined), couponCents: coupon?.[index] ?? null };
        }),
      };
    }
    const paymentEnvironment = checkout?.paymentEnvironment;
    const issues = nfeDraftIssues(draft, lines, totals.itemCouponCents, issuerMissing);
    return {
      environment: nfeEnvironment(), revision, editable, ...(reviewedAt && editable && !issues.length ? { reviewedAt } : {}),
      paymentEnvironment: paymentEnvironment === 'production' || paymentEnvironment === 'sandbox' ? paymentEnvironment : null,
      draft, lines, totals, couponFromCheckout: coupon !== null, issues, issuerMissing,
    };
  }, change === undefined ? { readOnly: true } : undefined);
}

export async function nfeOrderSummaries(db: Firestore, ids: string[], actor: string): Promise<Record<string, NfeOrderSummary>> {
  const summaries = await Promise.all([...new Set(ids)].map(async id => {
    let summary: NfeOrderSummary;
    try {
      const review = await orderNfeDraft(db, id, actor);
      summary = review.editable ? {
        status: review.issues.length ? 'pending' : review.reviewedAt ? 'reviewed' : 'ready',
        issues: review.issues.slice(0, 4),
        issueCount: review.issues.length,
      } : { status: 'unavailable', issues: ['Pedido indisponível para conferência fiscal.'], issueCount: 1 };
    } catch (error) {
      if (!(error instanceof NfeDraftError)) throw error;
      summary = { status: 'unavailable', issues: [error.message], issueCount: 1 };
    }
    return [id, summary] as const;
  }));
  return Object.fromEntries(summaries);
}
