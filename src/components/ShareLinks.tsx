import { MessageCircle, Instagram, Copy } from 'lucide-react';
import { publicPageUrl } from '../lib/catalog';
export default function ShareLinks({
  name,
  productId,
  notify,
}: {
  name: string;
  productId?: string;
  notify?: (message: string, error?: boolean) => void;
}) {
  const url = () => publicPageUrl(window.location, productId);
  const copy = async (instagram = false) => {
    try {
      await navigator.clipboard.writeText(url());
      notify?.(instagram ? 'Link copiado. Cole-o no Instagram para compartilhar.' : 'Link copiado.');
    } catch {
      notify?.('Não foi possível copiar o link neste navegador.', true);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-bold text-gray-500">Compartilhar</span>
      <a
        href={`https://wa.me/?text=${encodeURIComponent(`${name} · ${typeof window !== 'undefined' ? url() : ''}`)}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Compartilhar ${name} no WhatsApp`}
        className="rounded-lg p-2 text-green-600"
      >
        <MessageCircle size={17} />
      </a>
      <button
        type="button"
        onClick={() => void copy(true)}
        aria-label={`Copiar link de ${name} para Instagram`}
        title="Copiar link para Instagram"
        className="rounded-lg p-2 text-pink-500"
      >
        <Instagram size={17} />
      </button>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copiar link de ${name}`}
        className="rounded-lg p-2 text-gray-500"
      >
        <Copy size={17} />
      </button>
    </div>
  );
}
