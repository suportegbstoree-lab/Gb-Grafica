import type { Promocao } from '../types';

export default function FlashPromotionEditor({ value, onChange }: { value: Partial<Promocao>; onChange: (value: Partial<Promocao>) => void }) {
  const duration = value.startsAt !== undefined && value.endsAt !== undefined ? Math.max(1, Math.round((value.endsAt - value.startsAt) / 60_000)) : 60;
  const start = (minutes: number) => { const now = Date.now(); onChange({ ...value, relampago: true, startsAt: now, endsAt: now + minutes * 60_000 }); };
  return <fieldset className="space-y-3 rounded-xl border border-pink-500/30 p-4">
    <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={value.relampago === true} onChange={event => {
      if (event.target.checked) start(duration);
      else { const { relampago: _, startsAt: _start, endsAt: _end, ...rest } = value; onChange(rest); }
    }} />Promoção relâmpago</label>
    {value.relampago && <>
      <label className="block text-xs text-gray-400">Duração (minutos)<input type="number" min="1" max="525600" step="1" required value={duration} onChange={event => { const minutes = Number(event.target.value); if (Number.isFinite(minutes)) onChange({ ...value, endsAt: (value.startsAt || Date.now()) + minutes * 60_000 }); }} className="mt-2 w-full rounded-lg border border-gray-700 bg-black px-3 py-2" /></label>
      <p className="text-xs text-gray-400">Término: {value.endsAt ? new Date(value.endsAt).toLocaleString('pt-BR') : 'Defina o prazo'}. O contador usa este prazo e não reinicia para cada visitante.</p>
      <button type="button" onClick={() => start(duration)} className="text-xs font-bold text-pink-400">Iniciar novo prazo a partir de agora</button>
    </>}
  </fieldset>;
}
