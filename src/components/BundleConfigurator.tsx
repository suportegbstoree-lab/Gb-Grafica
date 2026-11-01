import React from 'react';
import type { Anuncio, CartItem } from '../types';
import { parseBundle, selectedPrice, discountBundle, validateBundleItems } from '../lib/bundles';
import { formatMoney } from '../lib/commerce';
import ShareLinks from './ShareLinks';
export interface BundleRenderProps {
  product: Anuncio;
  initialSelections: Record<string, string>;
  lockSelections: boolean;
  confirmLabel: string;
  onDraftChange: () => void;
  onConfirm: (item: CartItem) => void;
}
export default function BundleConfigurator({
  product,
  products,
  renderProduct,
  onAdd,
  notify,
}: {
  key?: string;
  product: Anuncio;
  products: Anuncio[];
  renderProduct: (props: BundleRenderProps) => React.ReactNode;
  onAdd: (item: CartItem) => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const bundle = parseBundle(product.pacote);
  const [confirmed, setConfirmed] = React.useState<Record<string, CartItem>>({});
  const [quantities, setQuantities] = React.useState<Record<string, number>>({});
  const [draftVersion, setDraftVersion] = React.useState(0);
  const [quantity, setQuantity] = React.useState(1);
  if (!bundle) return <p role="alert">Este pacote está indisponível.</p>;
  const children = bundle.components.map((c) =>
    confirmed[c.productId]
      ? { ...confirmed[c.productId], quantidade: c.allowQuantity ? quantities[c.productId] || c.quantity : c.quantity }
      : null,
  );
  let total: number | null = null;
  try {
    if (children.every(Boolean)) {
      validateBundleItems(product, children, quantity);
      total = discountBundle(
        children.reduce((sum, c) => {
          const child = products.find((p) => p.id === c!.productId && !p.pacote);
          const amount = child ? selectedPrice(child, c!.selecoes) : null;
          if (amount === null || amount <= 0) throw new Error('Componente indisponível');
          return sum + amount * c!.quantidade;
        }, 0),
        bundle,
      );
    }
  } catch {
    total = null;
  }
  return (
    <section className="space-y-8">
      <header className="rounded-3xl border border-pink-100 bg-white p-6">
        <h1 className="text-3xl font-black text-gray-900">{product.nome}</h1>
        <p className="mt-3 text-gray-500">{product.desc}</p>
        <p className="mt-3 text-sm">A composição é definida pela loja. Configure e confirme cada componente abaixo.</p>
        <ShareLinks productId={product.id} name={product.nome} notify={notify} />
      </header>
      {bundle.components.map((component, index) => {
        const child = products.find((p) => p.id === component.productId && !p.pacote);
        return (
          <section key={component.productId} className="space-y-4">
            <h2 className="text-xl font-bold text-gray-900">
              {index + 1}. {child?.nome || 'Produto indisponível'} ·{' '}
              {confirmed[component.productId] ? 'Confirmado' : 'Configure este componente'}
            </h2>
            {component.allowQuantity ? (
              <label className="flex items-center gap-3 text-sm">
                Quantidade de {child?.nome}
                <input
                  aria-label={`Quantidade de ${child?.nome}`}
                  type="number"
                  min="1"
                  max="20"
                  value={quantities[component.productId] || component.quantity}
                  onChange={(e) =>
                    setQuantities({
                      ...quantities,
                      [component.productId]: Math.max(1, Math.min(20, Number(e.target.value) || 1)),
                    })
                  }
                  className="w-24 rounded-lg border bg-white p-2"
                />
              </label>
            ) : (
              <p className="text-sm text-gray-500">
                {component.quantity} unidade(s) por pacote ·{' '}
                {component.configurable ? 'Opções à sua escolha' : 'Opções fixadas pela loja'}
              </p>
            )}
            {child && (
              <div key={draftVersion}>
                {renderProduct({
                  product: child,
                  initialSelections: component.configurable ? {} : component.selections,
                  lockSelections: !component.configurable,
                  confirmLabel: 'Confirmar componente',
                  onDraftChange: () =>
                    setConfirmed((current) => {
                      if (!current[child.id]) return current;
                      const next = { ...current };
                      delete next[child.id];
                      return next;
                    }),
                  onConfirm: (item) => {
                    setConfirmed((current) => ({
                      ...current,
                      [child.id]: { ...item, preco: (selectedPrice(child, item.selecoes)! / 100).toFixed(2) },
                    }));
                    notify('Componente confirmado.');
                  },
                })}
              </div>
            )}
          </section>
        );
      })}
      <section className="space-y-4 rounded-3xl border border-pink-100 bg-white p-6">
        {bundle.allowQuantity ? (
          <label className="flex items-center gap-3 text-sm">
            Quantidade de pacotes
            <input
              aria-label="Quantidade de pacotes"
              type="number"
              min="1"
              max="20"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="w-24 rounded-lg border p-2"
            />
          </label>
        ) : (
          <p className="text-sm">Quantidade do pacote fixada pela loja: 1</p>
        )}
        {bundle.discountType !== 'none' && (
          <p className="text-sm text-pink-600">
            Desconto do pacote:{' '}
            {bundle.discountType === 'percent' ? `${bundle.discountValue}%` : formatMoney(bundle.discountValue / 100)}
          </p>
        )}
        <p className="text-2xl font-black text-gray-900">
          {total === null ? 'Confirme todos os componentes' : `Total: ${formatMoney((total * quantity) / 100)}`}
        </p>
        <button
          disabled={total === null}
          onClick={() => {
            if (total === null) return;
            onAdd({
              id: `bundle-${crypto.randomUUID()}`,
              productId: product.id,
              nome: product.nome,
              imagem: product.imagem,
              preco: (total / 100).toFixed(2),
              quantidade: quantity,
              selecoes: {},
              bundleRevision: bundle.revision,
              bundleQuantityAllowed: bundle.allowQuantity,
              bundleItems: children as CartItem[],
            });
            setConfirmed({});
            setDraftVersion((version) => version + 1);
          }}
          className="w-full rounded-xl bg-gray-900 px-5 py-4 font-bold text-white disabled:opacity-40"
        >
          Adicionar pacote ao carrinho
        </button>
        <p className="text-xs text-gray-500">
          As artes serão conferidas e aprovadas no carrinho. O total e as opções serão conferidos antes do pagamento.
        </p>
      </section>
    </section>
  );
}
