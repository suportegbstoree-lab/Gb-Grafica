import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Move, X } from 'lucide-react';
import { motion } from 'motion/react';
import { isComposablePersonalizationImage, personalizationTextScale } from '../lib/personalizationModel';
import {
  activePersonalizationFonts,
  DEFAULT_TEXT_CUSTOMIZATION,
  MAX_CUSTOM_TEXT_LENGTH,
  normalizeTextCustomization,
  textFontCssFamily,
  type PersonalizationFont,
  type TextCustomization,
} from '../lib/textCustomization';
import {
  composePersonalizationModel,
  type ComposedPersonalizationModel,
} from '../services/personalizationModelService';

export interface BackCoverDraft { mode: 'none' | 'automatic' | 'custom'; file?: File; }

interface TextCustomizationDrawerProps {
  productName: string;
  previewImage: string;
  previewSource?: Blob;
  fieldLabel: string;
  fonts: PersonalizationFont[];
  initialValue: TextCustomization | null;
  textRequired?: boolean;
  initialBack?: BackCoverDraft;
  onClose: () => void;
  onSave: (value: TextCustomization | null, model: ComposedPersonalizationModel, back: ComposedPersonalizationModel | undefined, backDraft: BackCoverDraft) => void | Promise<void>;
}

function clampPosition(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

export default function TextCustomizationDrawer({
  productName,
  previewImage,
  previewSource,
  fieldLabel,
  fonts,
  initialValue,
  textRequired = true,
  initialBack = { mode: 'none' },
  onClose,
  onSave,
}: TextCustomizationDrawerProps) {
  const availableFonts = React.useMemo(() => activePersonalizationFonts(fonts), [fonts]);
  const [draft, setDraft] = useState<TextCustomization>(() => {
    const initialFont = availableFonts.find(font => font.id === initialValue?.fonte) || availableFonts[0];
    return {
      ...(initialValue ? structuredClone(initialValue) : structuredClone(DEFAULT_TEXT_CUSTOMIZATION)),
      fonte: initialFont?.id || '',
      ...(initialFont ? {
        fonteNome: initialFont.nome,
        fonteCssFamily: initialFont.cssFamily,
        ...(initialFont.arquivoUrl ? { fonteArquivoUrl: initialFont.arquivoUrl } : {}),
      } : {}),
    };
  });
  const [backDraft, setBackDraft] = useState<BackCoverDraft>(initialBack);
  const [backPreview, setBackPreview] = useState('');
  const [error, setError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewAspectRatio, setPreviewAspectRatio] = useState(1);
  const [previewWidth, setPreviewWidth] = useState(480);
  const drawerRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLButtonElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const generatingRef = useRef(isGenerating);
  generatingRef.current = isGenerating;
  const activePointerRef = useRef<number | null>(null);
  const titleId = React.useId();
  const instructionsId = React.useId();

  React.useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (textInputRef.current || drawerRef.current?.querySelector<HTMLElement>('button'))?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!generatingRef.current) closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;

      const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter(element => !element.hasAttribute('hidden'));
      if (focusable.length === 0) return;
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

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  React.useEffect(() => {
    if (!previewRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width && Number.isFinite(width)) setPreviewWidth(width);
    });
    observer.observe(previewRef.current);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!backDraft.file) { setBackPreview(''); return; }
    const url = URL.createObjectURL(backDraft.file);
    setBackPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [backDraft.file]);

  const updatePositionFromPointer = (element: HTMLElement, clientX: number, clientY: number) => {
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    setDraft(current => ({
      ...current,
      posicao: {
        x: clampPosition(((clientX - bounds.left) / bounds.width) * 100),
        y: clampPosition(((clientY - bounds.top) / bounds.height) * 100),
      },
    }));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updatePositionFromPointer(event.currentTarget, event.clientX, event.clientY);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    updatePositionFromPointer(event.currentTarget, event.clientX, event.clientY);
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePreviewKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const directions: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const distance = event.shiftKey ? 5 : 1;
    setDraft(current => ({
      ...current,
      posicao: {
        x: clampPosition(current.posicao.x + direction.x * distance),
        y: clampPosition(current.posicao.y + direction.y * distance),
      },
    }));
  };

  const save = async () => {
    const normalized = textRequired ? normalizeTextCustomization(draft, availableFonts) : null;
    if (textRequired && !normalized) {
      setError(`Informe um texto de até ${MAX_CUSTOM_TEXT_LENGTH} caracteres, uma fonte e uma posição válida.`);
      return;
    }
    if (backDraft.mode === 'custom' && !backDraft.file) {
      setError('Selecione a imagem da contracapa.'); return;
    }
    setIsGenerating(true);
    setError('');
    try {
      const model = await composePersonalizationModel({
        source: previewSource || previewImage,
        customization: normalized,
        fonts: availableFonts,
      });
      const back = backDraft.mode !== 'none' ? await composePersonalizationModel({
        source: backDraft.mode === 'custom' ? backDraft.file! : previewSource || previewImage,
        fonts: [],
      }) : undefined;
      await onSave(normalized, model, back, backDraft);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível gerar o modelo personalizado.');
    } finally {
      setIsGenerating(false);
    }
  };

  const previewFontSize = Math.max(14, Math.round(previewWidth * personalizationTextScale(draft.texto)));

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end">
      <motion.button
        type="button"
        aria-label="Fechar personalização de texto"
        disabled={isGenerating}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
        className="absolute inset-0 bg-gray-950/55 backdrop-blur-sm"
      />
      <motion.aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
        className="relative flex h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-5 sm:px-8">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-pink-500">{productName}</p>
            <h3 id={titleId} className="mt-1 text-xl font-black text-gray-900">{textRequired ? 'Personalizar texto' : 'Personalizar capa e contracapa'}</h3>
          </div>
          <button type="button" onClick={onClose} disabled={isGenerating} aria-label="Fechar personalização" className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-pink-500 disabled:cursor-not-allowed disabled:opacity-40">
            <X size={22} />
          </button>
        </header>

        <fieldset disabled={isGenerating} className="min-h-0 flex-1 space-y-7 overflow-y-auto p-5 sm:p-8">
          {textRequired && <>
          <div className="space-y-2">
            <label htmlFor={`${titleId}-text`} className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">{fieldLabel}</label>
            <input
              ref={textInputRef}
              id={`${titleId}-text`}
              type="text"
              value={draft.texto}
              onChange={event => {
                setError('');
                setDraft(current => ({ ...current, texto: event.target.value }));
              }}
              maxLength={MAX_CUSTOM_TEXT_LENGTH}
              placeholder="Digite o texto que será produzido"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition-colors focus:border-pink-400"
            />
            <div className="text-right text-[9px] font-bold text-gray-400">{draft.texto.length}/{MAX_CUSTOM_TEXT_LENGTH}</div>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Fonte</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {availableFonts.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setDraft(current => ({
                    ...current,
                    fonte: option.id,
                    fonteNome: option.nome,
                    fonteCssFamily: option.cssFamily,
                    fonteArquivoUrl: option.arquivoUrl,
                  }))}
                  aria-pressed={draft.fonte === option.id}
                  className={`rounded-xl border px-3 py-3 text-sm transition-colors ${draft.fonte === option.id ? 'border-pink-400 bg-pink-50 text-pink-700' : 'border-gray-200 bg-white text-gray-600 hover:border-pink-200'}`}
                  style={{ fontFamily: option.cssFamily }}
                >
                  {option.nome}
                </button>
              ))}
            </div>
            {availableFonts.length === 0 && (
              <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
                Nenhuma fonte foi disponibilizada pela loja. A personalização precisa ser configurada no painel administrativo.
              </div>
            )}
          </fieldset>

          <div className="space-y-3">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Posição do texto</div>
                <p id={instructionsId} className="mt-1 text-[10px] leading-relaxed text-gray-400">Clique ou arraste na prévia. Com o teclado, use as setas; Shift move 5%.</p>
              </div>
              <div className="shrink-0 text-[9px] font-black uppercase tracking-wider text-pink-500">Prévia do modelo</div>
            </div>

            <button
              ref={previewRef}
              type="button"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onKeyDown={handlePreviewKeyDown}
              aria-describedby={instructionsId}
              aria-label={`Prévia da posição do texto: ${draft.posicao.x}% horizontal e ${draft.posicao.y}% vertical`}
              style={{ aspectRatio: previewAspectRatio, width: `min(100%, calc(60vh * ${previewAspectRatio}))` }}
              className="relative mx-auto block max-h-[60vh] touch-none overflow-hidden rounded-2xl border-2 border-gray-200 bg-gray-100 text-left outline-none focus:border-pink-400 focus:ring-4 focus:ring-pink-100"
            >
              <img
                src={previewImage}
                alt=""
                draggable={false}
                className="pointer-events-none h-full w-full select-none object-contain"
                referrerPolicy="no-referrer"
                onLoad={event => {
                  const image = event.currentTarget;
                  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                    setPreviewAspectRatio(image.naturalWidth / image.naturalHeight);
                  }
                }}
              />
              <span
                className="pointer-events-none absolute max-w-[90%] -translate-x-1/2 -translate-y-1/2 break-words text-center font-bold leading-[1.18] text-white"
                style={{
                  left: `${draft.posicao.x}%`,
                  top: `${draft.posicao.y}%`,
                  fontFamily: textFontCssFamily(draft.fonte, availableFonts, draft.fonteCssFamily),
                  fontSize: previewFontSize,
                  WebkitTextStroke: `${Math.max(1, previewFontSize * 0.1)}px rgba(0, 0, 0, 0.88)`,
                  paintOrder: 'stroke fill',
                }}
              >
                {draft.texto.trim() || 'Seu texto'}
              </span>
              <span className="pointer-events-none absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-gray-600 shadow">
                <Move size={11} /> Arraste para posicionar
              </span>
            </button>
            <p className="text-[9px] leading-relaxed text-gray-400">Ao aplicar, o site gera e armazena uma imagem privada já composta com a arte, o texto e a fonte escolhida.</p>
          </div>

          </>}
          {!textRequired && <img src={previewImage} alt="Arte da capa" className="max-h-80 w-full rounded-xl object-contain" />}
          <fieldset className="space-y-3 rounded-2xl border border-gray-200 p-4">
            <legend className="px-1 text-sm font-black text-gray-900">Contracapa</legend>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={backDraft.mode !== 'none'} onChange={event => { setError(''); setBackDraft(current => ({ ...current, mode: event.target.checked ? 'automatic' : 'none' })); }} />
              Incluir contracapa
            </label>
            {backDraft.mode !== 'none' && <>
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="radio" name={`${titleId}-back`} checked={backDraft.mode === 'automatic'} onChange={() => setBackDraft(current => ({ ...current, mode: 'automatic' }))} />Automática: mesma arte da capa, sem o texto personalizado</label>
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="radio" name={`${titleId}-back`} checked={backDraft.mode === 'custom'} onChange={() => setBackDraft(current => ({ ...current, mode: 'custom' }))} />Escolher outra imagem</label>
              {backDraft.mode === 'custom' && <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-700">Imagem da contracapa
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="mt-2 block w-full text-xs" onChange={event => {
                    const file = event.target.files?.[0]; event.target.value = '';
                    if (!file) return;
                    if (!isComposablePersonalizationImage(file.type, file.size)) { setError('Envie uma contracapa JPG, PNG ou WebP de até 15 MB.'); return; }
                    setError(''); setBackDraft({ mode: 'custom', file });
                  }} />
                </label>
                {backDraft.file && <p className="break-words text-xs text-gray-500">{backDraft.file.name}</p>}
              </div>}
              {(backDraft.mode === 'automatic' || backPreview) && <img src={backDraft.mode === 'automatic' ? previewImage : backPreview} alt="Prévia da contracapa" className="max-h-64 w-full rounded-xl bg-gray-50 object-contain" />}
            </>}
          </fieldset>
          <p className="text-xs text-gray-500">O modelo usa a resolução original da imagem. Após gerar, confira as faces no visualizador e baixe em JPG ou PDF.</p>
          {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{error}</div>}
        </fieldset>

        <footer className="grid grid-cols-2 gap-3 border-t border-gray-100 bg-gray-50/70 p-5 sm:px-8">
          <button type="button" onClick={onClose} disabled={isGenerating} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-wider text-gray-600 hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-40">Cancelar</button>
          <button type="button" onClick={() => void save()} disabled={(textRequired && availableFonts.length === 0) || isGenerating} className="flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-40">
            <Check size={16} /> {isGenerating ? 'Gerando modelo...' : 'Aplicar e gerar modelo'}
          </button>
        </footer>
      </motion.aside>
    </div>,
    document.body,
  );
}
