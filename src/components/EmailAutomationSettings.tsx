import React from "react";
import type { EmailAutomationEvent, EmailAutomationRule } from "../lib/email";

const labels: Record<EmailAutomationEvent, string> = {
  product: "Novo produto",
  promotion: "Nova promoção ativa",
  coupon: "Novo cupom ativo",
};
const input = "mt-1 block w-full rounded-lg border border-gray-700 bg-black p-2";

function AutomationRuleForm({
  rule,
  onSave,
}: {
  rule: EmailAutomationRule;
  onSave: (value: EmailAutomationRule) => Promise<void>;
}) {
  const [draft, setDraft] = React.useState(rule);
  return (
    <form className="space-y-3 rounded-xl border border-gray-800 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(draft);
      }}>
      <h3 className="font-semibold">{labels[rule.event]}</h3>
      <p className="text-xs text-gray-400">
        {rule.event === "product" ? "Novidades e informativos" : "Promoções"}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.enabled}
          onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
        Ativar {labels[rule.event].toLowerCase()}
      </label>
      <label className="block text-sm">
        Assunto da automação
        <input className={input} value={draft.subject} maxLength={160} required
          onChange={(event) => setDraft({ ...draft, subject: event.target.value })} />
      </label>
      <label className="block text-sm">
        Mensagem da automação
        <textarea className={input} rows={3} value={draft.text} maxLength={10000} required
          onChange={(event) => setDraft({ ...draft, text: event.target.value })} />
      </label>
      <button type="submit" disabled={JSON.stringify(draft) === JSON.stringify(rule)}
        className="rounded-lg border border-gray-700 px-4 py-2 text-sm disabled:opacity-50">
        Salvar automação
      </button>
    </form>
  );
}

export default function EmailAutomationSettings({
  rules,
  onSave,
}: {
  rules: EmailAutomationRule[];
  onSave: (value: EmailAutomationRule) => Promise<void>;
}) {
  return (
    <details className="rounded-xl border border-gray-800 p-4">
      <summary className="cursor-pointer font-bold">Automações de marketing</summary>
      <p className="my-3 text-sm text-gray-400">
        Ao salvar um novo cadastro com um gatilho ativo, a campanha entra na fila.
        Use <code>{"{{nome}}"}</code> para o nome do cadastro e <code>{"{{codigo}}"}</code> nas mensagens de cupom.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {rules.map((rule) => (
          <div key={`${rule.event}:${rule.revision}`}>
            <AutomationRuleForm rule={rule} onSave={onSave} />
          </div>
        ))}
      </div>
    </details>
  );
}
