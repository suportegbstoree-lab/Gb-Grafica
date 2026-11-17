import { useEffect, useState } from 'react';
import type { NfeDefaultsConfig, NfeSalesRule } from '../lib/nfe';
import { requestNfeDefaults } from '../services/nfeService';
import EditorModal from './EditorModal';
import { nfeFieldClass } from './NfeProductFields';

const rules = [['intrastate', 'Entrega dentro do estado'], ['interstate', 'Entrega para outro estado']] as const;
const codeFields = [['cfop', 'CFOP', 4], ['icmsCode', 'CST ou CSOSN do ICMS', 3]] as const;

export default function NfeDefaultsEditor({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<NfeDefaultsConfig>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void requestNfeDefaults(undefined, controller.signal).then(value => {
      if (!controller.signal.aborted) setConfig(value);
    }).catch((reason: Error) => {
      if (!controller.signal.aborted) setError(reason.message);
    });
    return () => controller.abort();
  }, []);

  function updateRule(key: typeof rules[number][0], field: keyof NfeSalesRule, value: string) {
    setConfig(current => current && ({
      ...current, defaults: { ...current.defaults, [key]: { ...current.defaults[key], [field]: value } },
    }));
  }

  async function save() {
    if (!config || busy) return;
    setBusy(true);
    setError('');
    try {
      await requestNfeDefaults(config);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar os padrões.');
    } finally { setBusy(false); }
  }

  return <EditorModal title="Padrões de NF-e" busy={busy} onClose={onClose} closeLabel="Fechar padrões de NF-e" doneLabel="Voltar" footerText=""
    footerActions={<button type="submit" form="nfe-defaults-form" disabled={busy || !config}
      className="rounded-lg bg-pink-600 px-4 py-2 text-sm font-bold hover:bg-pink-700 disabled:opacity-40">Salvar padrões</button>}>
    <p className="text-sm text-gray-400">Use os dados da contabilidade. Os padrões são sugeridos em novos rascunhos para entregas a pessoas físicas sem inscrição estadual informada, conforme a UF de destino. A classificação de cada produto é cadastrada no catálogo.</p>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-950 p-3 text-sm text-red-200">{error}</p>}
    {!config && !error && <p role="status" className="mt-3 text-sm text-gray-400">Carregando padrões…</p>}
    {config && <form id="nfe-defaults-form" className="mt-5" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <label className="text-sm text-gray-300">UF do emitente
            <input className={nfeFieldClass} maxLength={2} value={config.defaults.issuerState}
              onChange={event => setConfig({ ...config, defaults: { ...config.defaults, issuerState: event.target.value.toUpperCase() } })} />
          </label>
          <label className="text-sm text-gray-300">Natureza da operação
            <input className={nfeFieldClass} maxLength={60} value={config.defaults.operation}
              onChange={event => setConfig({ ...config, defaults: { ...config.defaults, operation: event.target.value } })} />
          </label>
        </div>
        {rules.map(([key, label]) => <fieldset className="grid gap-3 rounded-xl border border-gray-800 p-4 sm:grid-cols-2" key={key}>
          <legend className="px-2 text-sm font-semibold">{label}</legend>
          {codeFields.map(([field, text, max]) => <label key={field} className="text-sm text-gray-300">{text}
            <input className={nfeFieldClass} inputMode="numeric" maxLength={max} value={config.defaults[key][field]}
              onChange={event => updateRule(key, field, event.target.value)} />
          </label>)}
        </fieldset>)}
      </fieldset>
    </form>}
  </EditorModal>;
}
