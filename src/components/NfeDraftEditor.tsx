import { useEffect, useState } from 'react';
import { formatMoney } from '../lib/commerce';
import type { NfeAddress, NfeDraft, NfeItemDraft, NfeReview } from '../lib/nfe';
import { requestNfeDraft } from '../services/nfeService';
import EditorModal from './EditorModal';
import { NfeProductInputs, nfeFieldClass } from './NfeProductFields';

const addressFields = [
  ['cep', 'CEP', 9], ['estado', 'UF', 2], ['cidade', 'Município', 60], ['cityCode', 'Código IBGE do município', 7],
  ['rua', 'Logradouro', 160], ['numero', 'Número', 20], ['bairro', 'Bairro', 60], ['complemento', 'Complemento', 60],
] as const satisfies ReadonlyArray<[keyof NfeAddress, string, number]>;
const recipientFields = [
  ['recipientName', 'Nome ou razão social', 120], ['recipientDocument', 'CPF ou CNPJ', 24],
  ['stateRegistration', 'Inscrição estadual (quando aplicável)', 20], ['operation', 'Natureza da operação', 60],
] as const;
const money = (cents: number) => formatMoney(cents / 100);

export default function NfeDraftEditor({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [review, setReview] = useState<NfeReview>();
  const [draft, setDraft] = useState<NfeDraft>();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void requestNfeDraft(orderId, undefined, controller.signal).then(value => {
      if (!controller.signal.aborted) { setReview(value); setDraft(value.draft); }
    }).catch((reason: Error) => {
      if (!controller.signal.aborted) setError(reason.message);
    });
    return () => controller.abort();
  }, [orderId]);

  function update(patch: Partial<NfeDraft>) {
    setSaved(false);
    setDraft(value => value && { ...value, ...patch });
  }

  function updateItem(index: number, patch: Partial<NfeItemDraft>) {
    if (draft) update({ items: draft.items.map((item, position) => position === index ? { ...item, ...patch } : item) });
  }

  async function save() {
    if (!review || !draft || !review.editable || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await requestNfeDraft(orderId, { draft, revision: review.revision });
      setReview(result);
      setDraft(result.draft);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o rascunho.');
    } finally { setBusy(false); }
  }

  return <EditorModal wide title="Rascunho de NF-e" busy={busy} onClose={onClose} closeLabel="Fechar rascunho de NF-e" doneLabel="Fechar" footerText=""
    footerActions={<button type="submit" form="nfe-draft-form" disabled={busy || !review?.editable}
      className="rounded-lg bg-pink-600 px-4 py-2 text-sm font-bold disabled:opacity-40">Salvar rascunho fiscal</button>}>
    <p className="text-sm font-semibold">Pedido {orderId} · NF-e modelo 55</p>
    <p className="mt-1 text-sm text-gray-400">Área de conferência. A emissão está pendente da integração com o provedor fiscal.</p>
    {review?.environment === 'homologacao' && <p className="mt-1 text-sm text-amber-300">Ambiente fiscal selecionado: homologação.</p>}
    {review?.environment === 'invalid' && <p className="mt-1 text-sm text-amber-300">Configuração do ambiente fiscal inválida. Confira NFE_ENV.</p>}
    {review?.paymentEnvironment === 'sandbox' && <p className="mt-1 text-sm text-amber-300">Pagamento de teste no PagBank.</p>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-950 p-3 text-sm text-red-200">{error}</p>}
    {saved && <p role="status" className="mt-3 text-sm text-green-300">Rascunho fiscal salvo.</p>}
    {!review && !error && <p role="status" className="mt-3 text-sm text-gray-400">Carregando dados fiscais…</p>}
    {review && draft && <form id="nfe-draft-form" className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <dl className="grid grid-cols-2 gap-3 rounded-lg bg-white/5 p-4 text-sm sm:grid-cols-5">
        {([
          ['Produtos', review.totals.itemsCents], ['Desconto nos produtos', review.totals.itemCouponCents],
          ['Frete', review.totals.shippingCents], ['Desconto no frete', review.totals.shippingCouponCents],
          ['Total do pedido', review.totals.totalCents],
        ] as const).map(([label, value]) => <div key={label}><dt className="text-gray-400">{label}</dt><dd className="font-bold">{money(value)}</dd></div>)}
      </dl>
      {!review.editable && <p className="text-sm text-amber-300">A edição requer um pedido pago, sem cancelamento ou estorno.</p>}
      {review.issues.length > 0 && <ul className="list-disc space-y-1 rounded-lg border border-amber-800 px-7 py-3 text-sm text-amber-200">
        {review.issues.map(issue => <li key={issue}>{issue}</li>)}
      </ul>}
      <fieldset className="space-y-4 disabled:opacity-70" disabled={busy || !review.editable}>
        <legend className="mb-2 font-semibold">Destinatário e operação</legend>
        <p className="text-xs text-gray-400">Quando disponível, o CPF sugerido vem do pagamento. Confira o destinatário e o endereço fiscal.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {recipientFields.map(([key, label, max]) => <label key={key} className="text-sm text-gray-300">{label}
            <input className={nfeFieldClass} maxLength={max} value={draft[key]} onChange={event => update({ [key]: event.target.value })} />
          </label>)}
          {addressFields.map(([key, label, max]) => <label key={key} className="text-sm text-gray-300">{label}
            <input className={nfeFieldClass} maxLength={max} value={draft.address[key] ?? ''}
              onChange={event => update({ address: { ...draft.address, [key]: event.target.value } })} />
          </label>)}
        </div>
        {review.lines.map((line, index) => <fieldset className="space-y-3 rounded-xl border border-gray-800 p-4" key={index}>
          <legend className="px-2 font-semibold">{line.name}</legend>
          <p className="text-sm text-gray-400">{line.sku} · {line.quantity} × {money(line.unitCents)}{line.bundle && ' · Pacote'}</p>
          <NfeProductInputs value={draft.items[index]} onChange={patch => updateItem(index, patch)} />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-gray-300">CFOP
              <input className={nfeFieldClass} maxLength={4} inputMode="numeric" value={draft.items[index].cfop ?? ''}
                onChange={event => updateItem(index, { cfop: event.target.value })} />
            </label>
            <label className="text-sm text-gray-300">CST ou CSOSN do ICMS
              <input className={nfeFieldClass} maxLength={3} inputMode="numeric" value={draft.items[index].icmsCode ?? ''}
                onChange={event => updateItem(index, { icmsCode: event.target.value })} />
            </label>
            <label className="text-sm text-gray-300">Desconto do cupom no item (R$)
              <input className={nfeFieldClass} type="number" min={0} max={line.quantity * line.unitCents / 100} step="0.01"
                readOnly={review.couponFromCheckout}
                value={draft.items[index].couponCents === null ? '' : draft.items[index].couponCents! / 100}
                onChange={event => updateItem(index, { couponCents: event.target.value === '' ? null : Math.round(event.target.valueAsNumber * 100) })} />
            </label>
          </div>
        </fieldset>)}
      </fieldset>
    </form>}
  </EditorModal>;
}
