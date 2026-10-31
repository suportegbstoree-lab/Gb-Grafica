import { activityActor } from './staffActivity.js';
import { activitySummary, ACTIVITY_LABELS, type StaffActivity } from '../lib/staffActivity.js';
import { staffRoleName } from '../lib/staffAccess.js';
import express from "express";
import type { getAdminServices } from "./firebaseAdmin.js";
import {
  validStaffAccess,
  validStaffRole,
  staffRecordMatches,
} from "../lib/staffAccess.js";
import { adminAccessRecordAllows } from "../lib/adminAccess.js";
import {
  boundedText,
  csvRows,
  localToday,
  OperationsError,
  productionTotals,
  validateProduction,
  validDay,
  type ProductionEntry,
} from "../lib/operations.js";
import { saveProduction } from "./productionEntries.js";
type Services = ReturnType<typeof getAdminServices>;
type Dependencies = {
  authorize: (req: express.Request) => Promise<{ uid: string; name?: unknown; email?: unknown; admin?: unknown }>;
  services: () => Services;
};
const collections = {
  activity: "_operationsActivity",
} as const;
const idPattern = /^[a-f0-9-]{36}$/;

async function people(services: Services) {
  const { db, auth } = services;
  const [admins, staff, roles, profiles] = await Promise.all([
    db.collection("_adminAccess").limit(1001).get(),
    db.collection("_staffAccess").limit(1001).get(),
    db.collection("_staffRoles").get(),
    db.collection("_staffProfiles").limit(1001).get(),
  ]);
  const names = new Map(profiles.docs.map(doc => [doc.id, doc.data().name]));
  const policies = new Map(roles.docs.map((doc) => [doc.id, doc.data()]));
  const ids = [
    ...new Set([...admins.docs, ...staff.docs].map((doc) => doc.id)),
  ].slice(0, 1000);
  const accounts = [];
  for (let offset = 0; offset < ids.length; offset += 100)
    accounts.push(
      ...(
        await auth.getUsers(
          ids.slice(offset, offset + 100).map((uid) => ({ uid })),
        )
      ).users,
    );
  const roots = new Map(admins.docs.map((doc) => [doc.id, doc.data()])),
    employees = new Map(staff.docs.map((doc) => [doc.id, doc.data()]));
  return accounts.flatMap((account) => {
    const claims = account.customClaims || {},
      record = employees.get(account.uid);
    const root =
      claims.admin === true &&
      adminAccessRecordAllows(roots.get(account.uid), claims);
    const policy = validStaffAccess(record)
      ? policies.get(record.roleId)
      : null;
    const enabled =
      !account.disabled &&
      (root ||
        (staffRecordMatches(record, claims) &&
          validStaffRole(policy) &&
          policy.enabled));
    return enabled
      ? [
          {
            id: account.uid,
            name: String(names.get(account.uid) || account.displayName || account.email || account.uid),
            email: account.email || "",
            role: root
              ? "Administrador"
              : staffRoleName(record!.roleId, policy || undefined),
          },
        ]
      : [];
  });
}
function range(query: express.Request["query"]) {
  const end = String(query.end || localToday());
  if (!validDay(end)) throw new OperationsError("Data final inválida.");
  const start = String(
    query.start ||
      new Date(Date.parse(end) - 29 * 86400_000).toISOString().slice(0, 10),
  );
  if (
    !validDay(start) ||
    !validDay(end) ||
    start > end ||
    end > localToday() ||
    (Date.parse(end) - Date.parse(start)) / 86400_000 > 365
  )
    throw new OperationsError("Selecione um período válido de até 366 dias.");
  const page = Number(query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
    throw new OperationsError("Página inválida.");
  return { start, end, page };
}
export function createOperationsRouter(deps: Dependencies) {
  const router = express.Router();
  router.use((req, res, next) => {
    void deps
      .authorize(req)
      .then((actor) => {
        res.locals.actor = actor.uid;
        res.locals.user = actor;
        next();
      })
      .catch(next);
  });
  const route = (
    method: "get" | "post",
    path: string,
    fn: (
      req: express.Request,
      res: express.Response,
      services: Services,
    ) => Promise<void>,
  ) =>
    router[method](path, (req, res, next) => {
      void fn(req, res, deps.services()).catch(next);
    });
  route("get", "/people", async (_req, res, services) => {
    res.json({ people: await people(services) });
  });
  route("get", "/production", async (req, res, { db }) => {
    const filters = range(req.query),
      period = Date.parse(filters.end) - Date.parse(filters.start) + 86400_000;
    const previousStart = new Date(Date.parse(filters.start) - period)
      .toISOString()
      .slice(0, 10);
    const query = await db
      .collection("_productionEntries")
      .where("date", ">=", previousStart)
      .where("date", "<=", filters.end)
      .orderBy("date")
      .limit(10001)
      .get();
    const all = query.docs
      .slice(0, 10000)
      .map((doc) => ({ id: doc.id, ...doc.data() })) as Array<
      ProductionEntry & { id: string; cancelledAt?: string }
    >;
    const selected = all.filter(
      (row) =>
        (!req.query.employee || row.employeeId === req.query.employee) &&
        (!req.query.unit || row.unit === req.query.unit) &&
        (!req.query.service ||
          row.service
            .toLocaleLowerCase()
            .includes(String(req.query.service).toLocaleLowerCase())),
    );
    const current = selected.filter((row) => row.date >= filters.start),
      active = current.filter((row) => !row.cancelledAt);
    const visible = req.query.cancelled === "true" ? current : active;
    if (req.query.format === "csv") {
      res
        .attachment("producao.csv")
        .type("text/csv")
        .send(
          csvRows([
            [
              "ID",
              "Data",
              "Funcionário",
              "Serviço",
              "Unidade",
              "Concluídas",
              "Retrabalhos",
              "Perdas",
              "Motivo",
              "Referência",
              "Observação",
              "Cancelado",
            ],
            ...visible.map((row) => [
              row.id,
              row.date,
              row.employeeId,
              row.service,
              row.unit,
              row.completed,
              row.rework,
              row.loss,
              row.reason,
              row.reference,
              row.notes,
              row.cancelledAt || "",
            ]),
          ]),
        );
      return;
    }
    const daily = [...new Set(active.map((row) => row.date))]
      .sort()
      .map((date) => ({
        date,
        totals: productionTotals(active.filter((row) => row.date === date)),
      }));
    const byEmployee = [...new Set(active.map((row) => row.employeeId))].map(
      (employeeId) => ({
        employeeId,
        totals: productionTotals(
          active.filter((row) => row.employeeId === employeeId),
        ),
      }),
    );
    res.json({
      records: visible.slice((filters.page - 1) * 50, filters.page * 50),
      count: visible.length,
      page: filters.page,
      totals: productionTotals(active),
      previous: productionTotals(
        selected.filter((row) => row.date < filters.start && !row.cancelledAt),
      ),
      daily,
      byEmployee,
      truncated: query.size > 10000,
    });
  });
  route("get", "/production/:id", async (req, res, { db }) => {
    if (!idPattern.test(req.params.id))
      throw new OperationsError("Lançamento inválido.");
    const ref = db.collection("_productionEntries").doc(req.params.id),
      data = (await ref.get()).data();
    if (!data) throw new OperationsError("Lançamento não encontrado.", 404);
    const history = await ref
      .collection("history")
      .orderBy("at", "desc")
      .limit(100)
      .get();
    res.json({
      record: { id: req.params.id, ...data },
      history: history.docs.map((doc) => doc.data()),
      historyTruncated: history.size === 100,
    });
  });
  route("post", "/production", async (req, res, services) => {
    const entry = validateProduction(
      req.body,
      (await people(services)).map((person) => person.id),
    );
    res.json(
      await saveProduction(
        services.db,
        String(req.body.requestId),
        entry,
        res.locals.actor,
        undefined, undefined, await activityActor(services.db, res.locals.user),
      ),
    );
  });
  route("post", "/production/:id", async (req, res, services) => {
    if (!idPattern.test(req.params.id))
      throw new OperationsError("Lançamento inválido.");
    const old = (
      await services.db
        .collection("_productionEntries")
        .doc(req.params.id)
        .get()
    ).data();
    if (!old) throw new OperationsError("Lançamento não encontrado.", 404);
    if (!Number.isSafeInteger(req.body.version))
      throw new OperationsError("Versão inválida.");
    const cancellation =
      req.body.cancel === true
        ? boundedText(req.body.reason, "Motivo do cancelamento", 500, true)
        : undefined;
    const entry = cancellation
      ? (old as ProductionEntry)
      : validateProduction(
          req.body,
          (await people(services)).map((person) => person.id),
          String(old.employeeId),
        );
    res.json(
      await saveProduction(
        services.db,
        req.params.id,
        entry,
        res.locals.actor,
        req.body.version,
        cancellation,
        await activityActor(services.db, res.locals.user),
      ),
    );
  });
  for (const kind of ["activity"] as const)
    route("get", `/${kind}`, async (req, res, { db }) => {
      const filters = range(req.query),
        query = await db
          .collection(collections[kind])
          .where(
            "at",
            ">=",
            new Date(`${filters.start}T00:00:00-03:00`).toISOString(),
          )
          .where(
            "at",
            "<=",
            new Date(`${filters.end}T23:59:59.999-03:00`).toISOString(),
          )
          .orderBy("at", "desc")
          .limit(10001)
          .get();
      const rows = query.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter(
          (row: any) => !req.query.employee || row.actor === req.query.employee,
        );
      if (req.query.format === "csv") {
        res
          .attachment(`${kind}.csv`)
          .type("text/csv")
          .send(
            csvRows([
              ["Data", "Autor", "Ação/código", "Registro"],
              ...rows.map((row: any) => [
                row.at,
                row.actorName || row.actor,
                ACTIVITY_LABELS[row.action] || row.action || row.code,
                row.entityId || "",
              ]),
            ]),
          );
        return;
      }
      const clipped = rows.slice(0, 10000);
      res.json({
        summary: activitySummary(clipped as StaffActivity[]),
        records: clipped.slice((filters.page - 1) * 50, filters.page * 50),
        count: clipped.length,
        page: filters.page,
        truncated: query.size > 10000,
      });
    });
  router.use((_req, res) => { res.status(404).json({ error: 'Página de operações não encontrada.' }); });
  router.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        error instanceof OperationsError
          ? error.status
          : typeof (error as any)?.status === "number"
            ? (error as any).status
            : 500;
      res
        .status(status >= 400 && status <= 599 ? status : 500)
        .json({
          error:
            status >= 500
              ? "Não foi possível concluir a operação."
              : error instanceof Error
                ? error.message
                : "Acesso negado.",
        });
    },
  );
  return router;
}
