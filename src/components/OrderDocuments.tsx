import React from "react";
import type { Order } from "../types";
import { auth } from "../firebase";
import { apiFetch } from "../services/apiClient";
import { downloadPersonalization } from "../services/personalizationExport";
const statuses = {
  accepted: "Aceito pelo provedor de e-mail",
  pending: "Na fila de envio",
  not_configured: "Configuração de e-mail pendente",
  needs_review: "Revisão manual necessária",
  unavailable: "Indisponível para este pedido antigo",
};
export default function OrderDocuments({
  order,
  staff = false,
  canRetry = false,
}: {
  order: Order;
  staff?: boolean;
  canRetry?: boolean;
}) {
  const [error, setError] = React.useState(""),
    [busy, setBusy] = React.useState(false),
    [mail, setMail] = React.useState<any[]>([]);
  const request = async (path: string, method = "GET") => {
    if (!auth.currentUser) throw new Error("Sua sessão expirou.");
    const response = await apiFetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
      },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Não foi possível acessar o documento.");
    }
    return response;
  };
  const run = (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    void action()
      .catch((error) => setError(error.message))
      .finally(() => setBusy(false));
  };
  if (!order.etiquetaCriada) return null;
  return (
    <div className="space-y-3 rounded-xl border border-gray-300 p-4 text-sm">
      <p className="font-bold">Ficha inicial do pedido</p>
      <p className="text-xs text-gray-500">
        Criada no recebimento do pedido. O status atual aparece no painel e na
        loja.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          className="rounded-lg border border-gray-500 px-4 py-2"
          onClick={() =>
            run(async () => {
              const response = await request(`/api/orders/${order.id}/label`);
              downloadPersonalization(
                await response.blob(),
                `${order.id}-pedido.pdf`,
              );
            })
          }
        >
          Baixar ficha PDF
        </button>
        {staff && (
          <button
            type="button"
            disabled={busy}
            className="rounded-lg border border-gray-500 px-4 py-2"
            onClick={() =>
              run(async () =>
                setMail(
                  (
                    await (
                      await request(
                        `/api/admin/orders/${order.id}/email-status`,
                      )
                    ).json()
                  ).statuses,
                ),
              )
            }
          >
            Consultar envio por e-mail
          </button>
        )}
        {canRetry && (
          <button
            type="button"
            disabled={busy}
            className="rounded-lg border border-gray-500 px-4 py-2"
            onClick={() =>
              run(async () => {
                await request(
                  `/api/admin/orders/${order.id}/retry-email`,
                  "POST",
                );
                setMail(
                  (
                    await (
                      await request(
                        `/api/admin/orders/${order.id}/email-status`,
                      )
                    ).json()
                  ).statuses,
                );
              })
            }
          >
            Tentar envio pendente
          </button>
        )}
      </div>
      {mail.map((row) => (
        <p key={row.kind}>
          {row.kind === "customer" ? "Cliente" : "Loja"}:{" "}
          {statuses[row.status] || row.status}
        </p>
      ))}
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
