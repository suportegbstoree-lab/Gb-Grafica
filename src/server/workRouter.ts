import express from "express";
import { randomUUID, createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import {
  changeWorkday,
  workDay,
  workdayMilliseconds,
  reportingRange,
  WORK_KINDS,
  type Workday,
} from "../lib/work.js";
import { workdayId } from "./workTracking.js";
import { activityActor } from "./staffActivity.js";
import { ACTIVITY_LABELS } from "../lib/staffActivity.js";
import { OperationsError, csvRows } from "../lib/operations.js";
export interface WorkActor {
  uid: string;
  admin?: boolean;
  name?: unknown;
  email?: unknown;
  permissions?: readonly string[];
}
export interface WorkDependencies {
  db: () => Firestore;
  authorize: (req: express.Request) => Promise<WorkActor>;
  limit?: (key: string, count: number, ms: number) => void;
  now?: () => number;
}
export function createWorkRouter(deps: WorkDependencies) {
  const router = express.Router(),
    clock = () => deps.now?.() ?? Date.now();
  router.use((req, res, next) => {
    void deps
      .authorize(req)
      .then((actor) => {
        res.locals.user = actor;
        res.setHeader("Cache-Control", "private, no-store");
        deps.limit?.(`work:${actor.uid}`, 120, 60000);
        next();
      })
      .catch(next);
  });
  const route = (
    method: "get" | "post",
    path: string,
    handler: (req: express.Request, res: express.Response) => Promise<void>,
  ) =>
    router[method](path, (req, res, next) => {
      void handler(req, res).catch(next);
    });
  route("get", "/day", async (_req, res) => {
    const uid = res.locals.user.uid,
      day = (
        await deps
          .db()
          .collection("_workdays")
          .doc(workdayId(uid, workDay(clock())))
          .get()
      ).data();
    res.json({
      day: day || null,
      workedMs: day ? workdayMilliseconds(day as Workday, clock()) : 0,
    });
  });
  route("post", "/day", async (req, res) => {
    const action = req.body?.action;
    if (!["open", "resume", "break", "return", "close"].includes(action))
      throw new OperationsError("Ação de expediente inválida.");
    const uid = res.locals.user.uid,
      now = clock(),
      db = deps.db(),
      ref = db.collection("_workdays").doc(workdayId(uid, workDay(now)));
    let value: Workday;
    const who = await activityActor(db, res.locals.user);
    await db.runTransaction(async (tx) => {
      const old = (await tx.get(ref)).data();
      try {
        value = changeWorkday(old as Workday | undefined, uid, action, now);
      } catch (e) {
        throw new OperationsError((e as Error).message, 409);
      }
      value = { ...value!, name: who.actorName, role: who.actorRole };
      tx.set(ref, value!);
    });
    res.json({ day: value!, workedMs: workdayMilliseconds(value!, now) });
  });
  route("post", "/tasks", async (req, res) => {
    const { kind, reference = "" } = req.body || {};
    if (
      !WORK_KINDS.includes(kind) ||
      typeof reference !== "string" ||
      !/^[A-Za-z0-9_-]{0,128}$/.test(reference)
    )
      throw new OperationsError("Atividade inválida.");
    const user = res.locals.user as WorkActor,
      permissions = user.permissions || [];
    const permitted =
      user.admin ||
      (kind === "product"
        ? permissions.some((p) =>
            [
              "products.manage",
              "products.images",
              "products.personalization",
            ].includes(p),
          )
        : kind === "category"
          ? permissions.includes("categories.manage")
          : kind === "promotion"
            ? permissions.includes("promotions.manage")
            : kind === "settings"
              ? permissions.some((p) =>
                  [
                    "settings.manage",
                    "branding.manage",
                    "fonts.manage",
                  ].includes(p),
                )
              : kind === "document"
                ? permissions.includes("documents.generate")
                : permissions.includes("orders.read"));
    if (!permitted)
      throw new OperationsError("Sua função não permite esta atividade.", 403);
    const id = randomUUID().replaceAll("-", ""),
      now = clock(),
      who = await activityActor(deps.db(), user);
    await deps
      .db()
      .collection("_workTasks")
      .doc(id)
      .create({
        uid: user.uid,
        ...who,
        kind,
        reference,
        status: "active",
        startedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 7 * 86400000).toISOString(),
      });
    res.status(201).json({ id });
  });
  route("post", "/tasks/:id/cancel", async (req, res) => {
    if (!/^[a-f0-9]{32}$/.test(req.params.id))
      throw new OperationsError("Atividade inválida.");
    const db = deps.db(),
      ref = db.collection("_workTasks").doc(req.params.id);
    await db.runTransaction(async (tx) => {
      const value = (await tx.get(ref)).data();
      if (!value || value.uid !== res.locals.user.uid)
        throw new OperationsError("Atividade não encontrada.", 404);
      if (value.status === "active")
        tx.set(
          ref,
          { status: "cancelled", cancelledAt: new Date(clock()).toISOString() },
          { merge: true },
        );
    });
    res.json({ saved: true });
  });
  route("get", "/report", async (req, res) => {
    const db = deps.db(),
      actor = res.locals.user as WorkActor;
    if (
      !actor.admin &&
      !actor.permissions?.some((p) =>
        ["operations.manage", "operations.self"].includes(p),
      )
    )
      throw new OperationsError(
        "Sua função não permite consultar produtividade.",
        403,
      );
    const period = String(req.query.period || "month");
    if (!["day", "week", "month"].includes(period))
      throw new OperationsError("Período inválido.");
    const { start, end } = reportingRange(period, clock());
    const employee = actor.admin ? String(req.query.employee || "") : actor.uid;
    if (!actor.admin && req.query.employee && req.query.employee !== actor.uid)
      throw new OperationsError(
        "Você pode consultar somente suas próprias atividades.",
        403,
      );
    let activityQuery = db
      .collection("_operationsActivity")
      .where("at", ">=", `${start}T03:00:00.000Z`)
      .where(
        "at",
        "<=",
        `${new Date(Date.parse(end) + 86400000).toISOString().slice(0, 10)}T02:59:59.999Z`,
      );
    if (employee) activityQuery = activityQuery.where("actor", "==", employee);
    const snapshot = await activityQuery
      .orderBy("at", "desc")
      .limit(10001)
      .get();
    const records = snapshot.docs
      .slice(0, 10000)
      .map((doc) => ({ id: doc.id, ...doc.data() }) as any);
    let dayQuery = db
      .collection("_workdays")
      .where("day", ">=", start)
      .where("day", "<=", end);
    if (employee) dayQuery = dayQuery.where("uid", "==", employee);
    const daySnapshot = await dayQuery.orderBy("day").limit(10001).get();
    const days = daySnapshot.docs
        .slice(0, 10000)
        .map((doc) => doc.data() as unknown as Workday)
        .filter((day) => !employee || day.uid === employee),
      summary = new Map<string, any>(),
      daily = new Map<string, number>();
    for (const row of records) {
      const person = summary.get(row.actor) || {
        id: row.actor,
        name: row.actorName || row.actor,
        role: row.actorRole || "",
        completed: 0,
        workedMs: 0,
        days: 0,
        incompleteDays: 0,
      };
      person.completed++;
      summary.set(row.actor, person);
      const day = workDay(Date.parse(row.completedAt || row.at));
      daily.set(day, (daily.get(day) || 0) + 1);
    }
    for (const day of days) {
      const person = summary.get(day.uid) || {
          id: day.uid,
          name: day.name || day.uid,
          role: day.role || "",
          completed: 0,
          workedMs: 0,
          days: 0,
          incompleteDays: 0,
        },
        duration = workdayMilliseconds(day, clock());
      person.days++;
      if (duration === null) person.incompleteDays++;
      else person.workedMs += duration;
      summary.set(day.uid, person);
    }
    const employees = [...summary.values()]
      .map((p) => ({
        ...p,
        averagePerDay: p.days ? p.completed / p.days : null,
        averagePerHour:
          p.workedMs > 0 && !p.incompleteDays
            ? p.completed / (p.workedMs / 3600000)
            : null,
      }))
      .sort((a, b) => b.completed - a.completed);
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
      throw new OperationsError("Página inválida.");
    if (req.query.format === "csv") {
      res
        .attachment("atividades-producao.csv")
        .type("text/csv")
        .send(
          csvRows([
            [
              "Funcionário",
              "Cargo",
              "Serviço",
              "Início",
              "Conclusão",
              "Pedido / lote",
              "Duração (segundos)",
              "Medição",
            ],
            ...records.map((row) => [
              row.actorName || row.actor,
              row.actorRole || "",
              ACTIVITY_LABELS[row.action] || row.action,
              row.startedAt || row.at,
              row.completedAt || row.at,
              row.reference || row.entityId,
              row.durationMs == null ? "" : row.durationMs / 1000,
              row.timing || "legacy",
            ]),
          ]),
        );
      return;
    }
    res.json({
      period,
      start,
      end,
      fullAdmin: actor.admin === true,
      employees,
      days: [...daily]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count })),
      generatedDocuments: records.filter(
        (row) => row.action === "document.generated",
      ).length,
      workdays: days.map((day) => ({
        ...day,
        workedMs: workdayMilliseconds(day, clock()),
      })),
      records: records.slice((page - 1) * 50, page * 50),
      count: records.length,
      page,
      truncated: snapshot.size > 10000 || daySnapshot.size > 10000,
    });
  });
  const errors: express.ErrorRequestHandler = (error, _req, res, _next) => {
    const status =
      error instanceof OperationsError
        ? error.status
        : typeof error?.status === "number"
          ? error.status
          : 500;
    res.status(status).json({
      error:
        status < 500
          ? error.message
          : "Não foi possível consultar as atividades.",
    });
  };
  router.use(errors);
  return router;
}
