import type { Anuncio } from '../types';
import { printGeometry, type PrintProfile } from '../lib/printProfile';

const fields: Array<{ key: keyof PrintProfile; label: string; min: number; max: number }> = [
  { key: 'widthMm', label: 'Largura final (mm)', min: 10, max: 2000 },
  { key: 'heightMm', label: 'Altura final (mm)', min: 10, max: 2000 },
  { key: 'bleedMm', label: 'Sangria por lado (mm)', min: 0, max: 20 },
  { key: 'safeMarginMm', label: 'Margem segura interna (mm)', min: 0, max: 50 },
  { key: 'targetDpi', label: 'Resolução recomendada (dpi)', min: 72, max: 1200 },
];

export default function ProductPrintEditor({ product, onChange }: { product: Partial<Anuncio>; onChange: (product: Partial<Anuncio>) => void }) {
  const profile = product.printProfile;
  const geometry = profile && printGeometry(profile);
  return <fieldset className="space-y-4 rounded-xl border border-gray-800 p-4 md:col-span-2">
    <legend className="px-2 text-xs font-bold text-gray-400">Formato de impressão</legend>
    <p className="text-xs leading-relaxed text-gray-400">Cada face usa este formato. Informe as medidas finais de corte e a sangria definida pela gráfica. A imagem enviada deve incluir a sangria. Para outra orientação, inverta largura e altura.</p>
    {!profile ? <button type="button" onClick={() => onChange({ ...product, printProfile: { widthMm: 0, heightMm: 0, bleedMm: 0, safeMarginMm: 0, targetDpi: 300 } })} className="text-xs font-bold text-pink-400">Configurar formato de impressão</button> : <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields.map(field => <label key={field.key} className="text-xs text-gray-400">{field.label}
        <input type="number" required min={field.min} max={field.max} step="0.01" value={profile[field.key]} onChange={event => onChange({ ...product, printProfile: { ...profile, [field.key]: event.target.value === '' ? 0 : Number(event.target.value) } })} className="mt-2 w-full rounded-lg border border-gray-800 bg-black px-3 py-2 text-white" />
      </label>)}</div>
      {geometry && <p className="text-xs text-gray-400">Arquivo com sangria: {geometry.widthMm} × {geometry.heightMm} mm. Nenhuma imagem será ampliada para simular resolução.</p>}
      <button type="button" onClick={() => { const { printProfile: _, ...rest } = product; onChange(rest); }} className="text-xs text-red-400">Remover formato de impressão</button>
    </>}
  </fieldset>;
}
