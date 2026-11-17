import React from 'react';
import { Link } from 'react-router-dom';
import { customerApi, type CustomerApi } from '../services/customerService';
import { EMPTY_PROFILE, type CustomerProfile as Profile } from '../lib/customerProfile';
import type { Order } from '../types';
import { formatCpf, formatMoney } from '../lib/commerce';
import { orderItems } from '../lib/bundles';
import { EMPTY_NFE_RECIPIENT, NFE_RECIPIENT_FIELDS } from '../lib/nfe';
import CustomerOrderDetails from './CustomerOrderDetails';
const personalFields = [['fullName', 'Nome completo'], ['phone', 'Telefone para contato'], ['cpf', 'CPF']] as const;
const addressFields = [
  ['cep', 'CEP'], ['street', 'Rua'], ['number', 'Número'], ['complement', 'Complemento'],
  ['neighborhood', 'Bairro'], ['city', 'Cidade'], ['state', 'Estado (UF)'],
] as const;
const inputClass = 'mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900';
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
    [profileState, setProfileState] = React.useState<'loading' | 'ready' | 'error'>('loading'),
    [ordersState, setOrdersState] = React.useState<'loading' | 'ready' | 'error'>('loading'),
    [lookupBusy, setLookupBusy] = React.useState(false),
    [error, setError] = React.useState(''),
    [message, setMessage] = React.useState(''),
    [busy, setBusy] = React.useState(false);
  const activeUid = React.useRef<string | undefined>(uid);
  React.useEffect(() => {
    activeUid.current = uid;
    let active = true;
    setProfile(EMPTY_PROFILE);
    setOrders([]);
    setDetail(null);
    setProfileState('loading');
    setOrdersState('loading');
    setLookupBusy(false);
    setError('');
    setMessage('');
    setBusy(false);
    if (uid) {
      void api.profile().then(p => {
        if (!active) return;
        setProfile({ ...p, cpf: formatCpf(p.cpf) });
        setProfileState('ready');
      }).catch(() => { if (active) setProfileState('error'); });
      void api.orders().then(rows => {
        if (!active) return;
        setOrders(rows.filter(order => order.userId === uid));
        setOrdersState('ready');
      }).catch(() => { if (active) setOrdersState('error'); });
    }
    return () => {
      active = false;
      activeUid.current = undefined;
    };
  }, [api, uid]);
  async function consultCep() {
    if (!uid || lookupBusy || busy) return;
    const cep = profile.cep.trim().replace('-', '');
    if (!/^\d{8}$/.test(cep)) {
      setError('Informe um CEP válido.');
      return;
    }
    setLookupBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.lookupAddress(cep);
      if (activeUid.current !== uid) return;
      setProfile(current => ({
        ...current, ...result,
        street: result.street || current.street,
        neighborhood: result.neighborhood || current.neighborhood,
      }));
    } catch (reason) {
      if (activeUid.current === uid) setError(reason instanceof Error ? reason.message : 'Não foi possível consultar o CEP.');
    } finally {
      if (activeUid.current === uid) setLookupBusy(false);
    }
  }

  function field([key, label]: typeof personalFields[number] | typeof addressFields[number]) {
    return <label key={key} className="text-sm text-gray-600">
      {label}
      <input value={profile[key]} maxLength={key === 'state' ? 2 : key === 'cpf' ? 14 : key === 'cep' ? 9 : 160}
        inputMode={key === 'cpf' || key === 'cep' ? 'numeric' : key === 'phone' ? 'tel' : undefined}
        onChange={event => {
          const value = event.target.value;
          setProfile(current => ({ ...current, [key]: key === 'cpf' ? formatCpf(value) : key === 'state' ? value.toUpperCase() : value }));
        }}
        autoComplete={key === 'fullName' ? 'name' : key === 'phone' ? 'tel' : key === 'cep' ? 'postal-code' : 'off'}
        className={inputClass} />
    </label>;
  }

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
      {profileState === 'loading' && <p>Carregando seus dados…</p>}
      {profileState === 'error' && <p role="alert" className="text-red-600">Não foi possível carregar seus dados. Atualize a página para tentar novamente.</p>}
      {profileState === 'ready' && (
        <form
          className="space-y-5 rounded-3xl border border-gray-100 bg-white p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || lookupBusy) return;
            const savingUid = uid;
            setBusy(true);
            setError('');
            setMessage('');
            void api
              .saveProfile(profile)
              .then((p) => {
                if (activeUid.current !== savingUid) return;
                setProfile({ ...p, cpf: formatCpf(p.cpf) });
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
          <fieldset disabled={busy || lookupBusy} className="space-y-4">
            <legend className="mb-3 text-lg font-bold">Dados pessoais</legend>
            <div className="grid gap-4 sm:grid-cols-3">{personalFields.map(field)}</div>
            <p className="text-xs text-gray-500">
              O CPF pode ser salvo na conta para preencher o pagamento e a nota fiscal nas próximas compras.
            </p>
          </fieldset>
          <fieldset disabled={busy || lookupBusy} className="space-y-4 border-t border-gray-100 pt-2">
            <legend className="pr-3 text-lg font-bold">Endereço de entrega</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">{field(addressFields[0])}</div>
                <button type="button" onClick={() => void consultCep()} disabled={!profile.cep.trim()}
                  className="shrink-0 rounded-xl border border-gray-200 px-3 py-3 text-sm font-bold hover:border-pink-500 disabled:opacity-50">
                  {lookupBusy ? 'Consultando…' : 'Buscar CEP'}
                </button>
              </div>
              {addressFields.slice(1).map(field)}
            </div>
          </fieldset>
          <fieldset disabled={busy || lookupBusy} className="space-y-3 border-t border-gray-100 pt-2">
            <legend className="pr-3 text-lg font-bold">Dados da nota fiscal</legend>
            <p className="text-xs text-gray-500">Por padrão, usamos os dados do pagador. Você pode salvar outro destinatário para as próximas compras e trocar no carrinho.</p>
            {profile.fiscalRecipient ? <>
              <div className="grid gap-4 sm:grid-cols-3">
                {NFE_RECIPIENT_FIELDS.map(([key, label, maxLength]) => <label key={key} className="text-sm text-gray-600">
                  {label}
                  <input value={profile.fiscalRecipient?.[key] ?? ''} maxLength={maxLength} className={inputClass}
                    onChange={event => {
                      const value = event.target.value;
                      setProfile(current => current.fiscalRecipient
                        ? { ...current, fiscalRecipient: { ...current.fiscalRecipient, [key]: value } }
                        : current);
                    }} />
                </label>)}
              </div>
              <button type="button" onClick={() => setProfile(current => ({ ...current, fiscalRecipient: null }))}
                className="rounded-lg px-3 py-2 text-sm font-bold text-pink-600 hover:bg-pink-50">Usar dados do pagador</button>
            </> : <button type="button" onClick={() => setProfile(current => ({ ...current, fiscalRecipient: EMPTY_NFE_RECIPIENT }))}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold hover:border-pink-500">Salvar outro destinatário</button>}
          </fieldset>
          <button disabled={busy || lookupBusy} className="rounded-xl bg-pink-500 px-5 py-3 font-bold text-white hover:bg-pink-600 disabled:opacity-50">
            {busy ? 'Salvando...' : 'Salvar meus dados'}
          </button>
        </form>
      )}
      <section className="space-y-4">
        <h2 className="text-xl font-black text-gray-900">Histórico de compras</h2>
        {ordersState === 'loading' && <p>Carregando seu histórico…</p>}
        {ordersState === 'error' && <p role="alert" className="text-red-600">Não foi possível carregar seu histórico de compras.</p>}
        {ordersState === 'ready' && !orders.length && <p>Você ainda não possui pedidos.</p>}
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
    </section>
  );
}
