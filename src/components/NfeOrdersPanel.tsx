import { useEffect, useState } from 'react';
import { canReviewNfeOrder, NFE_SUMMARY_PAGE_SIZE, type NfeOrderSummary } from '../lib/nfe';
import type { NfeAdminApi } from '../services/nfeService';
import type { Order } from '../types';
import NfeDraftEditor from './NfeDraftEditor';

const statusLabels: Record<NfeOrderSummary['status'], string> = {
  pending: 'Com pendências',
  ready: 'Pronto para conferir',
  reviewed: 'Conferido',
  unavailable: 'Indisponível',
};
const button = 'rounded-lg border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800 disabled:opacity-40';

export default function NfeOrdersPanel({ orders, api }: { orders: Order[]; api: NfeAdminApi }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [orderId, setOrderId] = useState('');
  const [result, setResult] = useState<{ key: string; summaries?: Record<string, NfeOrderSummary>; error?: string }>();

  const term = query.trim().toLocaleLowerCase('pt-BR');
  const matches = orders.filter(order => canReviewNfeOrder(order) &&
    [order.id, order.clienteNome].some(value => value?.toLocaleLowerCase('pt-BR').includes(term)));
  const lastPage = Math.max(0, Math.ceil(matches.length / NFE_SUMMARY_PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = matches.slice(currentPage * NFE_SUMMARY_PAGE_SIZE, (currentPage + 1) * NFE_SUMMARY_PAGE_SIZE);
  const ids = visible.map(order => order.id).join(',');
  const key = refresh + ':' + ids;
  const current = result?.key === key ? result : undefined;

  useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    void api.summaries(ids.split(','), controller.signal).then(summaries => {
      if (!controller.signal.aborted) setResult({ key, summaries });
    }).catch((reason: Error) => {
      if (!controller.signal.aborted) setResult({ key, error: reason.message });
    });
    return () => controller.abort();
  }, [ids, key, api]);

  return <section aria-label="Pendências fiscais dos pedidos" className="space-y-4 rounded-xl border border-gray-800 bg-[#111111] p-4 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <label className="text-sm">Buscar pedido ou cliente
        <input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }}
          className="mt-1 block w-full rounded-lg border border-gray-700 bg-black px-3 py-2" />
      </label>
      <button type="button" className={button} disabled={!ids || !current} onClick={() => setRefresh(value => value + 1)}>Atualizar pendências</button>
    </div>
    {!matches.length && <p className="text-sm text-gray-400">Nenhum pedido pago disponível para conferência.</p>}
    {ids && !current && <p role="status" className="text-sm text-gray-400">Consultando pendências fiscais…</p>}
    {current?.error && <p role="alert" className="text-sm text-red-300">{current.error}</p>}
    <ul className="divide-y divide-gray-800">
      {visible.map(order => {
        const summary = current?.summaries?.[order.id];
        return <li key={order.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
          <div className="min-w-0 space-y-1 break-words">
            <p className="font-semibold">{order.id} · {order.clienteNome}</p>
            {summary && <p className={summary.status === 'reviewed' ? 'text-sm text-green-300' : 'text-sm text-gray-300'}>{statusLabels[summary.status]}</p>}
            {summary && summary.issues.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-amber-200">
              {summary.issues.map(issue => <li key={issue}>{issue}</li>)}
            </ul>}
            {summary && summary.issueCount > summary.issues.length && <p className="text-xs text-gray-400">
              Mais {summary.issueCount - summary.issues.length} pendência(s) no rascunho.
            </p>}
          </div>
          <button type="button" className={button} disabled={summary?.status === 'unavailable'} onClick={() => setOrderId(order.id)}>Conferir NF-e</button>
        </li>;
      })}
    </ul>
    {lastPage > 0 && <div className="flex flex-wrap items-center gap-3 text-sm">
      <button type="button" className={button} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button>
      <span>Página {currentPage + 1} de {lastPage + 1}</span>
      <button type="button" className={button} disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Próxima</button>
    </div>}
    {orderId && <NfeDraftEditor orderId={orderId} api={api}
      onClose={() => { setOrderId(''); setRefresh(value => value + 1); }} />}
  </section>;
}
