import React from 'react';
import { Link } from 'react-router-dom';
import { Loader2, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { loginWithGoogle, logout } from '../firebase';
import type { StaffAccessState } from '../services/staffAccessClient';

interface Props {
  user: { email: string | null } | null;
  ready: boolean;
  allowed: boolean;
  issue?: StaffAccessState['issue'];
  diagnostic?: StaffAccessState['diagnostic'];
  children: React.ReactNode;
  onSignIn?: () => Promise<unknown>;
  onSignOut?: () => Promise<unknown>;
  onRetry?: () => void;
}
export default function PanelAccessGate({ user, ready, allowed, issue, diagnostic, children, onSignIn = loginWithGoogle, onSignOut = logout, onRetry = () => window.location.reload() }: Props) {
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  if (ready && allowed) return <>{children}</>;
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return; setBusy(true); setError('');
    try { await action(); } catch { setError('Não foi possível atualizar a sessão. Tente novamente e confirme a conta Google selecionada.'); }
    finally { setBusy(false); }
  };
  const needsSignIn = !user || issue !== 'unavailable';
  const title = !ready ? 'Verificando acesso ao painel' : !user ? 'Entrar no painel da equipe' : issue === 'unavailable' ? 'Não foi possível verificar seu acesso' : issue === 'sign-in-required' ? 'Entre novamente para atualizar seu acesso' : 'Esta conta não possui uma seção liberada';
  return <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
    <section aria-labelledby="panel-access-title" className="w-full max-w-lg space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-center gap-3 text-pink-600"><ShieldCheck size={24} /><span className="font-bold">GB Gráfica · Equipe</span></div>
      <h1 id="panel-access-title" className="text-xl font-black text-gray-900">{title}</h1>
      {user && <p className="break-all text-sm text-gray-600">Conta conectada: <strong>{user.email || 'E-mail não informado'}</strong></p>}
      {!ready ? <p role="status" className="flex items-center gap-2 text-sm text-gray-600"><Loader2 size={18} className="animate-spin" />Carregando sua função e as permissões...</p> : <>
        <p className="text-sm leading-relaxed text-gray-600">{issue === 'unavailable' ? 'Tente verificar novamente. Se continuar, peça ao administrador para conferir a configuração de acesso da loja.' : (!user || issue === 'sign-in-required') ? 'Use o mesmo login Google da loja e o e-mail ao qual o administrador atribuiu a função. Uma sessão anterior à alteração precisa de uma nova entrada.' : 'O administrador precisa atribuir uma função e liberar pelo menos uma seção para este e-mail. O nome da função não libera outras áreas.'}</p>
        {diagnostic && <div role="note" className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
          <p>Falha em: <strong>{{ 'session-token': 'sessão Firebase', 'staff-registry': 'registro da função', 'staff-policy': 'permissões da função' }[diagnostic.source]}</strong>.</p>
          <p>Código: <code className="break-all font-bold">{diagnostic.code}</code></p>
          {diagnostic.code === 'permission-denied' && <p>A leitura foi recusada pelo Firestore. Peça ao administrador para conferir as regras publicadas e a proteção App Check do Firestore.</p>}
          {diagnostic.code === 'missing-or-invalid-record' && <p>O registro retornado ao navegador está ausente ou inválido. Peça ao administrador para conferir o projeto, banco e cadastro da função.</p>}
        </div>}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy} onClick={() => needsSignIn ? void run(onSignIn) : onRetry()} className="flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"><LogIn size={16} />{busy ? 'Aguarde...' : needsSignIn ? user ? 'Entrar novamente' : 'Entrar com Google' : 'Verificar acesso novamente'}</button>
          {user && <button type="button" disabled={busy} onClick={() => void run(onSignOut)} className="flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-3 text-sm font-bold text-gray-700 disabled:opacity-50"><LogOut size={16} />Trocar conta</button>}
        </div>
      </>}
      <Link to="/" className="inline-block text-sm font-bold text-pink-600">Voltar para a loja</Link>
    </section>
  </main>;
}
