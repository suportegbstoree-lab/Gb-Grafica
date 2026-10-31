import React from 'react';
import type { Order } from '../types';
import { legacyFulfillmentStatus } from '../lib/orderStatus';
import { validTrackingCode } from '../lib/tracking';
import type { OrderOperationsApi } from '../services/orderService';
import EditorModal from './EditorModal';

export default function OrderActions({ order, api, onError, onSuccess }: { order: Order; api: OrderOperationsApi; onError: (message: string) => void; onSuccess: (message: string) => void }) {
  const [busy, setBusy] = React.useState(false), [shippingOpen, setShippingOpen] = React.useState(false), [code, setCode] = React.useState('');
  const [operationError, setOperationError] = React.useState('');
  const lock = React.useRef(false), labelId = React.useRef<string | null>(null);
  const stage = order.fulfillmentStatus || legacyFulfillmentStatus(order.status, order.paymentStatus);
  const paid = order.paymentStatus === 'pago';
  const run = async (action: () => Promise<void>, message: string) => {
    if (lock.current) return; lock.current = true; setBusy(true); setOperationError('');
    try { await action(); onSuccess(message); }
    catch (error) { const message = error instanceof Error ? error.message : 'Não foi possível concluir a operação.'; setOperationError(message); onError(message); }
    finally { lock.current = false; setBusy(false); }
  };
  const label = () => run(async () => {
    labelId.current ||= crypto.randomUUID();
    const blob = await api.productionLabel(order.id, labelId.current);
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `etiqueta-${order.id}.pdf`; document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    labelId.current = null;
  }, stage === 'pagamento_confirmado' ? 'Etiqueta gerada. Pedido em produção.' : 'Etiqueta de produção gerada.');
  return <div className="flex flex-wrap gap-2">
    {paid && !['aguardando_pagamento', 'cancelado'].includes(stage) && <button type="button" disabled={busy} onClick={label} className="rounded-lg bg-pink-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{busy ? 'Processando...' : stage === 'pagamento_confirmado' ? 'Gerar etiqueta e iniciar produção' : 'Gerar etiqueta de produção'}</button>}
    {paid && stage === 'em_producao' && <button type="button" disabled={busy} onClick={() => order.metodoEntrega === 'retirada'
      ? void run(() => api.updateFulfillment(order.id, 'pronto_retirada'), 'Pedido pronto para retirada.') : setShippingOpen(true)} className="rounded-lg border border-cyan-500/40 px-4 py-2 text-xs font-bold text-cyan-300 disabled:opacity-50">{order.metodoEntrega === 'retirada' ? 'Marcar pronto para retirada' : 'Marcar A Caminho'}</button>}
    {paid && stage === 'enviado' && <button type="button" disabled={busy} onClick={() => { setCode(order.tracking?.code || ''); setShippingOpen(true); }} className="rounded-lg border border-gray-600 px-4 py-2 text-xs font-bold disabled:opacity-50">Corrigir rastreio</button>}
    {stage === 'enviado' && order.tracking?.provider === 'correios' && <button type="button" disabled={busy} onClick={() => void run(() => api.refreshTracking(order.id), 'Rastreio consultado. A entrega depende da confirmação dos Correios.')} className="rounded-lg border border-cyan-500/40 px-4 py-2 text-xs font-bold text-cyan-300 disabled:opacity-50">Consultar rastreio</button>}
    {shippingOpen && <EditorModal title={`Enviar pedido ${order.id}`} onClose={() => setShippingOpen(false)} busy={busy} closeLabel="Fechar envio" doneLabel="Cancelar" footerText="Confirme a postagem antes de marcar A Caminho. A etiqueta de produção é apenas para uso interno.">
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); if ((order.shipping || code) && !validTrackingCode(code)) { onError('Informe um código válido, como AA123456789BR.'); return; }
        void run(async () => { await api.updateFulfillment(order.id, 'enviado', code || undefined); setShippingOpen(false); }, 'Pedido A Caminho.'); }}>
        {operationError && <p role="alert" className="text-sm text-red-300">{operationError}</p>}
        <label className="block text-sm">Código de rastreio dos Correios{!order.shipping && ' (opcional para entrega própria)'}<input autoComplete="off" required={Boolean(order.shipping)} maxLength={13} pattern="[A-Z]{2}[0-9]{9}[A-Z]{2}" value={code} onChange={event => setCode(event.target.value.trim().toUpperCase())} className="mt-2 w-full rounded-lg border border-gray-700 bg-black p-3 font-mono" /></label>
        <button type="submit" disabled={busy} className="rounded-lg bg-pink-500 px-4 py-3 text-sm font-bold disabled:opacity-50">Confirmar envio</button>
      </form>
    </EditorModal>}
  </div>;
}
