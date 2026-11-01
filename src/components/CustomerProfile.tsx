import React from 'react';
import { Link } from 'react-router-dom';
import { customerApi, type CustomerApi } from '../services/customerService';
import { EMPTY_PROFILE, type CustomerProfile as Profile } from '../lib/customerProfile';
import type { Order } from '../types';
import { formatMoney } from '../lib/commerce';
import { orderItems } from '../lib/bundles';
import CustomerOrderDetails from './CustomerOrderDetails';
const names: Record<string, string> = {
  fullName: 'Nome completo',
  phone: 'Telefone para contato',
  cpf: 'CPF',
  cep: 'CEP',
  street: 'Rua',
  number: 'Número',
  complement: 'Complemento',
  neighborhood: 'Bairro',
  city: 'Cidade',
  state: 'Estado (UF)',
};
export default function CustomerProfile({
  uid,
  email,
  api = customerApi,
  onSaved,
}: {
  uid?: string;
  email?: string | null;
  api?: CustomerApi;
  onSaved?: (profile: Profile) => void;
}) {
  const [profile, setProfile] = React.useState<Profile>(EMPTY_PROFILE),
    [orders, setOrders] = React.useState<Order[]>([]),
    [detail, setDetail] = React.useState<string | null>(null),
    [ready, setReady] = React.useState(false),
    [error, setError] = React.useState(''),
    [message, setMessage] = React.useState(''),
    [busy, setBusy] = React.useState(false);
  const activeUid = React.useRef<string | undefined>(uid);
  React.useEffect(() => {
    activeUid.current = uid;
    let active = true;
    setProfile(EMPTY_PROFILE);
    setOrders([]);
    setReady(false);
    setError('');
    setMessage('');
    setBusy(false);
    if (uid)
      void Promise.all([api.profile(), api.orders()])
        .then(([p, rows]) => {
          if (active) {
            setProfile(p);
            setOrders(rows.filter((o) => o.userId === uid));
            setReady(true);
          }
        })
        .catch((e) => {
          if (active) {
            setError(e.message);
            setReady(true);
          }
        });
    return () => {
      active = false;
      activeUid.current = undefined;
    };
  }, [api, uid]);
  if (!uid)
    return (
      <section className="rounded-3xl bg-white p-8">
        <h1 className="text-2xl font-black">Minha conta</h1>
        <p className="mt-4">Entre pela loja para consultar seus dados e pedidos.</p>
        <Link to="/" className="mt-4 inline-block text-pink-600">
          Voltar para a loja
        </Link>
      </section>
    );
  return (
    <section className="mx-auto max-w-6xl space-y-8">
      <header>
        <h1 className="text-3xl font-black text-gray-900">Minha conta</h1>
        <p className="mt-2 break-all text-sm text-gray-500">{email}</p>
      </header>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-green-700">
          {message}
        </p>
      )}
      {!ready ? (
        <p>Carregando seus dados...</p>
      ) : (
        <>
          <form
            className="space-y-5 rounded-3xl border border-gray-100 bg-white p-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              const savingUid = uid;
              setBusy(true);
              setError('');
              setMessage('');
              void api
                .saveProfile(profile)
                .then((p) => {
                  if (activeUid.current !== savingUid) return;
                  setProfile(p);
                  onSaved?.(p);
                  setMessage('Dados pessoais salvos. Eles serão usados para preencher as próximas compras.');
                })
                .catch((e) => {
                  if (activeUid.current === savingUid) setError(e.message);
                })
                .finally(() => {
                  if (activeUid.current === savingUid) setBusy(false);
                });
            }}
          >
            <h2 className="text-lg font-bold">Dados pessoais e endereço de entrega</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {Object.entries(names).map(([key, label]) => (
                <label key={key} className="text-sm text-gray-600">
                  {label}
                  <input
                    value={(profile as any)[key] || ''}
                    maxLength={key === 'state' ? 2 : 160}
                    onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
                    autoComplete={
                      key === 'fullName' ? 'name' : key === 'phone' ? 'tel' : key === 'cep' ? 'postal-code' : 'off'
                    }
                    className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900"
                  />
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500">
              Você pode deixar dados incompletos e preenchê-los ao comprar. Nome, CPF, telefone e endereço informados
              serão validados.
            </p>
            <button disabled={busy} className="rounded-xl bg-pink-500 px-5 py-3 font-bold text-white">
              {busy ? 'Salvando...' : 'Salvar meus dados'}
            </button>
          </form>
          <section className="space-y-4">
            <h2 className="text-xl font-black text-gray-900">Histórico de compras</h2>
            {!orders.length && <p>Você ainda não possui pedidos.</p>}
            {orders.map((order) => (
              <article key={order.id} className="space-y-3 rounded-2xl border border-gray-100 bg-white p-5">
                <div className="flex flex-wrap justify-between gap-3">
                  <h3 className="font-bold text-gray-900">{order.id}</h3>
                  <span className="text-sm">{formatMoney(order.total)}</span>
                </div>
                <p className="text-sm text-gray-500">
                  {new Date(order.data).toLocaleDateString('pt-BR')} ·{' '}
                  {order.paymentStatus === 'pago' ? 'Pagamento confirmado' : order.paymentStatus || order.status} ·{' '}
                  {order.status}
                </p>
                <button
                  onClick={() => setDetail(detail === order.id ? null : order.id)}
                  className="text-sm font-bold text-purple-600"
                >
                  {detail === order.id ? 'Fechar detalhes' : 'Ver detalhes do pedido'}
                </button>
                {detail === order.id && <CustomerOrderDetails order={order} />}
                {order.paymentStatus === 'pago' && (
                  <div className="flex flex-wrap gap-3">
                    {[...new Map(orderItems(order.itens).map((i) => [i.productId, i])).values()].map((item) => (
                      <Link
                        key={item.productId}
                        to={`/produto/${encodeURIComponent(item.productId)}?pedido=${encodeURIComponent(order.id)}#avaliacoes`}
                        className="text-xs font-bold text-pink-600"
                      >
                        Avaliar {item.nome}
                      </Link>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </section>
        </>
      )}
    </section>
  );
}
