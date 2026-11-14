import React from "react";
import { Download, Eye, Link2, Mail, Printer, Trash2, Unlink } from "lucide-react";
import StaffPdfWorkspace from './StaffPdfWorkspace';
import type { StaffPdfQueueProgressValue } from './StaffPdfQueueProgress';
import type { StaffPdfApi } from '../services/staffPdfService';
import type { PersonalizationFont } from "../types";
import EditorModal from "./EditorModal";
import {
  downloadPersonalization,
} from "../services/personalizationExport";
import {
  staffDocumentApi,
  type StaffDocumentApi,
  type StaffDocumentView,
} from "../services/staffDocumentService";
import { workApi, type WorkApi } from "../services/workService";
const iconButton = "rounded-md p-2 text-gray-500 hover:text-[#ff4d79] disabled:opacity-40";
const deleteButton = "rounded-md p-2 text-gray-500 hover:text-red-500 disabled:opacity-40";
const fileActions = [
  { mode: "view", label: "Visualizar", Icon: Eye },
  { mode: "download", label: "Baixar PDF", Icon: Download },
  { mode: "print", label: "Imprimir", Icon: Printer },
] as const;
export default function StaffDocuments({
  fonts,
  api = staffDocumentApi,
  timingApi = workApi,
  canGenerate = true,
  canManageTemplates = false,
  libraryApi,
  visible = true,
  onProgress,
}: {
  fonts: PersonalizationFont[];
  api?: StaffDocumentApi;
  timingApi?: WorkApi;
  canGenerate?: boolean;
  canManageTemplates?: boolean;
  libraryApi?: StaffPdfApi;
  visible?: boolean;
  onProgress?: (value: StaffPdfQueueProgressValue) => void;
}) {
  const [rows, setRows] = React.useState<StaffDocumentView[]>([]),
    [truncated, setTruncated] = React.useState(false),
    [error, setError] = React.useState(""),
    [message, setMessage] = React.useState(""),
    [busy, setBusy] = React.useState(false);
  const [preview, setPreview] = React.useState<{
      title: string;
      url: string;
    } | null>(null),
    [email, setEmail] = React.useState<{
      doc: StaffDocumentView;
      to: string;
      requestId: string;
      status?: string;
    } | null>(null),
    [share, setShare] = React.useState<string | null>(null);
  const alive = React.useRef(true),
    request = React.useRef(0);
  const load = React.useCallback(async () => {
    if (!canGenerate) return;
    const revision = ++request.current;
    const result = await api.list();
    if (alive.current && revision === request.current) {
      setRows(result.documents);
      setTruncated(result.truncated);
    }
  }, [api, canGenerate]);
  React.useEffect(() => {
    alive.current = true;
    void load().catch((e) => {
      if (alive.current) setError(e.message);
    });
    return () => {
      alive.current = false;
      request.current++;
    };
  }, [load]);
  React.useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const file = (
    doc: StaffDocumentView,
    mode: "view" | "download" | "print",
  ) => {
    const popup =
      mode === "print" ? window.open("about:blank", "_blank") : null;
    if (popup) popup.opener = null;
    void run(async () => {
      try {
        const blob = await api.file(doc.id, mode);
        if (mode === "download")
          downloadPersonalization(blob, `${doc.reference}.pdf`);
        else if (mode === "view")
          setPreview({ title: doc.reference, url: URL.createObjectURL(blob) });
        else {
          const url = URL.createObjectURL(blob);
          if (popup) popup.location.replace(url);
          else setPreview({ title: `Imprimir ${doc.reference}`, url });
          setTimeout(() => URL.revokeObjectURL(url), 120000);
          setMessage(
            "PDF aberto no visualizador do navegador. Use o botão de impressão ou Ctrl+P.",
          );
        }
      } catch (e) {
        popup?.close();
        throw e;
      }
    });
  };
  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-2xl font-bold">PDFs internos da equipe</h2>
        <p className="mt-2 text-sm text-gray-400">
          Biblioteca, edição e lotes da equipe. Os novos lotes ficam disponíveis por três dias.
        </p>
      </header>
      <StaffPdfWorkspace fonts={fonts} canGenerate={canGenerate} canManage={canManageTemplates} onGenerated={load} timingApi={timingApi} api={libraryApi} visible={visible} onProgress={onProgress}/>
      {error && (
        <p role="alert" className="rounded-xl bg-red-950 p-4 text-red-200">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-xl bg-green-950 p-4 text-green-200">
          {message}
        </p>
      )}
      {canGenerate && <><div className="flex flex-wrap justify-between gap-3">
        <h3 className="text-lg font-bold">Documentos salvos anteriormente</h3>
        <button
          disabled={busy}
          onClick={() => void run(load)}
          className="rounded-lg border border-gray-700 px-4 py-2 text-sm"
        >
          Atualizar documentos
        </button>
      </div>
      {truncated && (
        <p className="text-sm text-amber-300">
          Exibindo os 100 documentos mais recentes ainda disponíveis.
        </p>
      )}
      <div className="space-y-4">
        {rows.map((doc) => (
          <article
            key={doc.id}
            className="space-y-3 rounded-2xl border border-gray-800 p-5"
          >
            <div className="flex flex-wrap justify-between gap-3">
              <h4 className="break-words font-bold [overflow-wrap:anywhere]">
                {doc.reference} · {doc.outputName ? `${doc.outputName}.pdf` : doc.templateName}
              </h4>
              <span className="text-xs text-gray-400">{doc.ownerName}</span>
            </div>
            <p className="text-xs text-gray-400">
              Gerado em{" "}
              {new Date(doc.completedAt || doc.createdAt).toLocaleString(
                "pt-BR",
              )}{" "}
              · Disponível até {new Date(doc.expiresAt).toLocaleString("pt-BR")}
            </p>
            {doc.status === "ready" ? (
              <div className="flex flex-wrap gap-2">
                {fileActions.map(({ mode, label, Icon }) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={busy}
                    onClick={() => file(doc, mode)}
                    className={iconButton}
                    title={label}
                    aria-label={`${label} ${doc.reference}`}
                  >
                    <Icon size={16} aria-hidden="true" />
                  </button>
                ))}
                <button
                  type="button" title="WhatsApp / copiar link" aria-label={`WhatsApp / copiar link ${doc.reference}`}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setShare(await api.share(doc.id));
                    })
                  }
                  className={iconButton}
                >
                  <Link2 size={16} aria-hidden="true" />
                </button>
                <button
                  type="button" title="Enviar por e-mail" aria-label={`Enviar por e-mail ${doc.reference}`}
                  disabled={busy}
                  onClick={() =>
                    setEmail({ doc, to: "", requestId: crypto.randomUUID() })
                  }
                  className={iconButton}
                >
                  <Mail size={16} aria-hidden="true" />
                </button>
                <button
                  type="button" title="Revogar links" aria-label={`Revogar links ${doc.reference}`}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.revoke(doc.id);
                      setMessage(
                        "Links anteriores deste documento foram revogados.",
                      );
                    })
                  }
                  className={deleteButton}
                >
                  <Unlink size={16} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-amber-300">
                  Geração ainda não finalizada.
                </span>
                <button
                  type="button" title="Descartar geração" aria-label={`Descartar geração ${doc.reference}`}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.cancel(doc.id);
                      await load();
                    })
                  }
                  className={deleteButton}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {!rows.length && (
        <p className="text-sm text-gray-400">
          Nenhum documento salvo disponível.
        </p>
      )}
      {visible && preview && (
        <EditorModal
          title={preview.title}
          onClose={() => setPreview(null)}
          footerText="O PDF mantém o formato original. O visualizador também oferece impressão."
          closeLabel="Fechar PDF"
          doneLabel="Fechar visualização"
        >
          <iframe
            title={`PDF ${preview.title}`}
            src={preview.url}
            className="h-[65vh] w-full rounded-lg bg-white"
          />
        </EditorModal>
      )}
      {visible && share && (
        <EditorModal
          title="Compartilhar PDF"
          onClose={() => setShare(null)}
          footerText="Qualquer pessoa com o link pode abrir o PDF até a expiração. Revogue os links no documento quando necessário."
          closeLabel="Fechar compartilhamento"
          doneLabel="Concluir"
        >
          <div className="space-y-4">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`PDF da GB Gráfica: ${share}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-xl bg-green-700 px-5 py-3 font-bold text-white"
            >
              Compartilhar no WhatsApp
            </a>
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(share)
                  .then(() => setMessage("Link do documento copiado."))
                  .catch(() => setError("Não foi possível copiar o link."))
              }
              className="ml-3 rounded-xl border border-gray-700 px-5 py-3 font-bold"
            >
              Copiar link do PDF
            </button>
          </div>
        </EditorModal>
      )}
      {visible && email && (
        <EditorModal
          title={`Enviar ${email.doc.reference} por e-mail`}
          busy={busy}
          onClose={() => setEmail(null)}
          footerText="O destinatário receberá o PDF ou um link válido até a expiração do documento."
          closeLabel="Fechar envio por e-mail"
          doneLabel="Cancelar"
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const result = await api.email(
                  email.doc.id,
                  email.to,
                  email.requestId,
                );
                if (!alive.current) return;
                setEmail({ ...email, status: result.status });
                setMessage(
                  result.status === "accepted"
                    ? "O serviço de e-mail aceitou o envio."
                    : result.status === "needs_review"
                      ? "Confira o envio no provedor antes de tentar novamente."
                      : "O serviço ainda não confirmou. Tentar confirmar reutiliza a mesma tentativa para evitar duplicidade.",
                );
              });
            }}
          >
            <label className="block text-sm">
              E-mail do destinatário
              <input
                type="email"
                required
                maxLength={254}
                value={email.to}
                disabled={
                  busy ||
                  email.status === "accepted" ||
                  email.status === "needs_review"
                }
                onChange={(e) =>
                  setEmail({
                    ...email,
                    to: e.target.value,
                    requestId: crypto.randomUUID(),
                    status: undefined,
                  })
                }
                className="mt-2 w-full rounded-xl border border-gray-700 bg-black p-3"
              />
            </label>
            <button
              disabled={
                busy ||
                email.status === "accepted" ||
                email.status === "needs_review"
              }
              className="rounded-xl bg-pink-500 px-5 py-3 font-bold text-white disabled:opacity-50"
            >
              {busy
                ? "Enviando..."
                : email.status === "pending"
                  ? "Tentar confirmar envio"
                  : "Enviar PDF por e-mail"}
            </button>
          </form>
        </EditorModal>
      )}
      </>}
    </section>
  );
}
