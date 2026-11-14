import React from 'react';
import type { Order } from '../types';
import { orderQueueFor, orderQueueLabel } from '../lib/orderStatus';
import { shipmentLabelPhaseNames, type ShipmentLabelView } from '../lib/shipmentLabel';
import { shippingOptionLabel } from '../lib/shipping';
import { formatMoney } from '../lib/commerce';
import type { OrderOperationsApi } from '../services/orderService';
import ShipmentLabelEditor from './ShipmentLabelEditor';

const pageSize = 25;
const button = 'rounded-lg border border-gray-700 px-3 py-2 text-sm disabled:opacity-40';
const field = 'mt-1 w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-sm';

export default function ShipmentLabelsPanel({ orders, ready, ordersError, canManage, api }: {
  orders: Order[]; ready: boolean; ordersError: string | null; canManage: boolean; api: OrderOperationsApi;
}) {
  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState(0);
  const [refresh, setRefresh] = React.useState(0);
  const [orderId, setOrderId] = React.useState('');
  const [result, setResult] = React.useState<{ key: string; labels?: Record<string, ShipmentLabelView>; error?: string }>();
  const term = query.trim().toLocaleLowerCase('pt-BR');
  const matches = orders.filter(order => order.metodoEntrega === 'entrega' && order.shipping?.provider === 'melhor_envio' &&
    (order.paymentStatus === 'pago' || order.paymentConfirmedAt || Number(order.pagbankRefundedAmountCents) > 0) &&
    [order.id, order.clienteNome].some(value => value?.toLocaleLowerCase('pt-BR').includes(term)));
  const lastPage = Math.max(0, Math.ceil(matches.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = matches.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const ids = visible.map(order => order.id).join(',');
  const key = `${refresh}:${ids}`;
  const current = result?.key === key ? result : undefined;
  const selected = matches.find(order => order.id === orderId);
  React.useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    void api.shipmentLabels(ids.split(','), controller.signal).then(labels => {
      if (!controller.signal.aborted) setResult({ key, labels });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ key, error: error.message });
    });
    return () => controller.abort();
  }, [api, ids, key]);
  const onStatus = React.useCallback((label: ShipmentLabelView) => {
    setResult(previous => previous?.labels ? {
      ...previous, labels: { ...previous.labels, [orderId]: label },
    } : previous);
  }, [orderId]);

  return <section className="space-y-4" aria-label="Etiquetas de postagem">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <h2 className="text-2xl font-bold">Etiquetas de postagem</h2>
      <button type="button" className={button} disabled={!ids} onClick={() => setRefresh(value => value + 1)}>Atualizar etiquetas</button>
    </div>
    <label className="block max-w-md text-sm">Buscar por pedido ou cliente
      <input className={field} value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
    </label>
    {ordersError && <p role="alert" className="text-sm text-red-300">{ordersError}</p>}
    {current?.error && <p role="alert" className="text-sm text-red-300">{current.error}</p>}
    {(!ready || (ids && !current)) && <p role="status" className="text-sm text-gray-400">Carregando etiquetas…</p>}
    {ready && !ordersError && !matches.length && <p className="text-sm text-gray-400">Nenhum pedido com frete do Melhor Envio encontrado.</p>}
    <ul className="space-y-2">
      {visible.map(order => {
        const label = current?.labels?.[order.id];
        const tracking = order.tracking?.code || label?.tracking;
        return <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-[#151515] p-4">
          <div className="min-w-0 space-y-1 break-words">
            <p className="font-bold">{order.id} · {order.clienteNome}</p>
            <p className="text-sm text-gray-300">{shippingOptionLabel(order.shipping!)} · {orderQueueLabel(orderQueueFor(order))}</p>
            {label && <p className="text-sm text-pink-300">{shipmentLabelPhaseNames[label.phase]}{label.amountCents != null && ` · ${formatMoney(label.amountCents / 100)}`}</p>}
            {tracking && <p className="text-xs text-gray-400">Rastreio {tracking}</p>}
          </div>
          {canManage && <button type="button" className={button} onClick={() => setOrderId(order.id)}>Abrir etiqueta</button>}
        </li>;
      })}
    </ul>
    {lastPage > 0 && <div className="flex flex-wrap items-center gap-3 text-sm">
      <button type="button" className={button} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button>
      <span>Página {currentPage + 1} de {lastPage + 1}</span>
      <button type="button" className={button} disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Próxima</button>
    </div>}
    {canManage && selected && <ShipmentLabelEditor order={selected} api={api} onStatus={onStatus}
      onClose={() => { setOrderId(''); setRefresh(value => value + 1); }} />}
  </section>;
}
