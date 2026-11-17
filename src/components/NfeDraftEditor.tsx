import { useEffect, useState } from 'react';
import { formatMoney } from '../lib/commerce';
import { NFE_RECIPIENT_FIELDS, parseNfeDocument, type NfeAddress, type NfeDraft, type NfeItemDraft, type NfeReview } from '../lib/nfe';
import { requestNfeAddress, requestNfeDraft } from '../services/nfeService';
import EditorModal from './EditorModal';
import { NfeProductInputs, nfeFieldClass } from './NfeProductFields';

const addressFields = [
  ['cep', 'CEP', 9], ['estado', 'UF', 2], ['cidade', 'Município', 60], ['cityCode', 'Código IBGE do município', 7],
  ['rua', 'Logradouro', 160], ['numero', 'Número', 20], ['bairro', 'Bairro', 60], ['complemento', 'Complemento', 60],
] as const satisfies ReadonlyArray<[keyof NfeAddress, string, number]>;
const recipientFields = [...NFE_RECIPIENT_FIELDS, ['operation', 'Natureza da operação', 60]] as const;
const money = (cents: number) => formatMoney(cents / 100);

export default function NfeDraftEditor({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [review, setReview] = useState<NfeReview>();
  const [draft, setDraft] = useState<NfeDraft>();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [changed, setChanged] = useState(false);
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
    setChanged(true);
    setDraft(value => value && { ...value, ...patch });
  }

  function updateItem(index: number, patch: Partial<NfeItemDraft>) {
    if (draft) update({ items: draft.items.map((item, position) => position === index ? { ...item, ...patch } : item) });
  }

  function clearSaleRules(items: NfeItemDraft[]) {
    return items.map(item => ({ ...item, cfop: '', icmsCode: '' }));
  }

  function updateRecipientField(key: typeof recipientFields[number][0], value: string) {
    if (!draft) return;
    const personType = (document: string) => parseNfeDocument(document)?.length;
    const changedTreatment = (key === 'recipientDocument' && personType(value) !== personType(draft.recipientDocument)) ||
      (key === 'stateRegistration' && Boolean(value.trim()) !== Boolean(draft.stateRegistration.trim()));
    update({ [key]: value, ...(changedTreatment ? { items: clearSaleRules(draft.items) } : {}) });
  }

  function updateAddress(address: NfeAddress) {
    if (!draft) return;
    update({
      address,
      ...(address.estado.trim().toUpperCase() !== draft.address.estado.trim().toUpperCase()
        ? { items: clearSaleRules(draft.items) }
        : {}),
    });
  }

  async function consultCep() {
    if (!review?.editable || !draft || busy) return;
    setBusy(true);
    setError('');
    try {
      const address = await requestNfeAddress(draft.address.cep);
      updateAddress({
        ...draft.address, ...address,
        rua: address.rua || draft.address.rua,
        bairro: address.bairro || draft.address.bairro,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível consultar o CEP.');
    } finally { setBusy(false); }
  }

  async function save(confirm: boolean) {
    if (!review || !draft || !review.editable || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await requestNfeDraft(orderId, { draft, revision: review.revision, confirm });
      setReview(result);
      setDraft(result.draft);
      setSaved(true);
      setChanged(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o rascunho.');
    } finally { setBusy(false); }
  }

  return <EditorModal wide title="Rascunho de NF-e" busy={busy} onClose={onClose} closeLabel="Fechar rascunho de NF-e" doneLabel="Fechar" footerText=""
    footerActions={<>
      <button type="submit" form="nfe-draft-form" disabled={busy || !review?.editable || Boolean(review.reviewedAt && !changed)}
        className="rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 disabled:opacity-40">Salvar rascunho</button>
      <button type="button" onClick={() => void save(true)} disabled={busy || !review?.editable || Boolean(review.reviewedAt && !changed)}
        className="rounded-lg bg-pink-600 px-4 py-2 text-sm font-bold hover:bg-pink-700 disabled:opacity-40">Marcar como conferido</button>
    </>}>
    <p className="text-sm font-semibold">Pedido {orderId} · NF-e modelo 55</p>
    <p className="mt-1 text-sm text-gray-400">Área de conferência. A emissão está pendente da integração com o provedor fiscal.</p>
    {review?.environment === 'homologacao' && <p className="mt-1 text-sm text-amber-300">Ambiente fiscal selecionado: homologação.</p>}
    {review?.environment === 'invalid' && <p className="mt-1 text-sm text-amber-300">Configuração do ambiente fiscal inválida. Confira NFE_ENV.</p>}
    {review?.paymentEnvironment === 'sandbox' && <p className="mt-1 text-sm text-amber-300">Pagamento de teste no PagBank.</p>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-950 p-3 text-sm text-red-200">{error}</p>}
    {!changed && (review?.reviewedAt || saved) && <p role="status" className="mt-3 text-sm text-green-300">
      {review?.reviewedAt ? 'Rascunho fiscal conferido.' : 'Rascunho fiscal salvo.'}
    </p>}
    {!review && !error && <p role="status" className="mt-3 text-sm text-gray-400">Carregando dados fiscais…</p>}
    {review && draft && <form id="nfe-draft-form" className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void save(false); }}>
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
        <p className="text-xs text-gray-400">O rascunho usa os dados fiscais informados no checkout. Confira o destinatário e o endereço fiscal.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {recipientFields.map(([key, label, max]) => <label key={key} className="text-sm text-gray-300">{label}
            <input className={nfeFieldClass} maxLength={max} value={draft[key]} onChange={event => updateRecipientField(key, event.target.value)} />
          </label>)}
          {addressFields.map(([key, label, max]) => <label key={key} className="text-sm text-gray-300">{label}
            <input className={nfeFieldClass} maxLength={max} value={draft.address[key] ?? ''}
              onChange={event => updateAddress({
                ...draft.address,
                ...(['cep', 'estado', 'cidade'].includes(key) ? { cityCode: '' } : {}),
                [key]: event.target.value,
              })} />
          </label>)}
        </div>
        <button type="button" onClick={() => void consultCep()} disabled={!draft.address.cep}
          className="rounded-lg border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800 disabled:opacity-40">Consultar CEP</button>
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
