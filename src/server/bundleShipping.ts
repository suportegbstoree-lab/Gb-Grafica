import type { Anuncio, CartItem } from '../types.js';
import { validateBundleItems } from '../lib/bundles.js';
import { OperationsError } from '../lib/operations.js';
export async function expandBundleShipping(input: unknown, product: (id: string) => Promise<any>) {
  if (!Array.isArray(input) || input.length > 50) throw new OperationsError('Carrinho inválido.', 422);
  const result: any[] = [];
  for (const raw of input) {
    if (!raw || typeof raw.productId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(raw.productId))
      throw new OperationsError('Produto inválido.', 422);
    const p = await product(raw.productId);
    if (p?.pacote) {
      let children: CartItem[];
      try {
        children = validateBundleItems({ ...p, id: raw.productId } as Anuncio, raw.bundleItems, raw.quantidade);
      } catch (error) {
        throw new OperationsError((error as Error).message, 422);
      }
      for (const child of children) {
        if ((await product(child.productId))?.pacote)
          throw new OperationsError('Pacotes não podem conter outros pacotes.', 422);
        result.push({
          productId: child.productId,
          quantidade: child.quantidade * raw.quantidade,
          selecoes: child.selecoes,
        });
      }
    } else {
      if (raw.bundleItems) throw new OperationsError('Pacote indisponível.', 422);
      result.push(raw);
    }
  }
  if (result.length > 50) throw new OperationsError('O carrinho excede 50 componentes.', 422);
  return result;
}
