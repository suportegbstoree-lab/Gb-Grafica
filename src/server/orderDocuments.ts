import { randomUUID } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { Order } from "../types.js";
import { createOrderLabel } from "./productionLabel.js";

const email = (value: unknown): string =>
  typeof value === "string" &&
  value.length <= 254 &&
  /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim())
    ? value.trim()
    : "";
export async function createOrderWithDocuments(
  db: Firestore,
  id: string,
  order: Order,
  merchantEmail: string,
) {
  const bytes = Buffer.from(await createOrderLabel(id, order));
  if (bytes.length > 750_000)
    throw new Error("A etiqueta excedeu o tamanho permitido.");
  const now = Date.now();
  await db.runTransaction(async (transaction) => {
    transaction.create(db.collection("orders").doc(id), {
      ...order,
      etiquetaCriada: true,
    });
    transaction.create(db.collection("_orderDocuments").doc(id), {
      pdf: bytes,
      createdAt: new Date(now).toISOString(),
      userId: order.userId,
    });
    for (const [kind, recipient] of [
      ["customer", email(order.clienteEmail)],
      [
        "merchant",
        email(process.env.ORDER_NOTIFICATION_EMAIL || merchantEmail),
      ],
    ]) {
      transaction.create(db.collection("_orderEmails").doc(`${id}-${kind}`), {
        orderId: id,
        recipient,
        kind,
        status: "pending",
        attempts: 0,
        nextAttemptAt: now,
        createdAt: new Date(now).toISOString(),
      });
    }
  });
}

export type OrderEmailStatus =
  | "pending"
  | "accepted"
  | "not_configured"
  | "needs_review";
export async function sendOrderEmail(
  db: Firestore,
  id: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<OrderEmailStatus> {
  const ref = db.collection("_orderEmails").doc(id),
    nonce = randomUUID();
  const result = await db.runTransaction(async (transaction) => {
    const data = (await transaction.get(ref)).data();
    if (!data) throw new Error("Aviso não encontrado.");
    if (data.status === "accepted" || data.status === "needs_review") {
      if (data.nextAttemptAt !== undefined)
        transaction.update(ref, { nextAttemptAt: FieldValue.delete() });
      return { status: data.status as OrderEmailStatus };
    }
    if (data.lockUntil > now) return { status: "pending" as const };
    const from =
      data.from ||
      email(process.env.ORDER_EMAIL_FROM || process.env.EMAIL_FROM || process.env.STAFF_EMAIL_FROM);
    const recipient =
      email(data.recipient) ||
      (data.kind === "merchant" && !data.firstAttemptAt
        ? email(process.env.ORDER_NOTIFICATION_EMAIL)
        : "");
    const replyTo = data.firstAttemptAt ? email(data.replyTo) : email(process.env.EMAIL_REPLY_TO);
    if (!recipient || !from || !process.env.RESEND_API_KEY?.trim()) {
      transaction.update(ref, {
        status: "not_configured",
        nextAttemptAt: now + 15 * 60_000,
      });
      return { status: "not_configured" as const };
    }
    if (data.firstAttemptAt && now - data.firstAttemptAt > 23 * 60 * 60_000) {
      transaction.update(ref, {
        status: "needs_review",
        nextAttemptAt: FieldValue.delete(),
      });
      return { status: "needs_review" as const };
    }
    transaction.update(ref, {
      from,
      recipient,
      replyTo,
      lockNonce: nonce,
      lockUntil: now + 60_000,
      firstAttemptAt: data.firstAttemptAt || now,
      attempts: Number(data.attempts || 0) + 1,
    });
    return {
      data: {
        from,
        replyTo,
        orderId: String(data.orderId),
        recipient,
        kind: String(data.kind),
      },
    };
  });
  if ("status" in result) return result.status;
  const data = result.data;
  let accepted = false;
  try {
    const document = (
      await db.collection("_orderDocuments").doc(String(data.orderId)).get()
    ).data();
    if (!document?.pdf) throw new Error("Etiqueta indisponível.");
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `order-label-${id}`,
      },
      body: JSON.stringify({
        from: data.from,
        ...(data.replyTo ? { reply_to: data.replyTo } : {}),
        to: [data.recipient],
        subject: `Pedido ${data.orderId} · GB Gráfica`,
        text: `${data.kind === "merchant" ? "Um pedido foi criado" : "Seu pedido foi criado"} na GB Gráfica.\nA ficha inicial está em anexo. Ela não confirma pagamento nem inicia a produção. Confira o andamento na loja.`,
        attachments: [
          {
            filename: `${data.orderId}-pedido.pdf`,
            content: Buffer.from(document.pdf).toString("base64"),
            content_type: "application/pdf",
          },
        ],
      }),
    });
    const body = await response.json().catch(() => null);
    accepted = response.ok && typeof body?.id === "string";
  } catch {
    /* Retain a pending job without leaking provider details. */
  }
  await db.runTransaction(async (transaction) => {
    const latest = (await transaction.get(ref)).data();
    if (latest?.lockNonce === nonce)
      transaction.update(ref, {
        status: accepted ? "accepted" : "pending",
        lockUntil: 0,
        nextAttemptAt: accepted ? FieldValue.delete() : now + 15 * 60_000,
        updatedAt: new Date(now).toISOString(),
      });
  });
  return accepted ? "accepted" : "pending";
}
export async function processOrderEmails(db: Firestore) {
  const jobs = await db
    .collection("_orderEmails")
    .where("nextAttemptAt", "<=", Date.now())
    .orderBy("nextAttemptAt")
    .limit(20)
    .get();
  const results: OrderEmailStatus[] = [];
  for (const job of jobs.docs)
    results.push(
      await sendOrderEmail(db, job.id).catch(() => "pending" as const),
    );
  return results;
}
