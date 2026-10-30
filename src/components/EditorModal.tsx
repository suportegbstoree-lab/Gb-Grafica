import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function EditorModal({ title, children, onClose, busy = false, footerText = 'Conclua a edição e salve as configurações para publicar as fontes.', closeLabel = 'Fechar editor de fontes', doneLabel = 'Concluir edição de fontes' }: { title: string; children: React.ReactNode; onClose: () => void; busy?: boolean; footerText?: string; closeLabel?: string; doneLabel?: string }) {
  const dialog = React.useRef<HTMLElement>(null); const titleId = React.useId();
  const close = React.useRef(onClose); close.current = onClose;
  const blocked = React.useRef(busy); blocked.current = busy;
  React.useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!blocked.current) close.current(); }
      if (event.key !== 'Tab') return;
      const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || [])].filter(item => item.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
    <button type="button" tabIndex={-1} aria-label={`Fechar ${title}`} disabled={busy} onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-800 bg-[#111111] text-white shadow-2xl">
      <header className="flex items-center justify-between gap-3 border-b border-gray-800 px-6 py-4"><h2 id={titleId} className="text-lg font-bold">{title}</h2><button type="button" aria-label={closeLabel} onClick={onClose} disabled={busy} className="rounded-lg p-2 hover:bg-gray-800 disabled:opacity-40"><X size={20} /></button></header>
      <div className="min-h-0 overflow-y-auto p-5 sm:p-6">{children}</div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-800 px-6 py-4"><p className="max-w-md text-xs text-gray-400">{footerText}</p><button type="button" disabled={busy} onClick={onClose} className="rounded-xl bg-purple-500 px-6 py-3 text-xs font-bold hover:bg-purple-600 disabled:opacity-40">{doneLabel}</button></footer>
    </section>
  </div>, document.body);
}
