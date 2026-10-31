import type { Order } from '../types';
import { formatMoney, parseMoneyToCents } from '../lib/commerce';
import { fulfillmentStatusLabel, legacyFulfillmentStatus } from '../lib/orderStatus';
import { printProfileLabel } from '../lib/printProfile';

export default function CustomerOrderDetails({ order }: { order: Order }) {
  return <div className="space-y-5 text-sm text-gray-700">
    <dl className="grid gap-3 rounded-xl bg-gray-50 p-4 sm:grid-cols-2">
      <div><dt className="text-xs text-gray-500">Cliente</dt><dd className="break-words">{order.clienteNome || 'Não informado'}</dd></div>
      <div><dt className="text-xs text-gray-500">Andamento</dt><dd className="font-bold text-purple-600">{fulfillmentStatusLabel(order.fulfillmentStatus || legacyFulfillmentStatus(order.status, order.paymentStatus))}</dd></div>
      <div><dt className="text-xs text-gray-500">Pagamento</dt><dd>{order.paymentStatus === 'pago' ? 'Confirmado' : order.paymentStatus === 'cancelado' ? 'Cancelado' : order.status}</dd></div>
      <div><dt className="text-xs text-gray-500">Recebimento</dt><dd>{order.metodoEntrega === 'retirada' ? 'Retirada na gráfica' : 'Entrega'}{order.shipping ? ` · ${order.shipping.service_name}` : ''}</dd></div>
    </dl>
    {order.enderecoEntrega && <section><h3 className="font-bold">Endereço de entrega</h3><p className="break-words">{order.enderecoEntrega.rua}, {order.enderecoEntrega.numero}{order.enderecoEntrega.complemento ? ` · ${order.enderecoEntrega.complemento}` : ''}<br />{order.enderecoEntrega.bairro} · {order.enderecoEntrega.cidade}/{order.enderecoEntrega.estado}<br />CEP {order.enderecoEntrega.cep}</p></section>}
    {order.tracking && <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-4"><h3 className="font-bold">Rastreamento dos Correios</h3><p className="font-mono">{order.tracking.code}</p><p className="break-words">{order.tracking.status}</p>{order.tracking.eventAt && <p className="text-xs">Evento: {new Date(order.tracking.eventAt).toLocaleString('pt-BR')}</p>}<p className="mt-2 text-xs text-gray-500">Última consulta: {new Date(order.tracking.updatedAt).toLocaleString('pt-BR')}. O acompanhamento é atualizado periodicamente pela loja.</p></section>}
    {order.itens.map(item => <section key={item.id} className="space-y-2 rounded-xl border border-gray-200 p-4">
      <h3 className="font-bold">{item.quantidade} × {item.nome}</h3>
      <dl className="space-y-1 text-xs">{Object.entries(item.selecoes || {}).map(([key, value]) => <div key={key}><dt className="inline font-bold">{key}: </dt><dd className="inline break-words">{value}</dd></div>)}</dl>
      {(item.personalizacaoTexto?.texto || item.textoPersonalizado) && <p className="whitespace-pre-wrap break-words">Personalização: {item.personalizacaoTexto?.texto || item.textoPersonalizado}</p>}
      {item.printProfile && <p className="text-xs">{printProfileLabel(item.printProfile)}</p>}
      <p className="text-xs">{item.contracapaPath ? 'Capa e contracapa' : item.modeloPath ? 'Capa personalizada' : 'Produto conforme as opções selecionadas'}</p>
      {item.aprovacaoArte && <p className="text-xs text-green-700">Arte aprovada na compra em {new Date(item.aprovacaoArte.acceptedAt).toLocaleString('pt-BR')}</p>}
      <p className="font-bold">{formatMoney((parseMoneyToCents(item.preco) || 0) * item.quantidade / 100)}</p>
    </section>)}
    <dl className="space-y-2 border-t border-gray-200 pt-4">{order.subtotal && <div className="flex justify-between"><dt>Itens</dt><dd>{formatMoney(order.subtotal)}</dd></div>}{order.frete && <div className="flex justify-between"><dt>Frete</dt><dd>{formatMoney(order.frete)}</dd></div>}<div className="flex justify-between font-black text-pink-600"><dt>Total</dt><dd>{formatMoney(order.total)}</dd></div></dl>
  </div>;
}
