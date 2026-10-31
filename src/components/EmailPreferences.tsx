import React from 'react';
import { emailApi, type EmailApi } from '../services/emailService';
import type { EmailPreferences as Preferences } from '../lib/email';
export default function EmailPreferences({ api = emailApi }: { api?: EmailApi }) {
  const [value, setValue] = React.useState<Preferences | null>(null), [error, setError] = React.useState(''), [message, setMessage] = React.useState(''), [busy, setBusy] = React.useState(false);
  const alive = React.useRef(true);
  const load = React.useCallback(async () => { setError(''); try { const next = await api.preferences(); if (alive.current) setValue(next); } catch (reason) { if (alive.current) setError((reason as Error).message); } }, [api]);
  React.useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  return <form className="space-y-5" onSubmit={event => { event.preventDefault(); if (!value || busy) return; setBusy(true); setError(''); setMessage(''); void api.savePreferences(value).then(next => { if (alive.current) { setValue(next); setMessage('Preferências de e-mail salvas.'); } }).catch(reason => { if (alive.current) setError(reason.message); }).finally(() => { if (alive.current) setBusy(false); }); }}>
    <p className="text-sm">Escolha quais mensagens opcionais quer receber. Avisos de compra e andamento dos seus pedidos continuam separados destas escolhas.</p>
    {error && <p role="alert" className="text-sm text-red-600">{error} <button type="button" onClick={() => void load()} className="underline">Recarregar preferências</button></p>}
    {message && <p role="status" className="text-sm text-green-600">{message}</p>}
    {!value ? <p role="status">Carregando preferências...</p> : <fieldset disabled={busy || !value.emailVerified} className="space-y-5">
      {!value.emailVerified && <p>Confirme o e-mail da sua conta para receber mensagens opcionais.</p>}
      <label className="flex items-start gap-3"><input className="mt-1" type="checkbox" checked={value.promotions} onChange={event => setValue({ ...value, promotions: event.target.checked })} /><span>Receber promoções</span></label>
      <label className="flex items-start gap-3"><input className="mt-1" type="checkbox" checked={value.news} onChange={event => setValue({ ...value, news: event.target.checked })} /><span>Receber novidades e informativos</span></label>
      <p className="text-xs opacity-70">As opções são desmarcadas por padrão. Você pode desativá-las aqui ou pelo link de descadastro nas mensagens.</p>
      <button type="submit" className="rounded-xl bg-[#d14d8c] px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar preferências'}</button>
    </fieldset>}
  </form>;
}
