import { NFE_PRODUCT_FIELDS, type NfeProductFields } from '../lib/nfe';

export const nfeFieldClass = 'mt-1 block w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-sm';

export function NfeProductInputs({ value, onChange }: {
  value?: NfeProductFields;
  onChange: (value: NfeProductFields) => void;
}) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {NFE_PRODUCT_FIELDS.map(({ key, label, max }) => <label key={key} className="text-sm text-gray-300">
      {label}
      <input className={nfeFieldClass} maxLength={max} inputMode={key === 'unit' ? 'text' : 'numeric'}
        value={value?.[key] ?? ''} onChange={event => {
          const text = event.target.value;
          onChange({ [key]: text });
        }} />
    </label>)}
  </div>;
}
