import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '../lib/commerce';
import {
  NFE_SIMULATION_SCENARIOS, type NfeSimulationPhase, type NfeSimulationRequest, type NfeSimulationScenario,
  type NfeSimulationView,
} from '../lib/nfeSimulation';
import type { NfeAdminApi } from '../services/nfeService';
import EditorModal from './EditorModal';
import { nfeFieldClass } from './NfeProductFields';

const phases: Record<NfeSimulationPhase, string> = {
  draft: 'Aguardando conferência', reviewed: 'Rascunho conferido', processing: 'Em processamento',
  uncertain: 'Resposta pendente após timeout', authorized: 'Autorização simulada',
  rejected: 'Rejeição simulada', canceled: 'Cancelamento simulado',
};
const button = 'rounded-lg border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800 disabled:opacity-40';
const primary = 'rounded-lg bg-pink-600 px-4 py-2 text-sm font-bold hover:bg-pink-700 disabled:opacity-40';

export default function NfeSimulationEditor({ api, onClose }: { api: NfeAdminApi; onClose: () => void }) {
  const [view, setView] = useState<NfeSimulationView>();
  const [scenario, setScenario] = useState<NfeSimulationScenario>('success');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void api.simulation(undefined, controller.signal).then(result => {
      if (!controller.signal.aborted) setView(result);
    }).catch((reason: Error) => {
      if (!controller.signal.aborted) setError(reason.message);
    });
    return () => controller.abort();
  }, [api]);

  async function act(action?: NfeSimulationRequest['action']) {
    if (running.current || (action && (!view?.enabled || needsRefresh))) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      const revision = view?.status.revision ?? null;
      const change: NfeSimulationRequest | undefined = action === 'emit' ? { action, revision, scenario } :
        action ? { action, revision } : undefined;
      setView(await api.simulation(change));
      setNeedsRefresh(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a simulação.');
      setNeedsRefresh(true);
      if (action) {
        try {
          setView(await api.simulation());
          setNeedsRefresh(false);
        } catch {
          // O operador pode tentar consultar o estado persistido novamente.
        }
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const phase = view?.status.phase;
  const waiting = phase === 'processing' || phase === 'uncertain';
  const terminal = phase === 'authorized' || phase === 'rejected' || phase === 'canceled';

  return <EditorModal title="Simulação de NF-e" closeLabel="Fechar simulação de NF-e" footerText="" doneLabel="Fechar"
    busy={busy} onClose={onClose}>
    <div className="space-y-4">
      <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Dados fictícios · ambiente de simulação</p>
      {!view && !error && <p role="status" className="text-sm text-gray-400">Carregando simulação…</p>}
      {view && !view.enabled && <p className="text-sm text-gray-300">
        A simulação está desativada. Configure <code>NFE_ENV=simulacao</code> no servidor para habilitar.
      </p>}
      {error && <p role="alert" className="rounded-lg bg-red-950 p-3 text-sm text-red-200">{error}</p>}
      {view?.enabled && <div className="space-y-4">
        <div className="space-y-1 rounded-xl border border-gray-800 p-4 text-sm">
          <p className="font-semibold">{view.sample.product}</p>
          <p>{view.sample.quantity} unidade · {formatMoney(view.sample.totalCents / 100)}</p>
          <p role="status" className="font-semibold text-pink-200">{phases[view.status.phase]}</p>
          {view.status.attemptId && <p className="break-all text-xs text-gray-400">Tentativa {view.status.attemptId}</p>}
          {phase === 'rejected' && <p className="mt-2 text-sm text-red-200">O cenário de rejeição terminou. Inicie outra simulação para testar um novo envio.</p>}
        </div>
        {phase === 'reviewed' && <label className="block max-w-md text-sm">Cenário
          <select className={nfeFieldClass} value={scenario} disabled={busy || needsRefresh}
            onChange={event => setScenario(NFE_SIMULATION_SCENARIOS.find(([value]) => value === event.target.value)?.[0] ?? 'success')}>
            {NFE_SIMULATION_SCENARIOS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>}
        <div className="flex flex-wrap gap-2">
          {phase === 'draft' && <button className={primary} type="button" disabled={busy || needsRefresh} onClick={() => void act('review')}>Conferir rascunho de teste</button>}
          {phase === 'reviewed' && <button className={primary} type="button" disabled={busy || needsRefresh} onClick={() => void act('emit')}>Simular emissão</button>}
          {waiting && <button className={primary} type="button" disabled={busy || needsRefresh} onClick={() => void act('consult')}>Consultar tentativa</button>}
          {phase === 'authorized' && <button className={button} type="button" disabled={busy || needsRefresh} onClick={() => void act('cancel')}>Simular cancelamento</button>}
          {terminal && <button className={button} type="button" disabled={busy || needsRefresh} onClick={() => void act('reset')}>Nova simulação</button>}
        </div>
      </div>}
      {(needsRefresh || (!view && error)) && <button type="button" disabled={busy} className={button} onClick={() => void act()}>Atualizar situação</button>}
    </div>
  </EditorModal>;
}
