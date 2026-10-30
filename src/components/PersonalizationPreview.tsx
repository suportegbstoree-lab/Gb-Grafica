import React from 'react';
import type { PersonalizationFont, TextCustomization } from '../lib/textCustomization';
import { decodePersonalizationSource, drawPersonalizationText, preparePersonalizationFont, type DecodedImage, type PersonalizationTextBox } from '../services/personalizationModelService';

export default function PersonalizationPreview({ source, customization, fonts, onDimensions, onLayout }: {
  source: Blob | string; customization: TextCustomization | null; fonts: PersonalizationFont[];
  onDimensions: (width: number, height: number) => void;
  onLayout?: (boxes: PersonalizationTextBox[]) => void;
}) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [decoded, setDecoded] = React.useState<DecodedImage | null>(null);
  const [error, setError] = React.useState('');
  const [rendering, setRendering] = React.useState(true);
  const layoutCallback = React.useRef(onLayout); layoutCallback.current = onLayout;
  const dimensionsCallback = React.useRef(onDimensions); dimensionsCallback.current = onDimensions;
  React.useEffect(() => {
    let cancelled = false; let image: DecodedImage | undefined;
    setDecoded(null); setError(''); setRendering(true); layoutCallback.current?.([]);
    void decodePersonalizationSource(source).then(result => {
      if (cancelled) { result.dispose(); return; }
      image = result; setDecoded(result); dimensionsCallback.current(result.width, result.height);
    }).catch(reason => { if (!cancelled) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a prévia.'); setRendering(false); } });
    return () => { cancelled = true; image?.dispose(); };
  }, [source]);

  React.useEffect(() => {
    if (!decoded) return;
    let cancelled = false; let release = () => {};
    setRendering(true); setError('');
    void preparePersonalizationFont(customization, fonts).then(cleanup => {
      if (cancelled) { cleanup(); return; } release = cleanup;
      const target = canvas.current;
      if (!target) return;
      const scale = 1200 / Math.max(decoded.width, decoded.height);
      target.width = Math.max(1, Math.round(decoded.width * scale)); target.height = Math.max(1, Math.round(decoded.height * scale));
      const context = target.getContext('2d');
      if (!context) throw new Error('Este navegador não permite exibir a prévia.');
      context.scale(target.width / decoded.width, target.height / decoded.height);
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, decoded.width, decoded.height);
      context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height);
      const boxes = customization?.texto.trim() ? drawPersonalizationText(context, decoded.width, decoded.height, customization, fonts) : [];
      layoutCallback.current?.(boxes);
      setRendering(false);
    }).catch(reason => { if (!cancelled) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a prévia.'); layoutCallback.current?.([]); setRendering(false); } });
    return () => { cancelled = true; release(); };
  }, [decoded, customization, fonts]);

  return <>
    <canvas ref={canvas} draggable={false} onContextMenu={event => event.preventDefault()} role="img" aria-label="Prévia do item personalizado" aria-busy={rendering} className="pointer-events-none h-full w-full select-none object-contain" />
    {rendering && <span role="status" className="pointer-events-none absolute inset-x-2 top-2 rounded-lg bg-white/95 p-2 text-center text-xs text-gray-600">Atualizando prévia...</span>}
    {error && <span role="alert" className="pointer-events-none absolute inset-x-2 top-2 rounded-lg bg-red-50 p-3 text-center text-xs font-bold text-red-700">{error}</span>}
  </>;
}
