import { useState } from 'react';
import type { Anuncio } from '../types';
import { generateProductCombinations } from '../lib/adminValidation';
import type { ProductShippingProfile } from '../lib/shipping';

const fields: Array<{ key: keyof ProductShippingProfile; label: string; min: number; max: number; step: number }> = [
  { key: 'unitWeightGrams', label: 'Peso por unidade vendida (g)', min: 1, max: 30000, step: 1 },
  { key: 'packagingWeightGrams', label: 'Peso da embalagem vazia (g)', min: 0, max: 29999, step: 1 },
  { key: 'lengthCm', label: 'Comprimento externo (cm)', min: 11, max: 100, step: 0.1 },
  { key: 'widthCm', label: 'Largura externa (cm)', min: 6, max: 100, step: 0.1 },
  { key: 'heightCm', label: 'Altura externa (cm)', min: 0.4, max: 100, step: 0.1 },
  { key: 'unitsPerParcel', label: 'Unidades que cabem por volume', min: 1, max: 999, step: 1 },
];

export default function ProductShippingEditor({ product, onChange }: {
  product: Partial<Anuncio>; onChange: (product: Partial<Anuncio>) => void;
}) {
  const [combination, setCombination] = useState('');
  const combinations = generateProductCombinations(product.atributos || []);
  const target = combinations.includes(combination) ? combination : '';
  const profile = target ? product.shippingByCombination?.[target] : product.shipping;
  const update = (value?: ProductShippingProfile) => {
    if (!target) { onChange({ ...product, shipping: value }); return; }
    const variants = { ...product.shippingByCombination };
    if (value) variants[target] = value;
    else delete variants[target];
    onChange({ ...product, shippingByCombination: variants });
  };
  return (
    <fieldset className="md:col-span-2 space-y-4 rounded-lg border border-gray-800 p-4">
      <legend className="px-2 text-xs font-bold text-gray-400 uppercase">Peso e embalagem para os Correios</legend>
      <p className="text-xs text-gray-400">Informe medidas externas da embalagem pronta e sua capacidade real. Produtos ou variações diferentes usam volumes separados. Sem cadastro, o produto permite retirada e precisa combinar o envio com a loja.</p>
      {combinations.length > 0 && <label className="block text-xs text-gray-400">Aplicar a
        <select aria-label="Embalagem da combinação" value={target} onChange={event => setCombination(event.target.value)}
          className="mt-2 w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-white">
          <option value="">Padrão do produto</option>
          {combinations.map(combo => <option key={combo} value={combo}>{combo.replace(/\|/g, ' + ')}</option>)}
        </select>
      </label>}
      {!profile ? <button type="button" className="text-xs font-bold text-[#ff4d79]" onClick={() => update({
        unitWeightGrams: 0, packagingWeightGrams: 0, lengthCm: 0, widthCm: 0, heightCm: 0, unitsPerParcel: 1,
      })}>{target ? 'Definir embalagem específica para esta combinação' : 'Cadastrar peso e embalagem'}</button> : <>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {fields.map(field => <label key={field.key} className="text-xs text-gray-400">{field.label}
            <input aria-label={field.label} type="number" required min={field.min} max={field.max} step={field.step}
              value={profile[field.key]} onChange={event => update({ ...profile, [field.key]: event.target.value === '' ? 0 : Number(event.target.value) })}
              className="mt-2 w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-white" />
          </label>)}
        </div>
        <button type="button" onClick={() => update(undefined)} className="text-xs text-red-400">{target ? 'Usar padrão do produto nesta combinação' : 'Remover embalagem padrão'}</button>
      </>}
      {target && !profile && <p className="text-xs text-gray-500">Esta combinação usa a embalagem padrão do produto, quando cadastrada.</p>}
    </fieldset>
  );
}
