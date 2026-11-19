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
      <Link to={`/produto/${encodeURIComponent(product.id)}`} className="block aspect-square overflow-hidden bg-gray-50 md:aspect-[4/3]">
        <img
          src={product.imagem || DEFAULT_LOGO_URL}
          alt={product.nome}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain p-2.5 md:p-3"
        />
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-2.5 sm:p-4 md:gap-4 md:p-6">
        <div className="flex min-w-0 items-start justify-between gap-1 md:min-h-12 md:gap-3">
          <h3 className="line-clamp-2 min-w-0 text-sm font-bold leading-snug text-gray-900 [overflow-wrap:anywhere] md:text-xl md:font-black">
            <Link to={`/produto/${encodeURIComponent(product.id)}`}>{product.nome}</Link>
          </h3>
          {product.lancamento && (
            <span className="catalog-card-badge rounded-full bg-pink-50 px-2 py-1 text-xs font-bold text-pink-600 md:text-[10px]">Novo</span>
          )}
          {product.pacote && (
            <span className="catalog-card-badge rounded-full bg-purple-50 px-2 py-1 text-xs font-bold text-purple-700 md:text-[10px]">Pacote</span>
          )}
        </div>
        <p className="hidden min-h-10 text-sm text-gray-500 md:line-clamp-2">{product.desc}</p>
        <p className={`text-xs text-gray-600 md:min-h-5 ${rating?.count ? '' : 'hidden md:block'}`}>
          {rating?.count ? `★ ${rating.average.toFixed(1)} · ${rating.count} avaliações` : 'Ainda sem avaliações'}
        </p>
        <p className="hidden min-h-5 text-xs font-medium text-gray-500 md:block">
          {product.pacote
            ? `${product.pacote.components.length} produtos · composição definida pela loja`
            : product.atributos.length
              ? 'Escolha as opções na página do produto'
              : configurable
                ? 'Personalize na página do produto'
                : 'Pronto para adicionar ao carrinho'}
        </p>
        <div className="mt-auto pt-1 md:border-t md:border-gray-100 md:pt-4">
          <p className="mb-2 break-words text-lg font-black leading-tight text-gray-900 md:mb-3 md:text-2xl">
            {configurable && <span className="block text-xs font-medium text-gray-600 md:mr-2 md:inline">A partir de</span>}
            {price === null ? 'Indisponível' : formatMoney(price / 100)}
          </p>
          <div className="hidden md:block"><ShareLinks productId={product.id} name={product.nome} notify={notify} /></div>
          {configurable ? (
            <Link
              to={`/produto/${encodeURIComponent(product.id)}`}
              aria-label="Ver e configurar produto"
              className="store-catalog-action flex min-h-11 items-center justify-center rounded-lg border border-gray-200 px-2 text-center text-sm font-bold text-gray-900 md:mt-3 md:block md:rounded-xl md:border-0 md:bg-gray-900 md:px-4 md:py-4 md:text-xs md:font-black md:uppercase md:tracking-wide md:text-white"
            >
              <span className="hidden md:inline">Ver e configurar produto</span>
              <span className="md:hidden">Ver produto</span>
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
              aria-label="Adicionar ao Carrinho"
              className="store-catalog-action min-h-11 w-full rounded-lg bg-gray-900 px-2 text-sm font-bold text-white disabled:opacity-40 md:mt-3 md:rounded-xl md:px-4 md:py-4 md:text-xs md:font-black md:uppercase md:tracking-wide"
            >
              <span className="hidden md:inline">Adicionar ao Carrinho</span>
              <span className="md:hidden">Adicionar</span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
