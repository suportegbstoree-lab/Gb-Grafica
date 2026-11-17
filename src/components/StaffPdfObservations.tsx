import React from "react";
import { staffPdfDeadline, staffPdfDaysToDeadline } from "../lib/staffPdfCsv";
import ConfirmDialog from "./ConfirmDialog";

export interface StaffPdfObservedOrderView {
  id: string;
  reference: string;
  barcode: string;
  template: string;
  name: string;
  deadline: string;
  note: string;
}

const action = "rounded-lg border border-gray-700 px-3 py-1.5 text-sm disabled:opacity-40";
const dueLabel = (days: number | undefined) =>
  days === undefined ? "Prazo ausente ou inválido" : days < 0 ? "Vencido" :
    days === 0 ? "Vence hoje" : days === 1 ? "Vence amanhã" : `${days} dias`;

export default function StaffPdfObservations({
  orders, disabled, onOpen, onRemove, onQueue, onExport,
}: {
  orders: StaffPdfObservedOrderView[];
  disabled: boolean;
  onOpen: (id: string, edit: boolean) => void;
  onRemove: (id: string) => Promise<void>;
  onQueue: (id: string) => Promise<void>;
  onExport: () => void;
}) {
  const [removing, setRemoving] = React.useState<StaffPdfObservedOrderView>();
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const sorted = [...orders].sort((a, b) =>
    (staffPdfDeadline(a.deadline) ?? Infinity) - (staffPdfDeadline(b.deadline) ?? Infinity),
  );
  const pages = Math.max(1, Math.ceil(sorted.length / 50));
  const shownPage = Math.min(page, pages - 1);
  const run = async (operation: () => void | Promise<void>) => {
    if (working || disabled) return;
    setWorking(true);
    setError("");
    try { await operation(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setWorking(false); }
  };
  return (
    <section className="space-y-4 rounded-2xl border border-gray-800 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold">Pedidos em Observação</h3>
        <button type="button" className={action} disabled={working || disabled || !orders.length}
          onClick={() => void run(onExport)}>Exportar CSV</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {!orders.length ? <p className="text-sm text-gray-400">Nenhum pedido em observação.</p> : (
        <div className="overflow-auto rounded-lg border border-gray-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-900">
              <tr>{["Pedido", "Rastreio", "Modelo", "Nome", "Prazo de envio", "Observação", "Ações"].map(title =>
                <th scope="col" className="p-3" key={title}>{title}</th>)}</tr>
            </thead>
            <tbody>{sorted.slice(shownPage * 50, (shownPage + 1) * 50).map(order => {
              const days = staffPdfDaysToDeadline(order.deadline, now);
              const tint = days === undefined ? "bg-gray-900" : days <= 0 ? "bg-red-950/80" :
                days === 1 ? "bg-amber-950/80" : "bg-emerald-950/80";
              return (
                <tr key={order.id} className={`border-t border-gray-800 ${tint}`}>
                  <th scope="row" className="p-3">{order.reference}</th>
                  {([order.barcode, order.template, order.name] as const).map((value, index) =>
                    <td key={index} className="p-3">{value || "—"}</td>)}
                  <td className="min-w-36 p-3"><span className="block">{order.deadline || "—"}</span><span className="text-xs font-semibold">{dueLabel(days)}</span></td>
                  <td className="min-w-44 max-w-xs whitespace-pre-wrap break-words p-3">{order.note}</td>
                  <td className="p-3"><div className="flex min-w-44 flex-wrap gap-2">
                    <button type="button" className={action} disabled={working || disabled} onClick={() => onOpen(order.id, false)}>Visualizar</button>
                    <button type="button" className={action} disabled={working || disabled} onClick={() => onOpen(order.id, true)}>Editar</button>
                    <button type="button" className={action} disabled={working || disabled} onClick={() => setRemoving(order)}>Excluir</button>
                    <button type="button" className="rounded-lg bg-pink-700 px-3 py-1.5 text-sm disabled:opacity-40"
                      disabled={working || disabled} onClick={() => void run(() => onQueue(order.id))}>Enviar à fila de PDF</button>
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      {pages > 1 && <nav className="flex items-center gap-3 text-sm" aria-label="Páginas dos pedidos em observação">
        <button type="button" className={action} disabled={!shownPage} onClick={() => setPage(shownPage - 1)}>Anterior</button>
        <span>{shownPage + 1} de {pages}</span>
        <button type="button" className={action} disabled={shownPage + 1 >= pages} onClick={() => setPage(shownPage + 1)}>Próxima</button>
      </nav>}
      {removing && <ConfirmDialog title="Excluir pedido em observação" message={`Excluir o pedido ${removing.reference} desta lista?`}
        danger busy={working} confirmLabel="Excluir pedido" onCancel={() => setRemoving(undefined)}
        onConfirm={() => void run(async () => { await onRemove(removing.id); setRemoving(undefined); })} />}
    </section>
  );
}
