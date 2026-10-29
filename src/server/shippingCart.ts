import { isRecord, parseShippingProfile, parcelsForProfile, type ShippingParcel } from '../lib/shipping.js';
import { CorreiosError } from './correios.js';

const invalidCart = () => new CorreiosError(422, 'SHIPPING_INVALID_CART', 'Revise os produtos, opções e quantidades do carrinho.');

export async function shippingParcelsForCart(
  input: unknown,
  loadProduct: (id: string) => Promise<Record<string, unknown> | undefined>,
): Promise<ShippingParcel[]> {
  if (!Array.isArray(input) || input.length < 1 || input.length > 50) throw invalidCart();
  const ids = input.map(item => {
    if (!isRecord(item) || typeof item.productId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(item.productId)) throw invalidCart();
    return item.productId;
  });
  const products = new Map(await Promise.all([...new Set(ids)].map(async id => [id, await loadProduct(id)] as const)));
  const groups = new Map<string, { product: Record<string, unknown>; combination: string; quantity: number }>();
  for (const item of input) {
    if (!isRecord(item) || typeof item.productId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(item.productId)
      || !Number.isSafeInteger(item.quantidade) || Number(item.quantidade) < 1 || Number(item.quantidade) > 999
      || !isRecord(item.selecoes)) throw invalidCart();
    const product = products.get(item.productId);
    if (!product) throw invalidCart();
    const attributes = product.atributos === undefined ? [] : product.atributos;
    if (!Array.isArray(attributes) || attributes.length > 8) throw invalidCart();
    const values: string[] = [];
    const names = new Set<string>();
    for (const attribute of attributes) {
      if (!isRecord(attribute) || typeof attribute.nome !== 'string' || names.has(attribute.nome)
        || !Array.isArray(attribute.opcoes)) throw invalidCart();
      names.add(attribute.nome);
      const value = item.selecoes[attribute.nome];
      if (typeof value !== 'string' || !attribute.opcoes.includes(value)) throw invalidCart();
      values.push(value);
    }
    if (Object.keys(item.selecoes).some(name => !names.has(name))) throw invalidCart();
    const combination = values.join('|');
    if (attributes.length && (!isRecord(product.combinacoes) || !Object.hasOwn(product.combinacoes, combination))) throw invalidCart();
    const key = JSON.stringify([item.productId, combination]);
    const group = groups.get(key);
    if (group) group.quantity += Number(item.quantidade);
    else groups.set(key, { product, combination, quantity: Number(item.quantidade) });
  }
  const parcels: ShippingParcel[] = [];
  for (const { product, combination, quantity } of groups.values()) {
    const variants = isRecord(product.shippingByCombination) ? product.shippingByCombination : {};
    const profile = parseShippingProfile(Object.hasOwn(variants, combination) ? variants[combination] : product.shipping);
    if (!profile) throw new CorreiosError(422, 'SHIPPING_PRODUCT_NOT_CONFIGURED', 'Um produto ainda está sem peso ou embalagem cadastrados. Entre em contato com a loja ou escolha retirada.');
    const count = Math.ceil(quantity / profile.unitsPerParcel);
    if (parcels.length + count > 20) throw new CorreiosError(422, 'SHIPPING_TOO_MANY_PARCELS', 'Este pedido precisa de mais de 20 volumes. Consulte a loja para combinar o envio.');
    parcels.push(...parcelsForProfile(profile, quantity));
  }
  return parcels;
}
