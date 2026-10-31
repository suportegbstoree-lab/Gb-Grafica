import React from 'react';
import { STAFF_PERMISSIONS, STAFF_ROLE_LABELS, type StaffRoleView, type StaffOverview, type AssignedRole, type StaffPermission } from '../lib/staffAccess';
import { staffAdministrationApi, type StaffAdministrationApi } from '../services/staffService';

export default function StaffManagement({ api = staffAdministrationApi }: { api?: StaffAdministrationApi }) {
  const [overview, setOverview] = React.useState<StaffOverview | null>(null);
  const [email, setEmail] = React.useState(''), [role, setRole] = React.useState<AssignedRole>('designer');
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [message, setMessage] = React.useState('');
  const [notification, setNotification] = React.useState<{ id?: string; status: string } | null>(null);
  const dirtyRoles = React.useRef(new Set<string>());
  const alive = React.useRef(true), sequence = React.useRef(0);
  const reload = React.useCallback(async () => {
    const request = ++sequence.current;
    const value = await api.load();
    if (alive.current && request === sequence.current) setOverview(current => ({ ...value, roles: value.roles.map(role => dirtyRoles.current.has(role.id) ? current?.roles.find(previous => previous.id === role.id) || role : role) }));
  }, [api]);
  React.useEffect(() => { alive.current = true; void reload().catch(reason => { if (alive.current) setError(reason.message); }); return () => { alive.current = false; sequence.current++; }; }, [reload]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return; setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar os acessos.'); }
    finally { if (alive.current) setBusy(false); }
  };
  const save = async (value: StaffRoleView) => run(async () => {
    await api.saveRole(value.id, value.permissions, value.configured ? value.revision : null);
    dirtyRoles.current.delete(value.id);
    await reload(); if (alive.current) setMessage('Permissões da função atualizadas. As regras passam a usar a nova configuração.');
  });
  const assign = async (targetEmail: string, targetRole: AssignedRole) => run(async () => {
    const result = await api.assign(targetEmail, targetRole);
    if (alive.current) { setNotification(result.notification); setMessage(result.changed ? 'Função atualizada. A pessoa deve sair e entrar novamente para renovar a sessão.' : 'Esta conta já possui a função selecionada.'); setEmail(''); }
    await reload();
  });
  const changePermission = (id: string, permission: StaffPermission, checked: boolean) => { dirtyRoles.current.add(id); setOverview(current => current && ({ ...current, roles: current.roles.map(value => {
    if (value.id !== id) return value;
    const permissions = new Set(value.permissions);
    if (checked) { permissions.add(permission); if (permission === 'orders.artwork' || permission === 'orders.fulfillment') permissions.add('orders.read'); }
    else { permissions.delete(permission); if (permission === 'orders.read') { permissions.delete('orders.artwork'); permissions.delete('orders.fulfillment'); } }
    return { ...value, permissions: STAFF_PERMISSIONS.map(item => item.id).filter(item => permissions.has(item)) };
  }) })); };
  return <section className="max-w-5xl space-y-6">
    <header><h2 className="text-2xl font-bold">Funcionários e permissões</h2><p className="mt-2 text-sm text-gray-400">Atribua funções a contas já cadastradas na loja. Administradores mantêm acesso completo e gerenciam as permissões das funções de funcionário.</p></header>
    {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-300">{message}</p>}
    {notification && notification.status !== 'unchanged' && <div role="status" className="rounded-xl border border-gray-700 p-4 text-xs text-gray-300">
      {notification.status === 'accepted' ? 'O serviço de e-mail aceitou o aviso para envio.' : notification.status === 'not_configured' ? 'Acesso atualizado; o aviso está pendente porque o envio de e-mail não foi configurado.' : 'Acesso atualizado; o aviso por e-mail está pendente.'}
      {notification.id && notification.status !== 'accepted' && <button type="button" disabled={busy} onClick={() => void run(async () => { const value = await api.retryNotification(notification.id!); if (alive.current) setNotification({ id: notification.id, ...value }); })} className="ml-3 font-bold text-pink-400 disabled:opacity-40">Tentar enviar aviso</button>}
    </div>}
    {!overview ? <p role="status">Carregando funções...</p> : <fieldset disabled={busy} className="min-w-0 space-y-6">
      {!overview.emailConfigured && <p className="text-xs text-amber-300">O envio de avisos por e-mail precisa ser configurado na hospedagem da loja.</p>}
      {Boolean(overview.notifications?.length) && <section className="space-y-3 rounded-xl border border-amber-500/30 p-4"><h3 className="text-sm font-bold">Avisos por e-mail pendentes</h3>{overview.notifications!.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 text-xs"><span className="break-all">{item.email} · {new Date(item.createdAt).toLocaleString('pt-BR')}</span><button type="button" onClick={() => void run(async () => { const value = await api.retryNotification(item.id); if (alive.current) setNotification({ id: item.id, ...value }); await reload(); })} className="font-bold text-pink-400">Reenviar aviso pendente</button></div>)}</section>}
      {dirtyRoles.current.size > 0 && <p className="text-xs text-amber-300">Salve as permissões alteradas antes de atribuir funções.</p>}
      <form onSubmit={event => { event.preventDefault(); void assign(email, role); }} className="grid gap-4 rounded-xl border border-gray-800 bg-[#111111] p-5 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="text-xs text-gray-400">E-mail cadastrado<input type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-700 bg-black px-3 py-3 text-white" /></label>
        <label className="text-xs text-gray-400">Função<select aria-label="Função" value={role} onChange={event => setRole(event.target.value as AssignedRole)} className="mt-2 w-full rounded-lg border border-gray-700 bg-black px-3 py-3 text-white">{Object.entries(STAFF_ROLE_LABELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <button type="submit" disabled={dirtyRoles.current.size > 0} className="self-end rounded-lg bg-pink-500 px-5 py-3 text-sm font-bold">{busy ? 'Atualizando...' : 'Aplicar função'}</button>
      </form>
      <div className="space-y-3"><h3 className="font-bold">Contas com acesso</h3>{overview.members.map(member => <div key={member.uid} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 p-4 text-sm">
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{member.email}{!member.enabled && <span className="ml-2 text-amber-400">Conta desativada</span>}</span>
        <select disabled={dirtyRoles.current.size > 0} aria-label={`Função de ${member.email}`} value={member.role} onChange={event => void assign(member.email, event.target.value as AssignedRole)} className="max-w-full rounded-lg border border-gray-700 bg-black px-3 py-2">{Object.entries(STAFF_ROLE_LABELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      </div>)}{overview.truncated && <p className="text-xs text-amber-300">A lista mostra até 200 contas. Use o e-mail cadastrado para alterar outra conta.</p>}</div>
      <div className="grid gap-5 lg:grid-cols-2">{overview.roles.map(value => <section key={value.id} className="space-y-4 rounded-xl border border-gray-800 bg-[#111111] p-5">
        <h3 className="font-bold">{STAFF_ROLE_LABELS[value.id]}</h3>{!value.enabled && <p className="text-xs text-amber-300">Função bloqueada. Confira e salve as permissões para concluir a configuração.</p>}
        <div className="space-y-3">{STAFF_PERMISSIONS.map(permission => <label key={permission.id} className="flex items-start gap-3 text-sm text-gray-300"><input type="checkbox" checked={value.permissions.includes(permission.id)} onChange={event => changePermission(value.id, permission.id, event.target.checked)} aria-label={`${STAFF_ROLE_LABELS[value.id]}: ${permission.label}`} className="mt-1 shrink-0" /><span>{permission.label}</span></label>)}</div>
        <button type="button" onClick={() => void save(value)} className="rounded-lg bg-purple-500 px-4 py-3 text-xs font-bold">Salvar permissões de {STAFF_ROLE_LABELS[value.id]}</button>
      </section>)}</div>
    </fieldset>}
  </section>;
}
