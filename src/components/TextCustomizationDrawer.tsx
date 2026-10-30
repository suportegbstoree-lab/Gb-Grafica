import PrintGuides from './PrintGuides';
import PrintProfileNotice from './PrintProfileNotice';
import { isInsideSafeArea, printImageQuality, type PrintProfile } from '../lib/printProfile';
import TextLineControls from './TextLineControls';
import { distributeTextLines, reconcileTextLines } from '../lib/textLines';
import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Move, Upload, X } from 'lucide-react';
import { motion } from 'motion/react';
import PersonalizationPreview from './PersonalizationPreview';
import { isComposablePersonalizationImage, personalizationTextScale } from '../lib/personalizationModel';
import {
  activePersonalizationFonts,
  DEFAULT_TEXT_CUSTOMIZATION,
  MAX_CUSTOM_TEXT_LENGTH,
  MAX_CUSTOM_TEXT_LINES,
  normalizeTextCustomization,
  type PersonalizationFont,
  type TextCustomization,
} from '../lib/textCustomization';
import {
  composePersonalizationModel,
  personalizationLayerLayout,
  preparePersonalizationFont,
  type PersonalizationTextBox,
  type ComposedPersonalizationModel,
} from '../services/personalizationModelService';

export interface BackCoverDraft { mode: 'none' | 'automatic' | 'custom'; file?: File; }

