import { Link } from 'react-router-dom';
import type { Anuncio, Promocao, CartItem } from '../types';
import type { ProductRating } from '../lib/catalog';
import { displayPrice } from '../lib/catalog';
import { formatMoney, createCartItemId } from '../lib/commerce';
import { DEFAULT_LOGO_URL } from '../lib/seo';
import ShareLinks from './ShareLinks';
export default function CatalogProductCard({
  product,
  products,
  promotions,
  rating,
  onAdd,
  notify,
}: {
  key?: string;
  product: Anuncio;
  products: Anuncio[];
  promotions: Promocao[];
  rating?: ProductRating;
  onAdd: (item: CartItem) => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const price = displayPrice(product, products, promotions, Date.now()),
    configurable =
      !!product.pacote || product.atributos.length > 0 || !!product.moldePdf || !!product.imagemBase ||
      (product.tipoInput && product.tipoInput !== 'nenhum');
  return (
    <article
      id={`produto-${product.id}`}
      className="catalog-product-card flex h-full min-w-0 flex-col overflow-hidden rounded-3xl border border-pink-100 bg-white/90 shadow-sm transition-shadow hover:shadow-lg"
    >
      <Link to={`/produto/${encodeURIComponent(product.id)}`} className="block aspect-[4/3] overflow-hidden bg-gray-50">
        <img
          src={product.imagem || DEFAULT_LOGO_URL}
          alt={product.nome}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain p-3"
        />
      </Link>
      <div className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
        <div className="flex min-h-12 items-start justify-between gap-3">
          <h3 className="line-clamp-2 min-w-0 text-xl font-black text-gray-900">
            <Link to={`/produto/${encodeURIComponent(product.id)}`}>{product.nome}</Link>
          </h3>
          {product.lancamento && (
            <span className="rounded-full bg-pink-50 px-2 py-1 text-[10px] font-bold text-pink-600">Novo</span>
          )}
          {product.pacote && (
            <span className="rounded-full bg-purple-50 px-2 py-1 text-[10px] font-bold text-purple-600">Pacote</span>
          )}
        </div>
        <p className="line-clamp-2 min-h-10 text-sm text-gray-500">{product.desc}</p>
        <p className="min-h-5 text-xs text-gray-500">
          {rating?.count ? `★ ${rating.average.toFixed(1)} · ${rating.count} avaliações` : 'Ainda sem avaliações'}
        </p>
        <p className="min-h-5 text-xs font-medium text-gray-500">
          {product.pacote
            ? `${product.pacote.components.length} produtos · composição definida pela loja`
            : product.atributos.length
              ? 'Escolha as opções na página do produto'
              : configurable
                ? 'Personalize na página do produto'
                : 'Pronto para adicionar ao carrinho'}
        </p>
        <div className="mt-auto border-t border-gray-100 pt-4">
          <p className="mb-3 text-2xl font-black text-gray-900">
            {configurable && <span className="mr-2 text-xs font-medium text-gray-500">A partir de</span>}
            {price === null ? 'Indisponível' : formatMoney(price / 100)}
          </p>
          <ShareLinks productId={product.id} name={product.nome} notify={notify} />
          {configurable ? (
            <Link
              to={`/produto/${encodeURIComponent(product.id)}`}
              className="mt-3 block rounded-xl bg-gray-900 px-4 py-4 text-center text-xs font-black uppercase tracking-wide text-white"
            >
              Ver e configurar produto
            </Link>
          ) : (
            <button
              type="button"
              disabled={price === null}
              onClick={() => {
                if (price !== null)
                  onAdd({
                    id: createCartItemId(product.id, {}),
                    productId: product.id,
                    nome: product.nome,
                    imagem: product.imagem,
                    quantidade: 1,
                    preco: (price / 100).toFixed(2),
                    selecoes: {},
                  });
              }}
              className="mt-3 w-full rounded-xl bg-gray-900 px-4 py-4 text-xs font-black uppercase tracking-wide text-white disabled:opacity-40"
            >
              Adicionar ao Carrinho
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
