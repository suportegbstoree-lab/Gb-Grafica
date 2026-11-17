import { useEffect, useState } from 'react';
import { missingNfeIssuerFields, NFE_ADDRESS_FIELDS, NFE_TAX_REGIMES, type NfeDefaultsConfig, type NfeIssuer, type NfeSalesRule } from '../lib/nfe';
import { nfeAdminApi, type NfeAdminApi } from '../services/nfeService';
import EditorModal from './EditorModal';
import { nfeFieldClass } from './NfeProductFields';

const rules = [['intrastate', 'Entrega dentro do estado'], ['interstate', 'Entrega para outro estado']] as const;
const codeFields = [['cfop', 'CFOP', 4], ['icmsCode', 'CST ou CSOSN do ICMS', 3]] as const;

export default function NfeDefaultsEditor({ onClose, api = nfeAdminApi }: { onClose: () => void; api?: NfeAdminApi }) {
  const [config, setConfig] = useState<NfeDefaultsConfig>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api.defaults(undefined, controller.signal).then(value => {
      if (!controller.signal.aborted) setConfig(value);
    }).catch((reason: Error) => {
      if (!controller.signal.aborted) setError(reason.message);
    });
    return () => controller.abort();
  }, [api]);

  function updateRule(key: typeof rules[number][0], field: keyof NfeSalesRule, value: string) {
    setConfig(current => current && ({
      ...current, defaults: { ...current.defaults, [key]: { ...current.defaults[key], [field]: value } },
    }));
  }

  function updateIssuer(patch: Partial<NfeIssuer>) {
    setConfig(current => current && ({ ...current, issuer: { ...current.issuer, ...patch } }));
  }

  async function consultCep() {
    if (!config || busy) return;
    setBusy(true);
    setError('');
    try {
      const address = await api.address(config.issuer.address.cep);
      updateIssuer({ address: {
        ...config.issuer.address, ...address,
        rua: address.rua || config.issuer.address.rua,
        bairro: address.bairro || config.issuer.address.bairro,
      } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível consultar o CEP.');
    } finally { setBusy(false); }
  }

  async function save() {
    if (!config || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.defaults({ ...config, defaults: { ...config.defaults, issuerState: config.issuer.address.estado } });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar os padrões.');
    } finally { setBusy(false); }
  }

  const missing = config ? missingNfeIssuerFields(config.issuer) : [];

  return <EditorModal title="Configuração de NF-e" busy={busy} onClose={onClose} closeLabel="Fechar configuração de NF-e" doneLabel="Voltar" footerText=""
    footerActions={<button type="submit" form="nfe-defaults-form" disabled={busy || !config}
      className="rounded-lg bg-pink-600 px-4 py-2 text-sm font-bold hover:bg-pink-700 disabled:opacity-40">Salvar configuração fiscal</button>}>
    <p className="text-sm text-gray-400">Use os dados fiscais confirmados pela contabilidade. Você pode salvar a configuração em etapas.</p>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-950 p-3 text-sm text-red-200">{error}</p>}
    {!config && !error && <p role="status" className="mt-3 text-sm text-gray-400">Carregando padrões…</p>}
    {config && <form id="nfe-defaults-form" className="mt-5" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="space-y-4">
        <fieldset className="space-y-4 rounded-xl border border-gray-800 p-4">
          <legend className="px-2 font-semibold">Dados do emitente</legend>
          {missing.length > 0 && <p className="text-sm text-amber-200">Campos a preencher: {missing.join(', ')}.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-gray-300">Razão social
              <input className={nfeFieldClass} maxLength={60} value={config.issuer.legalName}
                onChange={event => updateIssuer({ legalName: event.target.value })} />
            </label>
            <label className="text-sm text-gray-300">CNPJ
              <input className={nfeFieldClass} maxLength={24} value={config.issuer.cnpj}
                onChange={event => updateIssuer({ cnpj: event.target.value })} />
            </label>
            <label className="text-sm text-gray-300">Inscrição estadual
              <input className={nfeFieldClass} maxLength={20} value={config.issuer.stateRegistration}
                onChange={event => updateIssuer({ stateRegistration: event.target.value })} />
            </label>
            <label className="text-sm text-gray-300">Regime tributário (CRT)
              <select className={nfeFieldClass} value={config.issuer.taxRegime}
                onChange={event => updateIssuer({ taxRegime: NFE_TAX_REGIMES.find(([code]) => code === event.target.value)?.[0] ?? '' })}>
                <option value="">Selecione o regime</option>
                {NFE_TAX_REGIMES.map(([code, label]) => <option key={code} value={code}>{code} · {label}</option>)}
              </select>
            </label>
          </div>
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-semibold">Endereço fiscal</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {NFE_ADDRESS_FIELDS.map(([key, label, maxLength]) => <label key={key} className="text-sm text-gray-300">{label}
                <input className={nfeFieldClass} maxLength={maxLength} value={config.issuer.address[key] ?? ''}
                  onChange={event => updateIssuer({ address: {
                    ...config.issuer.address,
                    ...(['cep', 'estado', 'cidade'].includes(key) ? { cityCode: '' } : {}),
                    [key]: key === 'estado' ? event.target.value.toUpperCase() : event.target.value,
                  } })} />
              </label>)}
            </div>
            <button type="button" disabled={!config.issuer.address.cep} onClick={() => void consultCep()}
              className="rounded-lg border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800 disabled:opacity-40">Consultar CEP do emitente</button>
          </fieldset>
        </fieldset>
        <div>
          <h3 className="font-semibold">Padrões para vendas</h3>
          <p className="my-2 text-sm text-gray-400">Os códigos abaixo são sugeridos para entregas a pessoas físicas sem inscrição estadual informada, conforme a UF de destino.</p>
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
