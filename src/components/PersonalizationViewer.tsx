import PrintProfileNotice from './PrintProfileNotice';
import React from 'react';
import { createPortal } from 'react-dom';
import { Download, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  downloadPersonalization, exportPersonalizationImage, exportPersonalizationPdf,
  personalizationDownloadName, type PersonalizationDocument, type PersonalizationPage,
} from '../services/personalizationExport';

export default function PersonalizationViewer({ document: model, onClose, allowDownload = false }: {
  document: PersonalizationDocument;
  onClose: () => void;
  allowDownload?: boolean;
}) {
  const [pageIndex, setPageIndex] = React.useState(0);
  const [zoom, setZoom] = React.useState<number | null>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const [exporting, setExporting] = React.useState(false);
  const [error, setError] = React.useState('');
  const dialog = React.useRef<HTMLElement>(null);
  const closeButton = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const [pages, setPages] = React.useState<Array<PersonalizationPage & { url: string }>>([]);
  const page = pages[pageIndex] || pages[0];

  React.useEffect(() => {
    const next = model.pages.map(page => ({ ...page, url: URL.createObjectURL(page.blob) }));
    setPages(next);
    setPageIndex(0);
    return () => next.forEach(page => URL.revokeObjectURL(page.url));
  }, [model]);
  React.useEffect(() => {
    if (!page) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onCloseRef.current(); }
      if (event.key !== 'Tab' || !dialog.current) return;
      event.stopImmediatePropagation();
      const elements = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex="0"]')];
      const first = elements[0]; const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [Boolean(page)]);

  const download = async (format: 'jpg' | 'pdf') => {
    if (!allowDownload || exporting || !page) return;
    setExporting(true); setError('');
    try {
      const blob = format === 'pdf' ? await exportPersonalizationPdf(model) : await exportPersonalizationImage(page.blob, 'image/jpeg');
      downloadPersonalization(blob, personalizationDownloadName(model.title, format === 'pdf' ? 'modelo' : page.label.toLowerCase(), format));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível exportar o modelo.');
    } finally { setExporting(false); }
  };

  if (!page) return null;
  return createPortal(
    <div className="fixed inset-0 z-[150] bg-gray-950/80 p-2 backdrop-blur-sm sm:p-6">
      <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white text-gray-900 shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div className="min-w-0"><h2 id={titleId} className="font-black">Modelo personalizado</h2><p className="truncate text-xs text-gray-500">{model.title}</p></div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Fechar visualização do modelo" className="rounded-lg p-2 hover:bg-gray-100"><X size={22} /></button>
        </header>
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 p-3">
          <div role="group" aria-label="Faces do modelo" className="flex gap-1">
            {pages.map((page, index) => <button key={page.label} type="button" aria-pressed={index === pageIndex} onClick={() => { setPageIndex(index); setZoom(null); setError(''); }} className={`rounded-lg px-3 py-2 text-xs font-bold ${index === pageIndex ? 'bg-pink-500 text-white' : 'bg-gray-100'}`}>{page.label}</button>)}
          </div>
          <div role="group" aria-label="Zoom do modelo" className="flex items-center gap-1">
            <button type="button" aria-label="Diminuir zoom" onClick={() => setZoom(Math.max(0.25, (zoom ?? 1) - 0.25))} className="rounded-lg p-2 hover:bg-gray-100"><ZoomOut size={18} /></button>
            <button type="button" onClick={() => setZoom(null)} className="rounded-lg px-2 py-2 text-xs font-bold hover:bg-gray-100">Ajustar</button>
            <button type="button" onClick={() => setZoom(1)} className="rounded-lg px-2 py-2 text-xs font-bold hover:bg-gray-100">100%</button>
            <button type="button" aria-label="Aumentar zoom" onClick={() => setZoom(Math.min(4, (zoom ?? 1) + 0.25))} className="rounded-lg p-2 hover:bg-gray-100"><ZoomIn size={18} /></button>
          </div>
          <span className="text-xs text-gray-500" aria-live="polite">{size.width > 0 && `${size.width} × ${size.height} px`}{zoom !== null && ` · ${Math.round(zoom * 100)}%`}</span>
          {allowDownload && <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" disabled={exporting} onClick={() => void download('jpg')} className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold disabled:opacity-50"><Download size={14} /> JPG desta face</button>
            <button type="button" disabled={exporting} onClick={() => void download('pdf')} className="flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Download size={14} /> {exporting ? 'Exportando...' : 'Baixar PDF'}</button>
          </div>}
        </div>
        {model.printProfile && <div className="max-h-40 shrink-0 overflow-auto px-3 py-2"><PrintProfileNotice profile={model.printProfile} width={size.width} height={size.height} /></div>}
        {error && <p role="alert" className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <div tabIndex={0} aria-label="Área de visualização do modelo" className="min-h-0 flex-1 overflow-auto bg-gray-100 p-3 sm:p-6">
          <img key={page.url} src={page.url} draggable={allowDownload} onContextMenu={allowDownload ? undefined : event => event.preventDefault()} onDragStart={allowDownload ? undefined : event => event.preventDefault()} alt={`${page.label} do modelo personalizado`} onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setError('Não foi possível exibir esta imagem.')} className={zoom === null ? 'mx-auto h-full max-w-full object-contain' : 'max-w-none'} style={zoom === null ? undefined : { width: size.width * zoom, height: size.height * zoom }} />
        </div>
        {allowDownload && <p className="border-t border-gray-200 px-4 py-2 text-[11px] text-gray-500">JPG exporta a face selecionada. O PDF inclui todas as faces, na ordem capa e contracapa. Quando há formato cadastrado, usa as medidas com sangria e caixa de corte; pedidos antigos mantêm a escala de 300 dpi.</p>}
      </section>
    </div>, globalThis.document.body,
  );
}
