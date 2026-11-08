import { productPrice, productMinimum } from './productCustomization.js';
import type { Anuncio, CartItem } from '../types.js';
import { parseMoneyToCents } from './commerce.js';
export interface BundleComponent {
  productId: string;
  quantity: number;
  allowQuantity: boolean;
  configurable: boolean;
  selections: Record<string, string>;
}
export interface BundleDefinition {
  components: BundleComponent[];
  allowQuantity: boolean;
  discountType: 'none' | 'percent' | 'fixed';
  discountValue: number;
  revision?: string;
}
export function parseBundle(value: unknown): BundleDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as any;
  if (
    !Array.isArray(v.components) ||
    !v.components.length ||
    v.components.length > 10 ||
    typeof v.allowQuantity !== 'boolean' ||
    !['none', 'percent', 'fixed'].includes(v.discountType) ||
    !Number.isSafeInteger(v.discountValue) ||
    v.discountValue < 0 ||
    (v.discountType === 'percent' && v.discountValue >= 100) ||
    (v.discountType === 'none' && v.discountValue !== 0)
  )
    return null;
  if (
    v.components.some(
      (c: any) =>
        !c ||
        typeof c.productId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(c.productId) ||
        !Number.isInteger(c.quantity) ||
        c.quantity < 1 ||
        c.quantity > 20 ||
        typeof c.allowQuantity !== 'boolean' ||
        typeof c.configurable !== 'boolean' ||
        !c.selections ||
        typeof c.selections !== 'object' ||
        Array.isArray(c.selections) ||
        Object.values(c.selections).some((s) => typeof s !== 'string'),
    )
  )
    return null;
  if (new Set(v.components.map((c: any) => c.productId)).size !== v.components.length) return null;
  return {
    components: v.components.map((c: any) => ({
      productId: c.productId,
      quantity: c.quantity,
      allowQuantity: c.allowQuantity,
      configurable: c.configurable,
      selections: { ...c.selections },
    })),
    allowQuantity: v.allowQuantity,
    discountType: v.discountType,
    discountValue: v.discountValue,
    ...(typeof v.revision === 'string' ? { revision: v.revision } : {}),
  };
}
export function selectedPrice(product: Anuncio, selections: Record<string, string>) { return productPrice(product,selections); }
export function minimumPrice(product: Anuncio): number | null { return productMinimum(product); }
export function discountBundle(subtotal: number, definition: BundleDefinition) {
  const discount =
    definition.discountType === 'percent'
      ? Math.round((subtotal * definition.discountValue) / 100)
      : definition.discountType === 'fixed'
        ? definition.discountValue
        : 0;
  const total = subtotal - discount;
  if (
    !Number.isSafeInteger(subtotal) ||
    subtotal <= 0 ||
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    total > 100_000_000
  )
    throw new Error('O desconto do pacote deve manter o total maior que zero.');
  return total;
}
export function bundleMinimum(definition: BundleDefinition, products: Anuncio[], selfId?: string) {
  let subtotal = 0;
  for (const c of definition.components) {
    const product = products.find((p) => p.id === c.productId);
    if (!product || product.id === selfId || product.pacote)
      throw new Error('Selecione produtos existentes. Um pacote não pode conter outro pacote.');
    const price = c.configurable ? minimumPrice(product) : selectedPrice(product, c.selections);
    if (price === null || price <= 0)
      throw new Error(`Defina as opções de ${product.nome} ou permita que o cliente as escolha.`);
    subtotal += price * (c.allowQuantity ? 1 : c.quantity);
  }
  return discountBundle(subtotal, definition);
}
export function validateBundleItems(product: Anuncio, items: unknown, quantity: number) {
  const bundle = parseBundle(product.pacote);
  if (
    !bundle ||
    !Array.isArray(items) ||
    items.length !== bundle.components.length ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 20 ||
    (!bundle.allowQuantity && quantity !== 1)
  )
    throw new Error('A composição ou a quantidade do pacote mudou. Configure o pacote novamente.');
  return bundle.components.map((c, index) => {
    const item = items[index] as CartItem;
    if (
      !item ||
      item.productId !== c.productId ||
      item.bundleItems ||
      !Number.isSafeInteger(item.quantidade) ||
      item.quantidade < 1 ||
      item.quantidade > 20 ||
      (!c.allowQuantity && item.quantidade !== c.quantity) ||
      item.quantidade * quantity > 99
    )
      throw new Error('Os componentes e suas quantidades devem respeitar o pacote cadastrado.');
    if (
      !c.configurable &&
      (Object.keys(item.selecoes || {}).length !== Object.keys(c.selections).length ||
        Object.keys(c.selections).some((key) => item.selecoes?.[key] !== c.selections[key]))
    )
      throw new Error('As opções fixas do pacote não podem ser alteradas.');
    return item;
  });
}
export function cartShippingItems(items: CartItem[]): CartItem[] {
  return items.flatMap((item) =>
    item.bundleItems
      ? item.bundleItems.map((child) => ({ ...child, quantidade: child.quantidade * item.quantidade }))
      : [item],
  );
}
export function orderItems(items: CartItem[]): CartItem[] {
  return items.flatMap((item) =>
    item.bundleItems
      ? [
          { ...item, bundleItems: undefined },
          ...item.bundleItems.map((child) => ({
            ...child,
            nome: `${child.nome} · Pacote ${item.nome}`,
            bundleParentName: item.nome,
            quantidade: child.quantidade * item.quantidade,
          })),
        ]
      : [item],
  );
}
