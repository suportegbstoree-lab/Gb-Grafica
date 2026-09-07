import React from 'react';
import { Loader2, X } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy = false,
  danger = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLButtonElement>('[data-autofocus="true"]')?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!dialogRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) onCancel();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )) as HTMLElement[];
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown, true);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancelar confirmação"
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        disabled={busy}
        onClick={onCancel}
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="admin-confirm-title"
        aria-describedby="admin-confirm-message"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-2xl border border-gray-800 bg-[#111111] p-6 text-white shadow-2xl sm:p-8"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="admin-confirm-title" className="text-lg font-bold">{title}</h2>
          <button type="button" disabled={busy} onClick={onCancel} aria-label="Fechar confirmação" className="text-gray-500 hover:text-white disabled:opacity-50">
            <X size={20} />
          </button>
        </div>
        <p id="admin-confirm-message" className="text-sm leading-relaxed text-gray-400">{message}</p>
        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            data-autofocus="true"
            disabled={busy}
            onClick={onCancel}
            className="rounded-full px-6 py-3 text-sm font-bold text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-[#ff4d79] hover:bg-[#e6004c]'} flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white disabled:opacity-50`}
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy ? 'Aguarde...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