interface TextCustomizationDrawerProps {
  productName: string;
  printProfile?: PrintProfile;
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
  printProfile,
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
      tamanhoFonte: initialValue?.tamanhoFonte ?? (initialValue ? personalizationTextScale(initialValue.texto) * 100 : 7.2),
      cor: initialValue?.cor || '#ffffff',
      fonte: initialFont?.id || '',
      ...(initialFont ? {
        fonteNome: initialFont.nome,
        fonteCssFamily: initialFont.cssFamily,
        ...(initialFont.arquivoUrl ? { fonteArquivoUrl: initialFont.arquivoUrl } : {}),
      } : {}),
    };
  });
  const [selectedId, setSelectedId] = useState<string | null>(initialValue?.linhas?.[0]?.id || null);
  const [textBoxes, setTextBoxes] = useState<PersonalizationTextBox[]>([]);
  const dimensionsRef = useRef({ width: 1000, height: 1000 });
  const initializedRef = useRef(false);
  const positionTouchedRef = useRef(false);
  const [isArranging, setIsArranging] = useState(false);
  const [backDraft, setBackDraft] = useState<BackCoverDraft>(initialBack);
  const [backPreview, setBackPreview] = useState('');
  const [error, setError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [showPrintGuides, setShowPrintGuides] = useState(true);
  const [previewAspectRatio, setPreviewAspectRatio] = useState(1);
  const [previewFace, setPreviewFace] = useState<'front' | 'back'>('front');
  const drawerRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const generatingRef = useRef(isGenerating);
  generatingRef.current = isGenerating || isArranging;
  const activePointerRef = useRef<{ id: number; lineId: string; offsetX: number; offsetY: number } | null>(null);
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
    if (!backDraft.file) { setBackPreview(''); return; }
    const url = URL.createObjectURL(backDraft.file);
    setBackPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [backDraft.file]);

  const activeLine = draft.linhas?.find(line => line.id === selectedId) || draft.linhas?.[0];
  const changePosition = (lineId: string, posicao: { x: number; y: number }) => {
    positionTouchedRef.current = true;
    setDraft(current => ({ ...current, posicao, linhas: current.linhas?.map(line => line.id === lineId ? { ...line, posicao } : line) }));
  };
  const pointerPosition = (clientX: number, clientY: number) => {
    const bounds = previewRef.current?.getBoundingClientRect();
    return bounds && bounds.width > 0 && bounds.height > 0 ? { x: (clientX - bounds.left) / bounds.width * 100, y: (clientY - bounds.top) / bounds.height * 100 } : null;
  };
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isGenerating || isArranging) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-line-id]');
    const line = draft.linhas?.find(line => line.id === target?.dataset.lineId) || activeLine;
    const point = pointerPosition(event.clientX, event.clientY);
    if (!line || !point) return;
    setSelectedId(line.id);
    activePointerRef.current = { id: event.pointerId, lineId: line.id,
      offsetX: target ? point.x - line.posicao.x : 0, offsetY: target ? point.y - line.posicao.y : 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!target) changePosition(line.id, { x: clampPosition(point.x), y: clampPosition(point.y) });
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = activePointerRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const point = pointerPosition(event.clientX, event.clientY);
    if (point) changePosition(drag.lineId, { x: clampPosition(point.x - drag.offsetX), y: clampPosition(point.y - drag.offsetY) });
  };
  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current?.id !== event.pointerId) return;
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handlePreviewKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isGenerating || isArranging) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    const line = draft.linhas?.find(line => line.id === (event.target as HTMLElement).dataset.lineId) || activeLine;
    if (!direction || !line) return;
    event.preventDefault(); setSelectedId(line.id);
    const step = event.shiftKey ? 5 : 1;
    changePosition(line.id, { x: clampPosition(line.posicao.x + direction[0] * step), y: clampPosition(line.posicao.y + direction[1] * step) });
  };
  const arrange = async () => {
    setIsArranging(true); setError('');
    let release = () => {};
    try {
      release = await preparePersonalizationFont(draft, availableFonts);
      const context = document.createElement('canvas').getContext('2d');
      if (!context) throw new Error('Não foi possível distribuir as linhas neste navegador.');
      const { width, height } = dimensionsRef.current;
      const next = distributeTextLines(draft, width, height, value => {
        const layout = personalizationLayerLayout(context, width, height, value, availableFonts);
        return layout.lines.length * layout.lineHeight + layout.fontSize * 0.1;
      });
      setDraft(next);
      positionTouchedRef.current = true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível distribuir as linhas.'); }
    finally { release(); setIsArranging(false); }
  };

  const save = async () => {
    const normalized = textRequired ? normalizeTextCustomization(draft, availableFonts) : null;
    if (textRequired && !normalized) {
      setError(`Informe um texto de até ${MAX_CUSTOM_TEXT_LENGTH} caracteres e ${MAX_CUSTOM_TEXT_LINES} linhas, com fonte, tamanho, cor e posição válidos.`);
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
      if (printProfile && [model, ...(back ? [back] : [])].some(face => !printImageQuality(printProfile, face.width, face.height).ratioMatches)) {
        throw new Error('A proporção da capa ou contracapa difere do formato de impressão com sangria. Envie uma imagem nas proporções indicadas.');
      }
      await onSave(normalized, model, back, backDraft);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível gerar o modelo personalizado.');
    } finally {
      setIsGenerating(false);
    }
  };

  const previewCustomization = React.useMemo(() => normalizeTextCustomization(draft, availableFonts) || draft, [draft, availableFonts]);
  const isBack = previewFace === 'back' && backDraft.mode !== 'none';
  const currentSource = isBack && backDraft.mode === 'custom' && backDraft.file ? backDraft.file : previewSource || previewImage;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
      <motion.button type="button" aria-label="Fechar personalização de texto" disabled={isGenerating || isArranging} initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose} className="absolute inset-0 bg-gray-950/60 backdrop-blur-sm" />
      <motion.aside ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby={titleId} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative flex max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 sm:px-7">
          <div className="min-w-0"><p className="truncate text-[10px] font-bold text-pink-500">{productName}</p><h3 id={titleId} className="mt-1 text-xl font-black text-gray-900">{textRequired ? 'Personalizar texto' : 'Personalizar capa e contracapa'}</h3></div>
          <button type="button" onClick={onClose} disabled={isGenerating || isArranging} aria-label="Fechar personalização" className="shrink-0 rounded-full p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-40"><X size={22} /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7"><fieldset disabled={isGenerating || isArranging} className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="min-w-0 space-y-6">
            {textRequired && <>
              <div className="space-y-2">
                <label htmlFor={`${titleId}-text`} className="text-xs font-bold text-gray-700">{fieldLabel}</label>
                <textarea ref={textInputRef} id={`${titleId}-text`} rows={4} value={draft.texto} onChange={event => { const text = event.target.value; if (text.split('\n').length > MAX_CUSTOM_TEXT_LINES) { setError(`Use até ${MAX_CUSTOM_TEXT_LINES} linhas.`); return; } setError(''); setDraft(current => reconcileTextLines(current, text, dimensionsRef.current.width, dimensionsRef.current.height, undefined, positionTouchedRef.current)); }} maxLength={MAX_CUSTOM_TEXT_LENGTH} placeholder="Digite seu texto. Use Enter para uma nova linha." className="w-full resize-y rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none focus:border-pink-400" />
                <p className="flex justify-between gap-2 text-[10px] text-gray-500"><span>Até {MAX_CUSTOM_TEXT_LINES} linhas. Enter cria uma nova linha.</span><span>{draft.texto.length}/{MAX_CUSTOM_TEXT_LENGTH}</span></p>
              </div>
              <TextLineControls draft={draft} fonts={availableFonts} selectedId={activeLine?.id || null} onSelect={setSelectedId} onChange={setDraft} onArrange={() => void arrange()} onPositionTouched={() => { positionTouchedRef.current = true; }} />
            </>}

            <fieldset className="space-y-3 rounded-2xl border border-gray-200 p-4">
              <legend className="px-1 text-sm font-bold text-gray-900">Contracapa</legend>
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={backDraft.mode !== 'none'} onChange={event => { setError(''); setPreviewFace('front'); setBackDraft(current => ({ ...current, mode: event.target.checked ? 'automatic' : 'none' })); }} />Incluir contracapa</label>
              {backDraft.mode !== 'none' && <>
                <label className="flex items-start gap-2 text-xs leading-relaxed text-gray-600"><input className="mt-0.5" type="radio" name={`${titleId}-back`} checked={backDraft.mode === 'automatic'} onChange={() => setBackDraft(current => ({ ...current, mode: 'automatic' }))} />Automática: mesma arte da capa, sem o texto personalizado</label>
                <label className="flex items-center gap-2 text-xs text-gray-600"><input type="radio" name={`${titleId}-back`} checked={backDraft.mode === 'custom'} onChange={() => setBackDraft(current => ({ ...current, mode: 'custom' }))} />Escolher outra imagem</label>
                {backDraft.mode === 'custom' && <div className="min-w-0 space-y-2">
                  <div className="text-xs font-bold text-gray-700">Imagem da contracapa</div>
                  <button type="button" onClick={() => backInputRef.current?.click()} className="flex w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-dashed border-pink-300 bg-pink-50 px-4 py-3 text-sm font-bold text-pink-700 transition-colors hover:border-pink-500 hover:bg-pink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400 focus-visible:ring-offset-2 disabled:opacity-40">
                    <Upload size={17} className="shrink-0" /><span className="min-w-0">{backDraft.file ? 'Trocar imagem da contracapa' : 'Selecionar imagem da contracapa'}</span>
                  </button>
                  <input ref={backInputRef} type="file" aria-label="Imagem da contracapa" accept="image/png,image/jpeg,image/webp" tabIndex={-1} className="sr-only" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (!isComposablePersonalizationImage(file.type, file.size)) { setError('Envie uma contracapa JPG, PNG ou WebP de até 15 MB.'); return; } setError(''); setBackDraft({ mode: 'custom', file }); setPreviewFace('back'); }} />
                  <p className="text-[10px] text-gray-500">JPG, PNG ou WebP de até 15 MB.</p>
                </div>}
                {backDraft.file && backDraft.mode === 'custom' && <p className="min-w-0 break-words [overflow-wrap:anywhere] text-xs text-gray-500">{backDraft.file.name}</p>}
                {(backDraft.mode === 'automatic' || backPreview) && <img src={backDraft.mode === 'automatic' ? previewImage : backPreview} alt="Prévia da contracapa" className="max-h-24 w-full rounded-lg bg-gray-50 object-contain" />}
              </>}
            </fieldset>
            {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{error}</div>}
          </div>

          <section className="min-w-0 space-y-3 rounded-2xl bg-gray-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-bold text-gray-900">Prévia do item personalizado</h4><div className="flex gap-2"><button type="button" onClick={() => setPreviewFace('front')} aria-pressed={!isBack} className={`rounded-lg px-3 py-2 text-xs font-bold ${!isBack ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}>Capa</button>{backDraft.mode !== 'none' && <button type="button" onClick={() => setPreviewFace('back')} aria-pressed={isBack} className={`rounded-lg px-3 py-2 text-xs font-bold ${isBack ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}>Contracapa</button>}</div></div>
            {printProfile && <>
              <PrintProfileNotice profile={printProfile} width={imageDimensions.width} height={imageDimensions.height} />
              <label className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" checked={showPrintGuides} onChange={event => setShowPrintGuides(event.target.checked)} />Mostrar guias de corte e área segura</label>
              <p className="text-[10px] text-gray-500">Vermelho: corte. Verde: área segura para textos. As guias não entram no arquivo.</p>
              {textRequired && !isBack && textBoxes.some(box => !isInsideSafeArea(printProfile, box)) && <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Há texto fora da área segura. Ele pode ficar próximo ao corte.</p>}
            </>}
            <p id={instructionsId} className="text-xs leading-relaxed text-gray-500">{textRequired && !isBack ? 'Selecione e arraste cada linha. Use as setas; Shift move 5%.' : 'Confira a arte antes de aplicar a personalização.'}</p>
            <div ref={previewRef} role="group" tabIndex={textRequired && !isBack ? 0 : -1} onPointerDown={textRequired && !isBack ? handlePointerDown : undefined} onPointerMove={textRequired && !isBack ? handlePointerMove : undefined} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} onKeyDown={textRequired && !isBack ? handlePreviewKeyDown : undefined} aria-describedby={instructionsId} aria-label={textRequired && !isBack ? `Prévia da posição do texto: ${activeLine?.posicao.x ?? draft.posicao.x}% horizontal e ${activeLine?.posicao.y ?? draft.posicao.y}% vertical` : 'Prévia da arte'} style={{ aspectRatio: previewAspectRatio, maxHeight: printProfile ? '40vh' : '56vh', width: `min(100%, calc(${printProfile ? 40 : 56}vh * ${previewAspectRatio}))` }} className="relative mx-auto block max-h-[56vh] touch-none overflow-hidden rounded-xl border-2 border-gray-200 bg-white text-left outline-none focus:border-pink-400 focus:ring-4 focus:ring-pink-100">
              <PersonalizationPreview source={currentSource} customization={textRequired && !isBack ? previewCustomization : null} fonts={availableFonts} onDimensions={(width, height) => {
                setPreviewAspectRatio(width / height);
                setImageDimensions({ width, height });
                if (isBack) return;
                dimensionsRef.current = { width, height };
                if (!initializedRef.current && textRequired) {
                  initializedRef.current = true;
                  setDraft(current => {
                    const next = current.linhas?.length ? current : reconcileTextLines(current, current.texto, width, height);
                    if (!initialValue?.linhas?.length && !positionTouchedRef.current && next.texto.trim()) {
                      try { return distributeTextLines(next, width, height); } catch { return next; }
                    }
                    return next;
                  });
                }
              }} onLayout={setTextBoxes} />
              {printProfile && showPrintGuides && <PrintGuides profile={printProfile} />}
              {textRequired && !isBack && textBoxes.filter(box => box.id !== 'legacy').map(box => <button key={box.id} type="button" data-line-id={box.id} aria-label={`Selecionar linha ${box.index + 1} na prévia`} aria-pressed={activeLine?.id === box.id} onClick={() => setSelectedId(box.id)} style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` }} className={`absolute min-h-3 min-w-3 rounded border-2 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-pink-400 ${activeLine?.id === box.id ? 'z-10 border-pink-400' : 'z-0 border-transparent hover:border-pink-300'}`} />)}
              {textRequired && !isBack && <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[9px] font-bold text-gray-600"><Move size={11} />Arraste para posicionar</span>}
            </div>
            <p className="text-[10px] leading-relaxed text-gray-500">A prévia acompanha o texto, a fonte, o tamanho, a cor e a posição de cada linha. O modelo final mantém a resolução original.</p>
          </section>
        </fieldset></div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-gray-100 bg-gray-50 px-5 py-4 sm:px-7">
          <button type="button" onClick={onClose} disabled={isGenerating || isArranging} className="rounded-xl border border-gray-200 bg-white px-5 py-3 text-xs font-bold text-gray-600 disabled:opacity-40">Cancelar</button>
          <button type="button" onClick={() => void save()} disabled={(textRequired && availableFonts.length === 0) || isGenerating || isArranging} className="flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-5 py-3 text-xs font-bold text-white hover:bg-pink-500 disabled:opacity-40"><Check size={16} />{isGenerating ? 'Gerando modelo...' : 'Aplicar e gerar modelo'}</button>
        </footer>
      </motion.aside>
    </div>, document.body,
  );
}
