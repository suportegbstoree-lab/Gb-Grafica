import React from 'react';
import { MAX_TEXT_SIZE, MIN_TEXT_SIZE, type PersonalizationFont, type TextCustomization, type TextCustomizationLine } from '../lib/textCustomization';
import { textLineValue } from '../lib/textLines';

export default function TextLineControls({ draft, fonts, selectedId, onSelect, onChange, onArrange, onPositionTouched }: {
  draft: TextCustomization; fonts: PersonalizationFont[]; selectedId: string | null;
  onSelect: (id: string) => void; onChange: React.Dispatch<React.SetStateAction<TextCustomization>>;
  onArrange: () => void; onPositionTouched: () => void;
}) {
  const lines = draft.linhas || [];
  const line = lines.find(row => row.id === selectedId) || lines[0];
  const active = line ? textLineValue(draft, line) : draft;
  const patch = (changes: Partial<TextCustomizationLine>) => onChange(current => ({
    ...current,
    ...(changes.tamanhoFonte !== undefined ? { tamanhoFonte: changes.tamanhoFonte } : {}),
    ...(changes.posicao ? { posicao: changes.posicao } : {}),
    linhas: current.linhas?.map(row => row.id === line?.id ? { ...row, ...changes } : row),
  }));
  const setFont = (font: PersonalizationFont) => {
    const fields = { fonte: font.id, fonteNome: font.nome, fonteCssFamily: font.cssFamily, fonteArquivoUrl: font.arquivoUrl };
    if (draft.fonteCompartilhada !== false || !line) onChange(current => ({ ...current, ...fields }));
    else patch(fields);
  };
  return <>
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-2 text-xs font-bold text-gray-700">Linha selecionada</legend>
      <div className="flex flex-wrap gap-2">{lines.map((row, index) => <button key={row.id} type="button" aria-label={`Editar linha ${index + 1}`} aria-pressed={row.id === line?.id} onClick={() => onSelect(row.id)} className={`max-w-full rounded-lg border px-3 py-2 text-xs font-bold ${row.id === line?.id ? 'border-pink-400 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-600'}`}>
        Linha {index + 1}<span className="ml-1 font-normal">{row.texto ? ` · ${row.texto.slice(0, 18)}` : ' · vazia'}</span>
      </button>)}</div>
      <p className="text-[10px] leading-relaxed text-gray-500">Selecione uma linha aqui ou toque no texto da prévia. Posição e tamanho são individuais.</p>
    </fieldset>

    <fieldset className="space-y-2">
      <legend className="mb-2 text-xs font-bold text-gray-700">Fonte</legend>
      <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={draft.fonteCompartilhada !== false} onChange={event => { const shared = event.target.checked; onChange(current => ({ ...current, fonteCompartilhada: shared, ...(shared ? { fonte: active.fonte, fonteNome: active.fonteNome, fonteCssFamily: active.fonteCssFamily, fonteArquivoUrl: active.fonteArquivoUrl } : { linhas: current.linhas?.map(row => ({ ...row, fonte: current.fonte, fonteNome: current.fonteNome, fonteCssFamily: current.fonteCssFamily, fonteArquivoUrl: current.fonteArquivoUrl })) }) })); }} />Compartilhar fonte entre linhas</label>
      <div className="grid max-h-44 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">{fonts.map(font => <button key={font.id} type="button" onClick={() => setFont(font)} aria-pressed={active.fonte === font.id} className={`break-words rounded-xl border px-3 py-3 text-sm ${active.fonte === font.id ? 'border-pink-400 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-600 hover:border-pink-200'}`} style={{ fontFamily: font.cssFamily }}>{font.nome}</button>)}</div>
      {!fonts.length && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">Nenhuma fonte foi disponibilizada pela loja.</p>}
    </fieldset>

    <div className="grid min-w-0 grid-cols-2 gap-4">
      <div className="min-w-0 space-y-2"><label htmlFor="text-line-size" className="text-xs font-bold text-gray-700">Tamanho da fonte</label><div className="flex items-center gap-2"><input id="text-line-size" type="number" min={MIN_TEXT_SIZE} max={MAX_TEXT_SIZE} step="0.1" value={Number.isFinite(active.tamanhoFonte) ? active.tamanhoFonte : ''} onChange={event => patch({ tamanhoFonte: event.target.value === '' ? NaN : Number(event.target.value) })} className="w-full min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-900" /><span className="text-xs text-gray-500">%</span></div>
        <input aria-label="Ajustar tamanho da fonte" type="range" min={MIN_TEXT_SIZE} max={MAX_TEXT_SIZE} step="0.1" value={Number.isFinite(active.tamanhoFonte) ? active.tamanhoFonte : 7.2} onChange={event => patch({ tamanhoFonte: Number(event.target.value) })} className="w-full accent-pink-500" />
        <p className="text-[10px] text-gray-500">Só a linha selecionada; percentual da largura da capa.</p>
      </div>
      <div className="min-w-0 space-y-2"><label htmlFor="text-line-color" className="text-xs font-bold text-gray-700">Cor do texto</label><input id="text-line-color" type="color" value={active.cor || '#ffffff'} onChange={event => { const cor = event.target.value; if (draft.corCompartilhada !== false) onChange(current => ({ ...current, cor })); else patch({ cor }); }} className="h-12 w-full cursor-pointer rounded-xl border border-gray-200 bg-gray-50 p-1" />
        <label className="flex items-start gap-2 text-[10px] text-gray-600"><input type="checkbox" checked={draft.corCompartilhada !== false} onChange={event => { const shared = event.target.checked; onChange(current => ({ ...current, corCompartilhada: shared, ...(shared ? { cor: active.cor } : { linhas: current.linhas?.map(row => ({ ...row, cor: current.cor })) }) })); }} />Compartilhar cor entre linhas</label>
        <p className="text-[10px] text-gray-500">{active.cor}</p>
      </div>
    </div>

    {line && <div className="space-y-3 rounded-xl border border-gray-200 p-3">
      <p className="text-xs font-bold text-gray-700">Posição da linha {lines.indexOf(line) + 1}</p>
      <div className="grid grid-cols-2 gap-3">{(['x', 'y'] as const).map(axis => <label key={axis} className="space-y-1 text-[10px] text-gray-600">{axis === 'x' ? 'Horizontal (%)' : 'Vertical (%)'}<input aria-label={axis === 'x' ? 'Posição horizontal da linha' : 'Posição vertical da linha'} type="number" min="0" max="100" step="0.1" value={line.posicao[axis]} onChange={event => { onPositionTouched(); patch({ posicao: { ...line.posicao, [axis]: Number(event.target.value) } }); }} className="block w-full min-w-0 rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs text-gray-900" /></label>)}</div>
      <button type="button" onClick={onArrange} className="text-xs font-bold text-pink-600 hover:underline">Centralizar e distribuir linhas</button>
    </div>}
  </>;
}
