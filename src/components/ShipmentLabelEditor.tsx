import React from 'react';
import type { Order } from '../types';
import type { ShipmentLabelView } from '../lib/shipmentLabel';
import { shippingOptionLabel } from '../lib/shipping';
import type { OrderOperationsApi } from '../services/orderService';
import EditorModal from './EditorModal';

const field = 'mt-1 block w-full rounded-lg border border-gray-700 bg-black p-2';
const button = 'rounded-lg bg-pink-500 px-4 py-2 text-sm font-bold disabled:opacity-50';
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default function ShipmentLabelEditor({ order, api, onClose }: {
  order: Order; api: OrderOperationsApi; onClose: () => void;
}) {
  const [label, setLabel] = React.useState<ShipmentLabelView>();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const running = React.useRef(false);
  const [invoiceKey, setInvoiceKey] = React.useState('');
  const [recipientDocument, setRecipientDocument] = React.useState('');
  const [agency, setAgency] = React.useState('');
  const [providerId, setProviderId] = React.useState('');
  const canPrepare = !['enviado', 'entregue'].includes(order.fulfillmentStatus || '') &&
    !['Enviado', 'Entregue'].includes(order.status);
  React.useEffect(() => {
    let active = true;
    api.shipmentLabel(order.id, { action: 'status' }).then(result => {
      if (active) setLabel(result);
    }).catch(reason => {
      if (active) setError(reason.message);
    });
    return () => { active = false; };
  }, [api, order.id]);
  const run = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await work(); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a etiqueta.');
      await api.shipmentLabel(order.id, { action: 'status' }).then(setLabel).catch(() => undefined);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const issue = () => run(async () => {
    const current = await api.shipmentLabel(order.id, {
      action: 'issue', expectedAmountCents: label?.amountCents ?? undefined,
    });
    if (label?.phase === 'cart' && current.phase === 'cart' && label.amountCents !== current.amountCents)
      setNotice('Valor atualizado. Confira antes de confirmar a compra.');
    setLabel(current);
  });
  const download = () => run(async () => {
    const pdf = await api.shipmentLabelPdf(order.id);
    const url = URL.createObjectURL(pdf);
    const link = document.createElement('a');
    link.href = url;
    link.download = `etiqueta-envio-${order.id}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  });

  return <EditorModal title="Etiqueta de postagem" onClose={onClose} busy={busy} doneLabel="Fechar">
    <div className="space-y-4">
      <div className="space-y-1 text-sm">
        <p className="font-semibold">{order.id}{order.shipping && ` · ${shippingOptionLabel(order.shipping)}`}</p>
        {order.shipping && <p>Frete cobrado do cliente {money.format(order.shipping.amount_cents / 100)} · {order.shipping.parcels.length} volume(s)</p>}
        {label?.amountCents != null && <p className="font-semibold">Custo no Melhor Envio {money.format(label.amountCents / 100)}</p>}
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {notice && <p role="status" className="text-sm text-amber-300">{notice}</p>}
      {!label && !error && <p role="status" className="text-sm">Carregando situação da etiqueta…</p>}
      {label?.phase === 'none' && canPrepare && <form className="space-y-3" onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          setLabel(await api.shipmentLabel(order.id, { action: 'prepare', invoiceKey, recipientDocument, agency }));
          setInvoiceKey(''); setRecipientDocument('');
        });
      }}>
        <label className="block text-sm">Chave da NF-e
          <input className={field} inputMode="numeric" autoComplete="off" required maxLength={44} pattern="[0-9]{44}"
            value={invoiceKey} onChange={event => setInvoiceKey(event.target.value)} />
        </label>
        <label className="block text-sm">CPF ou CNPJ do destinatário
          <input className={field} autoComplete="off" required maxLength={24}
            value={recipientDocument} onChange={event => setRecipientDocument(event.target.value)} />
        </label>
        <label className="block text-sm">ID da agência de postagem (quando exigido)
          <input className={field} inputMode="numeric" autoComplete="off" maxLength={9} pattern="[0-9]{1,9}"
            value={agency} onChange={event => setAgency(event.target.value)} />
        </label>
        <button type="submit" className={button} disabled={busy}>Preparar envio</button>
      </form>}
      {label?.phase === 'none' && !canPrepare && <p className="text-sm">O pedido já foi postado. Aqui aparecem as etiquetas vinculadas antes da postagem.</p>}
      {label?.phase === 'preparing' && <form className="space-y-3" onSubmit={event => {
        event.preventDefault();
        void run(async () => setLabel(await api.shipmentLabel(order.id, { action: 'recover', providerId: providerId.trim() })));
      }}>
        <p className="text-sm">A preparação aguarda confirmação. Se o envio já existir no Melhor Envio com a identificação deste pedido, vincule o ID abaixo.</p>
        <label className="block text-sm">ID do envio no Melhor Envio
          <input className={field} required maxLength={36} value={providerId} onChange={event => setProviderId(event.target.value)} />
        </label>
        <button type="submit" className={button} disabled={busy}>Vincular envio encontrado</button>
      </form>}
      {label?.phase === 'cart' && <>
        <p className="text-sm text-gray-300">A compra usa o saldo da carteira do Melhor Envio.</p>
        <button type="button" className={button} disabled={busy} onClick={() => void issue()}>
          {label.amountCents === null ? 'Consultar valor da etiqueta' : 'Confirmar compra da etiqueta'}
        </button>
      </>}
      {label?.phase === 'buying' && <>
        <p role="status" className="text-sm">Aguardando a confirmação da compra no Melhor Envio.</p>
        <button type="button" className={button} disabled={busy} onClick={() => void issue()}>Consultar compra</button>
      </>}
      {label?.phase === 'paid' && <button type="button" className={button} disabled={busy} onClick={() => void issue()}>Emitir etiqueta</button>}
      {label?.phase === 'generating' && <>
        <p role="status" className="text-sm">O Melhor Envio está gerando a etiqueta.</p>
        <button type="button" className={button} disabled={busy} onClick={() => void issue()}>Consultar emissão</button>
      </>}
      {label?.phase === 'issued' && <div className="space-y-2">
        {label.tracking && <p className="text-sm">Código de rastreio {label.tracking}</p>}
        <button type="button" className={button} disabled={busy} onClick={() => void download()}>Baixar etiqueta de postagem em PDF</button>
      </div>}
      {label?.providerId && <p className="break-all text-xs text-gray-400">Envio no Melhor Envio {label.providerId}</p>}
    </div>
  </EditorModal>;
}
