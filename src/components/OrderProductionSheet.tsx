import type { Order } from '../types';
import { fulfillmentStatusLabel, legacyFulfillmentStatus } from '../lib/orderStatus';
import { printProfileLabel } from '../lib/printProfile';
import EditorModal from './EditorModal';

export default function OrderProductionSheet({ order, onClose, onOpenModel, canOpenFiles = false }: { order: Order; onClose: () => void; canOpenFiles?: boolean; onOpenModel: (orderId: string, itemId: string) => void }) {
  const paid = order.paymentStatus ? order.paymentStatus === 'pago' : order.status === 'Pago';
  return <EditorModal title={`Ficha de produção · ${order.id}`} onClose={onClose} closeLabel="Fechar ficha de produção" doneLabel="Fechar ficha" footerText="Os dados da arte e do formato são os salvos na compra. Confira pagamento e arquivos antes de produzir.">
    <div className="space-y-5 text-sm">
      <dl className="grid gap-3 rounded-xl border border-gray-800 p-4 sm:grid-cols-2">
        <div><dt className="text-xs text-gray-400">Cliente</dt><dd className="break-words">{order.clienteNome || 'Não informado'} · {order.clienteEmail || ''}</dd></div>
        <div><dt className="text-xs text-gray-400">Contato</dt><dd>{order.clienteTelefone || 'Não informado'}</dd></div>
        <div><dt className="text-xs text-gray-400">Pagamento</dt><dd className={paid ? 'text-green-400' : 'text-amber-400'}>{paid ? 'Confirmado' : 'Aguardando confirmação — não iniciar produção'}</dd></div>
        <div><dt className="text-xs text-gray-400">Etapa</dt><dd>{fulfillmentStatusLabel(order.fulfillmentStatus || legacyFulfillmentStatus(order.status, order.paymentStatus))}</dd></div>
        <div><dt className="text-xs text-gray-400">Entrega</dt><dd>{order.metodoEntrega === 'retirada' ? 'Retirada na loja' : order.metodoEntrega === 'entrega' ? 'Envio ao cliente' : 'Não informada'}</dd></div>
        {order.enderecoEntrega && <div><dt className="text-xs text-gray-400">Destino</dt><dd>{order.enderecoEntrega.rua}, {order.enderecoEntrega.numero} {order.enderecoEntrega.complemento || ''} · {order.enderecoEntrega.bairro} · {order.enderecoEntrega.cidade}/{order.enderecoEntrega.estado} · {order.enderecoEntrega.cep}</dd></div>}
      </dl>
      {order.itens.map(item => <section key={item.id} className="space-y-3 rounded-xl border border-gray-800 p-4">
        <h3 className="font-bold">{item.quantidade} × {item.nome}</h3>
        <p className="break-words text-xs text-gray-300">{Object.entries(item.selecoes).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'Sem variações selecionadas'}</p>
        <p>{item.printProfile ? printProfileLabel(item.printProfile) : 'Formato não cadastrado na compra — conferir com a gráfica.'}</p>
        {item.printProfile && <p className="text-xs text-gray-400">Meta de resolução: {item.printProfile.targetDpi} dpi. Cada face usa o formato acima.</p>}
        <p className="text-xs">{item.modeloPath ? item.contracapaPath ? 'Capa e contracapa' : 'Somente capa' : 'Sem modelo composto — conferir arte original'}</p>
        {item.personalizacaoTexto && <p className="whitespace-pre-wrap break-words text-sm">Texto: {item.personalizacaoTexto.texto}</p>}
        <p className={item.aprovacaoArte ? 'text-xs text-green-400' : 'text-xs text-amber-400'}>{item.aprovacaoArte ? `Arte aprovada pelo cliente em ${new Date(item.aprovacaoArte.acceptedAt).toLocaleString('pt-BR')}` : 'Sem registro de aprovação da arte — conferir antes de produzir.'}</p>
        {item.aprovacaoArte && <p className="break-all text-[10px] text-gray-500">Versão aprovada: {item.aprovacaoArte.designFingerprint}</p>}
        {canOpenFiles && item.modeloPath && <button type="button" onClick={() => onOpenModel(order.id, item.id)} className="rounded-lg bg-pink-500 px-4 py-2 text-xs font-bold">Conferir arquivos de produção</button>}
      </section>)}
    </div>
  </EditorModal>;
}
