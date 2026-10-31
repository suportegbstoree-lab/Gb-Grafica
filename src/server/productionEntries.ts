import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { OperationsError, type ProductionEntry } from "../lib/operations.js";
export async function saveProduction(
  db: Firestore,
  id: string,
  entry: ProductionEntry,
  actor: string,
  version?: number,
  cancellation?: string,
  actorInfo?: { actorName: string; actorRole: string },
) {
  if (!/^[a-f0-9-]{36}$/.test(id))
    throw new OperationsError("Identificador do lançamento inválido.");
  const ref = db.collection("_productionEntries").doc(id),
    hash = createHash("sha256")
      .update(JSON.stringify({ ...entry, actor }))
      .digest("hex");
  return db.runTransaction(async (transaction) => {
    const old = (await transaction.get(ref)).data();
    if (version === undefined && old) {
      if (old.submissionHash === hash && old.createdBy === actor)
        return { id, ...old };
      throw new OperationsError(
        "Este formulário já foi enviado com outros valores.",
        409,
      );
    }
    if (
      version !== undefined &&
      (!old || old.version !== version || old.cancelledAt)
    )
      throw new OperationsError(
        "O lançamento mudou. Atualize antes de salvar.",
        409,
      );
    const now = new Date().toISOString(),
      action = cancellation ? "cancelled" : old ? "corrected" : "created";
    const next = {
      ...(old || {}),
      ...(cancellation ? {} : entry),
      version: Number(old?.version || 0) + 1,
      createdAt: old?.createdAt || now,
      createdBy: old?.createdBy || actor,
      updatedAt: now,
      updatedBy: actor,
      submissionHash: old?.submissionHash || hash,
      ...(cancellation
        ? { cancelledAt: now, cancellationReason: cancellation }
        : {}),
    };
    transaction.set(ref, next);
    transaction.create(ref.collection("history").doc(String(next.version)), {
      before: old || null,
      after: next,
      actor,
      action,
      at: now,
    });
    transaction.create(
      db.collection("_operationsActivity").doc(`${id}-${next.version}`),
      { ...actorInfo, actor, action: `production.${action}`, entityId: id, at: now },
    );
    return { id, ...next };
  });
}
