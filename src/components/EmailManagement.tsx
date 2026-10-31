import React from 'react';
import ConfirmDialog from './ConfirmDialog';
import { emailApi, type EmailApi } from '../services/emailService';
import type { EmailCampaign, EmailChannel, EmailOverview } from '../lib/email';
const labels: Record<string, string> = { draft: 'Rascunho', queued: 'Na fila', completed: 'Processamento concluído', cancelled: 'Cancelada' };
const input = 'mt-2 w-full rounded-lg border border-gray-700 bg-black p-3 text-white';
export default function EmailManagement({ api = emailApi }: { api?: EmailApi }) {
  const [overview, setOverview] = React.useState<EmailOverview | null>(null), [error, setError] = React.useState(''), [message, setMessage] = React.useState(''), [busy, setBusy] = React.useState(false);
  const [subject, setSubject] = React.useState(''), [text, setText] = React.useState(''), [channel, setChannel] = React.useState<EmailChannel>('promotions'), [confirmation, setConfirmation] = React.useState<{ campaign: EmailCampaign; action: 'queue' | 'cancel' } | null>(null);
  const alive = React.useRef(true);
  const reload = React.useCallback(async () => { const data = await api.overview(); if (alive.current) setOverview(data); }, [api]);
  React.useEffect(() => { alive.current = true; void reload().catch(reason => { if (alive.current) setError(reason.message); }); return () => { alive.current = false; }; }, [reload]);
  const run = async (fn: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); setMessage(''); try { await fn(); } catch (reason) { if (alive.current) setError((reason as Error).message); } finally { if (alive.current) { setBusy(false); setConfirmation(null); } } };
  const dispatch = async () => {
    let result: Awaited<ReturnType<EmailApi['dispatch']>> | undefined;
    for (let pass = 0; pass < 20 && alive.current; pass++) { result = await api.dispatch(); await reload(); if (result.busy || !result.workRemaining) break; }
    if (alive.current) setMessage(result?.busy ? 'A fila já está sendo processada. Atualize em alguns instantes.' : 'Processamento executado. Itens pendentes continuam na fila para as próximas tentativas.');
  };
  return <section className="max-w-5xl space-y-6">
    <header><h2 className="text-2xl font-bold">E-mails e campanhas</h2><p className="mt-2 text-sm text-gray-400">Boas-vindas e pedidos são automáticos. Campanhas alcançam somente quem autorizou o tipo de mensagem.</p></header>
    {error && <p role="alert" className="rounded-xl bg-red-500/10 p-4 text-red-300">{error}</p>}{message && <p role="status" className="rounded-xl bg-green-500/10 p-4 text-green-300">{message}</p>}
    {overview && !overview.configured && <p role="status" className="text-amber-300">Configure o serviço e o remetente de e-mail na hospedagem. Os avisos ficam na fila.</p>}
    {overview && !overview.marketingConfigured && <p className="text-sm text-amber-300">Campanhas exigem também a configuração do descadastro. Você pode preparar rascunhos enquanto isso.</p>}
    <fieldset disabled={busy} className="min-w-0 space-y-6">
      <form className="space-y-4 rounded-xl border border-gray-800 p-5" onSubmit={event => { event.preventDefault(); void run(async () => { await api.createCampaign({ channel, subject, text }); setSubject(''); setText(''); await reload(); setMessage('Rascunho criado. Confira a mensagem antes de iniciar o envio.'); }); }}>
        <label className="block text-sm">Tipo de campanha<select value={channel} onChange={event => setChannel(event.target.value as EmailChannel)} className={input}><option value="promotions">Promoções</option><option value="news">Novidades e informativos</option></select></label>
        <label className="block text-sm">Assunto<input required maxLength={160} value={subject} onChange={event => setSubject(event.target.value)} className={input} /></label>
        <label className="block text-sm">Mensagem<textarea required maxLength={10000} rows={7} value={text} onChange={event => setText(event.target.value)} className={input} /></label>
        <p className="text-xs text-gray-400">O envio inclui automaticamente a identificação da loja e o link de descadastro.</p>
        <button type="submit" className="rounded-lg bg-pink-500 px-5 py-3 font-bold">Criar rascunho</button>
      </form>
      <div className="flex flex-wrap gap-3"><button type="button" onClick={() => void run(reload)} className="rounded-lg border border-gray-700 px-4 py-3">Atualizar campanhas</button><button type="button" onClick={() => void run(dispatch)} className="rounded-lg border border-gray-700 px-4 py-3">Processar fila agora</button></div>
      <p className="text-xs text-gray-400">A fila também é processada pelo agendamento do servidor. Aceito significa aceito pelo serviço de e-mail; não confirma entrega na caixa de entrada.</p>
      {!overview ? <p>Carregando campanhas...</p> : overview.campaigns.map(campaign => <article key={campaign.id} className="min-w-0 space-y-3 rounded-xl border border-gray-800 p-5 [overflow-wrap:anywhere]">
        <h3 className="font-bold">{campaign.subject}</h3><p className="text-sm text-pink-300">{campaign.channel === 'promotions' ? 'Promoções' : 'Novidades e informativos'} · {labels[campaign.status] || campaign.status}</p>
        <p className="whitespace-pre-wrap text-sm text-gray-300">{campaign.text}</p>
        <p className="text-xs text-gray-400">Na fila: {campaign.queuedCount} · Processados: {campaign.processedCount} · Aceitos: {campaign.acceptedCount} · Ignorados: {campaign.skippedCount} · Revisão necessária: {campaign.reviewCount}</p>
        <div className="flex flex-wrap gap-3">{campaign.status === 'draft' && <button type="button" disabled={!overview.marketingConfigured} onClick={() => setConfirmation({ campaign, action: 'queue' })} className="rounded-lg bg-purple-500 px-4 py-3 text-xs font-bold disabled:opacity-50">Enviar campanha {campaign.subject}</button>}{['draft', 'queued'].includes(campaign.status) && <button type="button" onClick={() => setConfirmation({ campaign, action: 'cancel' })} className="rounded-lg border border-red-500/50 px-4 py-3 text-xs text-red-300">Cancelar campanha {campaign.subject}</button>}</div>
      </article>)}
    </fieldset>
    {confirmation && <ConfirmDialog busy={busy} title={confirmation.action === 'queue' ? 'Enviar campanha' : 'Cancelar campanha'} message={confirmation.action === 'queue' ? `Enviar “${confirmation.campaign.subject}” para quem autorizou ${confirmation.campaign.channel === 'promotions' ? 'promoções' : 'novidades e informativos'}? A preferência será conferida novamente antes de cada envio.` : `Cancelar “${confirmation.campaign.subject}”? Isso interrompe os próximos envios; mensagens já aceitas pelo serviço não podem ser recolhidas.`} confirmLabel={confirmation.action === 'queue' ? 'Confirmar envio' : 'Confirmar cancelamento'} danger={confirmation.action === 'cancel'} onCancel={() => setConfirmation(null)} onConfirm={() => void run(async () => { await api.campaignAction(confirmation.campaign.id, confirmation.action); await reload(); setConfirmation(null); if (confirmation.action === 'queue') await dispatch(); else setMessage('Campanha cancelada.'); })} />}
  </section>;
}
