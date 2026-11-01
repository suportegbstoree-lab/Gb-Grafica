import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type express from "express";
import { taskMilliseconds, workDay, type Workday } from "../lib/work.js";
const context = new AsyncLocalStorage<{ id?: string; startedAt: number }>();
export const workRequestContext: express.RequestHandler = (req, _res, next) => {
  const id = req.get("x-work-task");
  context.run(
    {
      ...(id && /^[a-f0-9]{32}$/.test(id) ? { id } : {}),
      startedAt: Date.now(),
    },
    next,
  );
};
export const workdayId = (uid: string, day = workDay()) =>
  `${createHash("sha256").update(uid).digest("hex")}-${day}`;
const kindFor = (action: string) =>
  action.startsWith("product.")
    ? "product"
    : action.startsWith("category.")
      ? "category"
      : action.startsWith("promotion.")
        ? "promotion"
        : action.startsWith("settings.") ||
            action.startsWith("fonts.") ||
            action.startsWith("branding.")
          ? "settings"
          : action.startsWith("document.")
            ? "document"
            : "order";
/** Read all timing state before any transaction writes; only canonical successful server actions complete a task. */
export async function prepareWorkActivity(
  db: Firestore,
  actor: { actor: string; actorName?: string; actorRole?: string },
  action: string,
  entityId: string,
  tx?: Transaction,
  options: {
    taskId?: string;
    reference?: string;
    now?: number;
    id?: string;
  } = {},
) {
  const now = options.now ?? Date.now(),
    at = new Date(now).toISOString(),
    ctx = context.getStore(),
    taskId = options.taskId || ctx?.id,
    id = options.id || randomUUID();
  const ref =
    taskId && /^[a-f0-9]{32}$/.test(taskId)
      ? db.collection("_workTasks").doc(taskId)
      : null;
  const task = ref ? (await (tx ? tx.get(ref) : ref.get())).data() : null;
  const matches =
    task?.uid === actor.actor &&
    task.status === "active" &&
    task.kind === kindFor(action) &&
    (!task.reference || task.reference === entityId) &&
    Date.parse(task.startedAt) <= now &&
    now - Date.parse(task.startedAt) <= 86400000;
  const dayRef = db
      .collection("_workdays")
      .doc(workdayId(actor.actor, workDay(now))),
    day = matches
      ? ((await (tx ? tx.get(dayRef) : dayRef.get())).data() as
          | Workday
          | undefined)
      : undefined;
  const startedAt = matches
    ? task.startedAt
    : new Date(ctx?.startedAt ?? now).toISOString();
  const record = {
    ...actor,
    action,
    entityId,
    at,
    startedAt,
    completedAt: at,
    durationMs: taskMilliseconds(startedAt, at, day),
    timing: matches ? "task" : "request",
    reference: options.reference || entityId,
    source: "automatic",
    ...(matches ? { taskId } : {}),
  };
  return {
    id,
    record,
    write: (target: Transaction) => {
      target.create(db.collection("_operationsActivity").doc(id), record);
      if (matches && ref)
        target.set(
          ref,
          { status: "completed", completedAt: at, activityId: id },
          { merge: true },
        );
    },
  };
}
