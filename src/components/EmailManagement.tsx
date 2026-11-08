import React from "react";
import ConfirmDialog from "./ConfirmDialog";
import EmailCampaignEditor from "./EmailCampaignEditor";
import { emailApi, type EmailApi } from "../services/emailService";
import type {
  EmailCampaign,
  EmailCampaignInput,
  EmailOverview,
} from "../lib/email";
const labels: Record<string, string> = {
  draft: "Rascunho",
  queued: "Na fila",
  completed: "Processamento concluído",
  cancelled: "Cancelada",
};
export default function EmailManagement({
  api = emailApi,
}: {
  api?: EmailApi;
}) {
  const [overview, setOverview] = React.useState<EmailOverview | null>(null),
    [error, setError] = React.useState(""),
    [message, setMessage] = React.useState(""),
    [busy, setBusy] = React.useState(false);
  const [editor, setEditor] = React.useState<EmailCampaign | null | undefined>(
    undefined,
  );
  const [confirmation, setConfirmation] = React.useState<{
    campaign: EmailCampaign;
    action: "queue" | "cancel" | "delete";
  } | null>(null);
  const alive = React.useRef(true),
    working = React.useRef(false);
  const reload = React.useCallback(async () => {
    const data = await api.overview();
    if (alive.current) setOverview(data);
  }, [api]);
  React.useEffect(() => {
    alive.current = true;
    void reload().catch((reason) => {
      if (alive.current) setError(reason.message);
    });
    return () => {
      alive.current = false;
    };
  }, [reload]);
  const run = async (fn: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (reason) {
      if (alive.current) setError((reason as Error).message);
    } finally {
      working.current = false;
      if (alive.current) {
        setBusy(false);
        setConfirmation(null);
      }
    }
  };
  const save = async (value: EmailCampaignInput) => {
    if (editor)
      await api.updateCampaign(editor.id, {
        ...value,
        expectedRevision: editor.revision ?? null,
      });
    else await api.createCampaign(value);
    if (!alive.current) return;
    setEditor(undefined);
    setError("");
    setMessage(
      editor
        ? "Rascunho atualizado. Nenhum e-mail foi enviado."
        : "Rascunho criado. Confira a mensagem antes de iniciar o envio.",
    );
    // A refresh failure must not turn a successful creation into a duplicate retry.
    await reload().catch((reason) => {
      if (alive.current) setError(reason.message);
    });
  };
  const dispatch = async () => {
    let result: Awaited<ReturnType<EmailApi["dispatch"]>> | undefined;
    for (let pass = 0; pass < 20 && alive.current; pass++) {
      result = await api.dispatch();
      await reload();
      if (result.busy || !result.workRemaining) break;
    }
    if (alive.current)
      setMessage(
        result?.busy
          ? "A fila já está sendo processada. Atualize em alguns instantes."
          : "Processamento executado. Itens pendentes continuam na fila para as próximas tentativas.",
      );
  };
  const confirm = async () => {
    if (!confirmation) return;
    const { campaign, action } = confirmation;
    if (action === "delete") {
      await api.deleteCampaign(campaign.id, campaign.revision ?? null);
      if (alive.current) {
        setOverview(
          (current) =>
            current && {
              ...current,
              campaigns: current.campaigns.filter(
                (row) => row.id !== campaign.id,
              ),
            },
        );
        setMessage(
          "Rascunho excluído. A cópia privada será limpa após 7 dias.",
        );
      }
    } else {
      await api.campaignAction(campaign.id, action, campaign.revision ?? null);
      await reload();
      if (action === "queue") await dispatch();
      else setMessage("Campanha cancelada.");
    }
  };
  return (
    <section className="max-w-5xl space-y-6">
      <header>
        <h2 className="text-2xl font-bold">E-mails e campanhas</h2>
        <p className="mt-2 text-sm text-gray-400">
          Boas-vindas e pedidos são automáticos. Campanhas alcançam somente quem
          autorizou o tipo de mensagem.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 p-4 text-red-300">
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="rounded-xl bg-green-500/10 p-4 text-green-300"
        >
          {message}
        </p>
      )}
      {overview && !overview.configured && (
        <p role="status" className="text-amber-300">
          Configure o serviço e o remetente de e-mail na hospedagem. Os avisos
          ficam na fila.
        </p>
      )}
      {overview && !overview.marketingConfigured && (
        <p className="text-sm text-amber-300">
          Campanhas exigem também a configuração do descadastro. Você pode
          preparar rascunhos enquanto isso.
        </p>
      )}
      <fieldset disabled={busy} className="min-w-0 space-y-6">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              setError("");
              setEditor(null);
            }}
            className="rounded-lg bg-pink-500 px-5 py-3 text-sm font-bold"
          >
            Nova campanha
          </button>
          <button
            type="button"
            onClick={() => void run(reload)}
            className="rounded-lg border border-gray-700 px-4 py-3"
          >
            Atualizar campanhas
          </button>
          <button
            type="button"
            onClick={() => void run(dispatch)}
            className="rounded-lg border border-gray-700 px-4 py-3"
          >
            Processar fila agora
          </button>
        </div>
        <p className="text-xs text-gray-400">
          A fila também é processada pelo agendamento do servidor. Aceito
          significa aceito pelo serviço de e-mail; não confirma entrega na caixa
          de entrada.
        </p>
        {!overview ? (
          <p>Carregando campanhas...</p>
        ) : !overview.campaigns.length ? (
          <p className="rounded-xl border border-gray-800 p-5 text-sm text-gray-400">
            Nenhuma campanha criada. Use Nova campanha para preparar seu
            primeiro rascunho.
          </p>
        ) : (
          overview.campaigns.map((campaign) => (
            <article
              key={campaign.id}
              className="min-w-0 space-y-3 rounded-xl border border-gray-800 p-5 [overflow-wrap:anywhere]"
            >
              <h3 className="font-bold">{campaign.subject}</h3>
              <p className="text-sm text-pink-300">
                {campaign.channel === "promotions"
                  ? "Promoções"
                  : "Novidades e informativos"}{" "}
                · {labels[campaign.status] || campaign.status}
              </p>
              <p className="whitespace-pre-wrap text-sm text-gray-300">
                {campaign.text}
              </p>
              <p className="text-xs text-gray-400">
                Na fila: {campaign.queuedCount} · Processados:{" "}
                {campaign.processedCount} · Aceitos: {campaign.acceptedCount} ·
                Ignorados: {campaign.skippedCount} · Revisão necessária:{" "}
                {campaign.reviewCount}
              </p>
              <div className="flex flex-wrap gap-3">
                {campaign.status === "draft" && (
                  <>
                    <button
                      type="button"
                      aria-label={`Editar rascunho ${campaign.subject}`}
                      onClick={() => setEditor(campaign)}
                      className="rounded-lg border border-gray-700 px-4 py-3 text-xs font-bold"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      aria-label={`Excluir rascunho ${campaign.subject}`}
                      onClick={() =>
                        setConfirmation({ campaign, action: "delete" })
                      }
                      className="rounded-lg border border-red-500/50 px-4 py-3 text-xs font-bold text-red-300"
                    >
                      Excluir
                    </button>
                    <button
                      type="button"
                      disabled={!overview.marketingConfigured}
                      onClick={() =>
                        setConfirmation({ campaign, action: "queue" })
                      }
                      className="rounded-lg bg-purple-500 px-4 py-3 text-xs font-bold disabled:opacity-50"
                    >
                      Enviar campanha {campaign.subject}
                    </button>
                  </>
                )}
                {campaign.status === "queued" && (
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmation({ campaign, action: "cancel" })
                    }
                    className="rounded-lg border border-red-500/50 px-4 py-3 text-xs text-red-300"
                  >
                    Cancelar campanha {campaign.subject}
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </fieldset>
      {editor !== undefined && (
        <EmailCampaignEditor
          campaign={editor}
          api={api}
          onSave={save}
          onClose={() => setEditor(undefined)}
        />
      )}
      {confirmation && (
        <ConfirmDialog
          busy={busy}
          title={
            confirmation.action === "queue"
              ? "Enviar campanha"
              : confirmation.action === "delete"
                ? "Excluir rascunho?"
                : "Cancelar campanha"
          }
          message={
            confirmation.action === "queue"
              ? `Enviar “${confirmation.campaign.subject}” para quem autorizou ${confirmation.campaign.channel === "promotions" ? "promoções" : "novidades e informativos"}? A preferência será conferida novamente antes de cada envio.`
              : confirmation.action === "delete"
                ? `Excluir o rascunho “${confirmation.campaign.subject}”? Ele sai da lista agora e sua cópia privada será limpa após 7 dias. Nenhum e-mail será enviado.`
                : `Cancelar “${confirmation.campaign.subject}”? Isso interrompe os próximos envios; mensagens já aceitas pelo serviço não podem ser recolhidas.`
          }
          confirmLabel={
            confirmation.action === "queue"
              ? "Confirmar envio"
              : confirmation.action === "delete"
                ? "Excluir rascunho"
                : "Confirmar cancelamento"
          }
          danger={confirmation.action !== "queue"}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => void run(confirm)}
        />
      )}
    </section>
  );
}
