import { ArrowLeft, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePageMetadata } from '../lib/seo';

export default function NotFound() {
  usePageMetadata({
    title: 'Página não encontrada | GB Gráfica',
    description: 'A página solicitada não foi encontrada na loja da GB Gráfica.',
    path: window.location.pathname,
    noIndex: true,
  });

  return (
    <main className="min-h-screen bg-[#fcfcfd] px-4 flex items-center justify-center text-gray-900">
      <section className="w-full max-w-xl rounded-[2.5rem] border border-pink-100 bg-white p-10 text-center shadow-sm">
        <Search className="mx-auto text-pink-400" size={38} aria-hidden="true" />
        <p className="mt-5 text-[10px] font-black uppercase tracking-[0.3em] text-pink-500">Erro 404</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight">Página não encontrada</h1>
        <p className="mt-4 text-sm leading-relaxed text-gray-500">
          O endereço pode ter mudado ou não existir. Volte para a loja para continuar navegando.
        </p>
        <Link
          to="/"
          className="mt-7 inline-flex items-center gap-2 rounded-full bg-gray-900 px-7 py-4 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-pink-500"
        >
          <ArrowLeft size={16} aria-hidden="true" /> Voltar à loja
        </Link>
      </section>
    </main>
  );
}
