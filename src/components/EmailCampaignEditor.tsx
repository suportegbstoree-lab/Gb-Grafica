import React from "react";
import { Loader2 } from "lucide-react";
import EditorModal from "./EditorModal";
import ConfirmDialog from "./ConfirmDialog";
import type { EmailApi } from "../services/emailService";
import type {
  EmailCampaign,
  EmailCampaignInput,
  EmailCampaignPreview,
  EmailChannel,
} from "../lib/email";

function PreviewFrame({ html }: { html: string }) {
  const [url, setUrl] = React.useState("");
  React.useEffect(() => {
    // Blob frames are already allowed by the site's CSP. No scripts, forms or navigation.
    const inert = html.replace(
      /<a\b([^>]*?)\bhref=/g,
      "<a$1data-preview-href=",
    );
    const value = URL.createObjectURL(
      new Blob([inert], { type: "text/html;charset=utf-8" }),
    );
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [html]);
  return url ? (
    <iframe
      title="Prévia da campanha"
      src={url}
      sandbox=""
      referrerPolicy="no-referrer"
      tabIndex={0}
      className="h-[640px] w-full border-0 bg-white"
    />
  ) : null;
}
const inputClass =
  "mt-2 w-full rounded-lg border border-gray-700 bg-black p-3 text-white disabled:opacity-60";
export default function EmailCampaignEditor({
  campaign,
  api,
  onSave,
  onClose,
}: {
  campaign: EmailCampaign | null;
  api: EmailApi;
  onSave: (value: EmailCampaignInput) => Promise<void>;
  onClose: () => void;
}) {
  const [subject, setSubject] = React.useState(campaign?.subject || ""),
    [text, setText] = React.useState(campaign?.text || ""),
    [channel, setChannel] = React.useState<EmailChannel>(
      campaign?.channel || "promotions",
    );
  const [preview, setPreview] = React.useState<EmailCampaignPreview | null>(
      null,
    ),
    [previewError, setPreviewError] = React.useState(""),
    [loading, setLoading] = React.useState(true),
    [retry, setRetry] = React.useState(0);
  const [width, setWidth] = React.useState<"desktop" | "mobile">("desktop"),
    [saving, setSaving] = React.useState(false),
    [error, setError] = React.useState(""),
    [discard, setDiscard] = React.useState(false);
  const pending = React.useRef(false),
    alive = React.useRef(true);
  const fieldsId = React.useId();
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setPreviewError("");
    const timer = window.setTimeout(() => {
      void api
        .previewCampaign({ subject, text, channel }, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setPreview(value);
        })
        .catch((reason) => {
          if (!controller.signal.aborted)
            setPreviewError(
              reason instanceof Error
                ? reason.message
                : "Não foi possível atualizar a prévia.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 700);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [subject, text, channel, api, retry]);
  const dirty =
    subject !== (campaign?.subject || "") ||
    text !== (campaign?.text || "") ||
    channel !== (campaign?.channel || "promotions");
  const close = () => {
    if (pending.current) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave({ subject, text, channel });
    } catch (reason) {
      if (alive.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "Não foi possível salvar o rascunho.",
        );
    } finally {
      pending.current = false;
      if (alive.current) setSaving(false);
    }
  };
  return (
    <>
      <EditorModal
        wide
        title={campaign?.status === "completed" ? "Editar campanha" : campaign ? "Editar rascunho" : "Nova campanha"}
        busy={saving}
        onClose={close}
        closeLabel="Fechar editor de campanha"
        doneLabel="Fechar editor"
        footerText={campaign?.status === "completed"
          ? "As alterações serão usadas no próximo envio."
          : "Salvar mantém a campanha como rascunho. O envio exige uma confirmação separada."}
        footerActions={
          <button
            type="submit"
            form={`${fieldsId}-form`}
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-xl bg-pink-500 px-5 py-3 text-xs font-bold disabled:opacity-50"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {saving
              ? "Salvando..."
              : campaign
                ? "Salvar alterações"
                : "Criar rascunho"}
          </button>
        }
      >
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.65fr)]">
          <form
            id={`${fieldsId}-form`}
            className="min-w-0 space-y-4"
            onSubmit={(event) => void submit(event)}
          >
            <h3 className="text-base font-bold">Conteúdo da campanha</h3>
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300"
              >
                {error}
              </p>
            )}
            <fieldset disabled={saving} className="min-w-0 space-y-4">
              <div>
                <label
                  htmlFor={`${fieldsId}-channel`}
                  className="block text-sm"
                >
                  Tipo de campanha
                </label>
                <select
                  id={`${fieldsId}-channel`}
                  value={channel}
                  onChange={(event) =>
                    setChannel(event.target.value as EmailChannel)
                  }
                  className={inputClass}
                >
                  <option value="promotions">Promoções</option>
                  <option value="news">Novidades e informativos</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor={`${fieldsId}-subject`}
                  className="block text-sm"
                >
                  Assunto
                </label>
                <input
                  id={`${fieldsId}-subject`}
                  required
                  maxLength={160}
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor={`${fieldsId}-text`} className="block text-sm">
                  Mensagem
                </label>
                <textarea
                  id={`${fieldsId}-text`}
                  required
                  maxLength={10000}
                  rows={12}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  className={inputClass}
                />
              </div>
              <p className="text-xs text-gray-400">
                Quebras de linha e links HTTPS aparecem na prévia. O banner, o
                botão da loja e o descadastro são incluídos automaticamente.
              </p>
            </fieldset>
          </form>
          <section
            aria-label="Visualização do e-mail"
            className="min-w-0 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-bold">Prévia do envio</h3>
              <div
                className="flex gap-2"
                role="group"
                aria-label="Tamanho da prévia"
              >
                {(["desktop", "mobile"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={width === value}
                    onClick={() => setWidth(value)}
                    className={`rounded-lg border px-3 py-2 text-xs ${width === value ? "border-pink-400 bg-pink-500/15 text-pink-200" : "border-gray-700 text-gray-300"}`}
                  >
                    {value === "desktop" ? "Desktop" : "Celular"}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1 rounded-lg border border-gray-800 bg-black p-3 text-xs [overflow-wrap:anywhere]">
              <p>
                <span className="text-gray-400">Assunto: </span>
                {subject || "Sem assunto"}
              </p>
              <p>
                <span className="text-gray-400">De: </span>
                {preview?.from || "Remetente não configurado"}
              </p>
              <p>
                <span className="text-gray-400">Respostas: </span>
                {preview?.replyTo || "Mesmo remetente"}
              </p>
            </div>
            {previewError ? (
              <div
                role="alert"
                className="rounded-lg bg-red-500/10 p-4 text-sm text-red-300"
              >
                <p>{previewError}</p>
                <button
                  type="button"
                  onClick={() => setRetry((value) => value + 1)}
                  className="mt-3 rounded-lg border border-red-400 px-3 py-2"
                >
                  Tentar prévia novamente
                </button>
              </div>
            ) : (
              <div
                aria-busy={loading}
                className="relative min-h-[200px] overflow-hidden rounded-lg border border-gray-700 bg-[#f3f3f5]"
              >
                {loading && (
                  <div
                    role="status"
                    className="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2 bg-gray-900/95 p-3 text-xs text-white"
                  >
                    <Loader2 size={14} className="animate-spin" />
                    Atualizando prévia...
                  </div>
                )}
                <div
                  className={`mx-auto max-w-full ${loading ? "pointer-events-none opacity-50" : ""}`}
                  style={{ width: width === "mobile" ? 390 : 640 }}
                >
                  {preview && <PreviewFrame html={preview.html} />}
                </div>
              </div>
            )}
            <p className="text-xs leading-relaxed text-gray-400">
              A prévia usa o mesmo HTML gerado para o envio. O link de
              descadastro é individual. Gmail, Outlook e outros clientes podem
              apresentar pequenas diferenças visuais.
            </p>
          </section>
        </div>
      </EditorModal>
      {discard && (
        <ConfirmDialog
          title="Descartar alterações?"
          message="Há alterações não salvas neste rascunho."
          confirmLabel="Descartar alterações"
          onCancel={() => setDiscard(false)}
          onConfirm={onClose}
          danger
        />
      )}
    </>
  );
}
