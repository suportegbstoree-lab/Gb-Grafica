import React from 'react';
import type { Order } from '../types';
import { shipmentLabelPhaseNames, type ShipmentLabelView } from '../lib/shipmentLabel';
import { orderQueueFor } from '../lib/orderStatus';
import { shippingOptionLabel } from '../lib/shipping';
import type { OrderOperationsApi } from '../services/orderService';
import EditorModal from './EditorModal';
import ConfirmDialog from './ConfirmDialog';

const field = 'mt-1 block w-full rounded-lg border border-gray-700 bg-black p-2';
const button = 'rounded-lg bg-pink-500 px-4 py-2 text-sm font-bold disabled:opacity-50';
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default function ShipmentLabelEditor({ order, api, onClose, onStatus }: {
  order: Order; api: OrderOperationsApi; onClose: () => void; onStatus?: (label: ShipmentLabelView) => void;
}) {
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [label, setLabel] = React.useState<ShipmentLabelView>();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [printUrl, setPrintUrl] = React.useState('');
  const [previewUrl, setPreviewUrl] = React.useState('');
  const [pdfUrl, setPdfUrl] = React.useState('');
  const [cancelReason, setCancelReason] = React.useState('');
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const running = React.useRef(false);
  const [invoiceKey, setInvoiceKey] = React.useState('');
  const [recipientDocument, setRecipientDocument] = React.useState('');
  const [agency, setAgency] = React.useState('');
  const [providerId, setProviderId] = React.useState('');
  const stage = orderQueueFor(order);
  const canUseLabel = order.paymentStatus === 'pago' && !Number(order.pagbankRefundedAmountCents);
  const canPrepare = canUseLabel && ['pagamento_confirmado', 'em_producao'].includes(stage) && order.fulfillmentStatus !== 'cancelado';
  React.useEffect(() => {
    if (label) onStatus?.(label);
  }, [label, onStatus]);
  React.useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);
  React.useEffect(() => {
    let active = true;
    setPrintUrl('');
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
    setPrintUrl('');
    setPdfUrl('');
    const print = await api.shipmentLabelPrint(order.id);
    if (!(print instanceof Blob)) {
      setPrintUrl(print.printUrl);
      return;
    }
    const url = URL.createObjectURL(print);
    const link = document.createElement('a');
    link.href = url;
    link.download = `etiqueta-envio-${order.id}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  const viewPdf = () => run(async () => {
    setPrintUrl('');
    const print = await api.shipmentLabelPrint(order.id);
    if (print instanceof Blob) setPdfUrl(URL.createObjectURL(print));
    else setPrintUrl(print.printUrl);
  });
  const checkCancellation = () => run(async () => {
    setLabel(await api.shipmentLabel(order.id, { action: 'check-cancel' }));
  });

  return <><EditorModal title="Etiqueta de postagem" onClose={onClose} busy={busy} doneLabel="Fechar">
    <div className="space-y-4">
      <div className="space-y-1 text-sm">
        <p className="font-semibold">{order.id}{order.shipping && ` · ${shippingOptionLabel(order.shipping)}`}</p>
        {label && <p>{shipmentLabelPhaseNames[label.phase]}</p>}
        {order.shipping && <p>Frete cobrado do cliente {money.format((order.shipping.amount_cents - (order.cupom?.shippingDiscountCents ?? 0)) / 100)} · {order.shipping.parcels.length} volume(s)</p>}
        {label?.amountCents != null && <p className="font-semibold">Custo no Melhor Envio {money.format(label.amountCents / 100)}</p>}
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {notice && <p role="status" className="text-sm text-amber-300">{notice}</p>}
      {!label && !error && <p role="status" className="text-sm">Carregando situação da etiqueta…</p>}
      {(label?.phase === 'none' || label?.phase === 'canceled') && canPrepare && <form className="space-y-3" onSubmit={event => {
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
      {label?.phase === 'none' && !canPrepare && <p className="text-sm">Este pedido está indisponível para preparar uma etiqueta.</p>}
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
      {label?.phase === 'cart' && canPrepare && <>
        <p className="text-sm text-gray-300">A compra usa o saldo da carteira do Melhor Envio.</p>
        <button type="button" className={button} disabled={busy} onClick={() => void issue()}>
          {label.amountCents === null ? 'Consultar valor da etiqueta' : 'Confirmar compra da etiqueta'}
        </button>
      </>}
      {label?.phase === 'discarding' && <>
        <p role="status" className="text-sm">A remoção aguarda confirmação do Melhor Envio.</p>
        <button type="button" className={button} disabled={busy} onClick={() => void run(async () => {
          setLabel(await api.shipmentLabel(order.id, { action: 'discard' }));
        })}>Consultar remoção</button>
      </>}
      {label?.phase === 'cart' && <button type="button" disabled={busy} onClick={() => setConfirmDiscard(true)}
        className="rounded-lg border border-red-500/50 px-4 py-2 text-sm text-red-300">Remover do carrinho</button>}
      {label?.phase === 'buying' && <>
        <p role="status" className="text-sm">Aguardando a confirmação da compra no Melhor Envio.</p>
        <button type="button" className={button} disabled={busy} onClick={() => void issue()}>Consultar compra</button>
      </>}
      {label?.phase === 'paid' && canPrepare && <button type="button" className={button} disabled={busy} onClick={() => void issue()}>Emitir etiqueta</button>}
      {label?.phase === 'generating' && <>
        <p role="status" className="text-sm">O Melhor Envio está gerando a etiqueta.</p>
        <button type="button" className={button} disabled={busy} onClick={() => void issue()}>Consultar emissão</button>
      </>}
      {label?.phase === 'issued' && canUseLabel && <div className="space-y-2">
        <button type="button" disabled={busy} className="mr-2 rounded-lg border border-gray-700 px-4 py-2 text-sm" onClick={() => void run(async () => {
          const { tracking } = await api.refreshMelhorEnvioTracking(order.id);
          setNotice(tracking.status);
          if (tracking.code) setLabel(current => current && { ...current, tracking: tracking.code });
        })}>Consultar rastreio</button>
        {label.tracking && <p className="text-sm">Código de rastreio {label.tracking}</p>}
        <button type="button" className={button + ' mr-2'} disabled={busy} onClick={() => void viewPdf()}>Ver e imprimir PDF</button>
        <button type="button" className={button} disabled={busy} onClick={() => void download()}>Baixar etiqueta de postagem em PDF</button>
        {printUrl && <p className="text-sm text-gray-300">
          <a className="font-semibold text-pink-300 underline" href={printUrl} target="_blank" rel="noopener noreferrer">Abrir impressão no Melhor Envio</a>
          {' com a conta que emitiu a etiqueta.'}
        </p>}
        {pdfUrl && <>
          <iframe className="h-[55vh] w-full rounded-lg border border-gray-700" title="PDF da etiqueta de postagem" src={pdfUrl} />
          <a className="text-sm underline" href={pdfUrl} target="_blank" rel="noopener noreferrer">Abrir PDF em outra aba</a>
        </>}
      </div>}
      {(label?.phase === 'paid' || label?.phase === 'issued') && canUseLabel && <div className="space-y-2">
        <button type="button" className={button} disabled={busy} onClick={() => void run(async () => {
          setPreviewUrl('');
          setPreviewUrl((await api.shipmentLabelPreview(order.id)).printUrl);
        })}>Solicitar prévia do Melhor Envio</button>
        {previewUrl && <p className="text-sm"><a className="text-pink-300 underline" href={previewUrl} target="_blank" rel="noopener noreferrer">Abrir prévia privada</a> com a conta que emitiu a etiqueta.</p>}
      </div>}
      {(label?.phase === 'paid' || label?.phase === 'issued') && !['enviado', 'entregue'].includes(stage) && <div className="space-y-2">
        <label className="block text-sm">Motivo do cancelamento da etiqueta
          <input className={field} maxLength={200} value={cancelReason} onChange={event => setCancelReason(event.target.value)} />
        </label>
        <button type="button" disabled={busy || !cancelReason.trim()} onClick={() => setConfirmCancel(true)} className="rounded-lg border border-red-500/50 px-4 py-2 text-sm text-red-300 disabled:opacity-50">Cancelar etiqueta</button>
      </div>}
      {label?.phase === 'canceling' && <div className="space-y-2">
        <p className="text-sm text-gray-300">Aguardando confirmação do Melhor Envio. Você também pode consultar o envio em Meus Envios.</p>
        <button type="button" className={button} disabled={busy} onClick={() => void checkCancellation()}>Consultar cancelamento</button>
      </div>}
      {label?.providerId && <p className="break-all text-xs text-gray-400">Envio no Melhor Envio {label.providerId}</p>}
    </div>
  </EditorModal>
  {confirmCancel && <ConfirmDialog title="Cancelar a etiqueta de postagem?"
    message="Esta ação cancela o frete no Melhor Envio. O pagamento do pedido e eventual estorno ao cliente são tratados no PagBank."
    confirmLabel="Confirmar cancelamento da etiqueta" busy={busy} danger onCancel={() => setConfirmCancel(false)}
    onConfirm={() => void run(async () => {
      setConfirmCancel(false);
      setPdfUrl(''); setPrintUrl(''); setPreviewUrl('');
      setLabel(await api.shipmentLabel(order.id, { action: 'cancel', description: cancelReason }));
      setCancelReason('');
    })} />}
  {confirmDiscard && <ConfirmDialog title="Remover envio do carrinho?"
    message="A etiqueta preparada será removida do carrinho do Melhor Envio. Você poderá corrigir os dados e preparar novamente."
    confirmLabel="Remover envio" busy={busy} danger onCancel={() => setConfirmDiscard(false)}
    onConfirm={() => void run(async () => {
      setConfirmDiscard(false);
      setLabel(await api.shipmentLabel(order.id, { action: 'discard' }));
    })} />}
  </>;
}
