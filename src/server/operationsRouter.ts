import express from "express";
import { createHash, randomUUID } from "node:crypto";
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
  authorize: (req: express.Request) => Promise<{ uid: string }>;
  services: () => Services;
};
const collections = {
  activity: "_operationsActivity",
  errors: "_operationsErrors",
  machines: "_operationsMachines",
  releases: "_operationsReleases",
} as const;
const idPattern = /^[a-f0-9-]{36}$/;

async function people(services: Services) {
  const { db, auth } = services;
  const [admins, staff, roles] = await Promise.all([
    db.collection("_adminAccess").limit(1001).get(),
    db.collection("_staffAccess").limit(1001).get(),
    db.collection("_staffRoles").get(),
  ]);
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
            name: account.displayName || account.email || account.uid,
            email: account.email || "",
            role: root
              ? "Administrador"
              : record!.roleId === "designer"
                ? "Designer"
                : "Gestor de Produtos",
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
      ),
    );
  });
  for (const kind of ["activity", "errors"] as const)
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
                row.actor,
                row.action || row.code,
                row.entityId || "",
              ]),
            ]),
          );
        return;
      }
      res.json({
        records: rows.slice((filters.page - 1) * 50, filters.page * 50),
        count: rows.length,
        page: filters.page,
        truncated: query.size > 10000,
      });
    });
  for (const kind of ["machines", "releases"] as const)
    route("get", `/${kind}`, async (_req, res, { db }) => {
      const records = await db
        .collection(collections[kind])
        .orderBy("createdAt", "desc")
        .limit(501)
        .get();
      res.json({
        records: records.docs
          .slice(0, 500)
          .map((doc) => ({ id: doc.id, ...doc.data() })),
        truncated: records.size > 500,
      });
    });
  route("get", "/machines/:id", async (req, res, { db }) => {
    if (!idPattern.test(req.params.id))
      throw new OperationsError("Equipamento inválido.");
    const data = (
      await db.collection(collections.machines).doc(req.params.id).get()
    ).data();
    if (!data) throw new OperationsError("Equipamento não encontrado.", 404);
    res.json({ record: { id: req.params.id, ...data } });
  });
  route("post", "/machines/:id", async (req, res, { db }) => {
    const id = req.params.id;
    if (!idPattern.test(id)) throw new OperationsError("Equipamento inválido.");
    const machineId = boundedText(
        req.body.machineId,
        "ID do equipamento",
        64,
        true,
      ),
      name = boundedText(req.body.name, "Nome", 120, true),
      installedVersion = boundedText(
        req.body.installedVersion || "",
        "Versão instalada",
        30,
      );
    const ref = db.collection(collections.machines).doc(id),
      unique = db
        .collection("_operationsMachineIds")
        .doc(createHash("sha256").update(machineId).digest("hex"));
    await db.runTransaction(async (transaction) => {
      const old = (await transaction.get(ref)).data(),
        reserved = (await transaction.get(unique)).data();
      if (old ? old.version !== req.body.version : req.body.version !== 0)
        throw new OperationsError(
          "O equipamento mudou. Atualize a página.",
          409,
        );
      if (reserved && reserved.id !== id)
        throw new OperationsError(
          "Este ID de equipamento já está cadastrado.",
          409,
        );
      const at = new Date().toISOString();
      if (old && old.machineId !== machineId)
        transaction.delete(
          db
            .collection("_operationsMachineIds")
            .doc(
              createHash("sha256").update(String(old.machineId)).digest("hex"),
            ),
        );
      transaction.set(unique, { id });
      transaction.set(ref, {
        name,
        machineId,
        installedVersion,
        authorized: req.body.authorized === true,
        version: Number(old?.version || 0) + 1,
        createdAt: old?.createdAt || at,
        updatedAt: at,
        updatedBy: res.locals.actor,
      });
      transaction.create(
        db.collection(collections.activity).doc(randomUUID()),
        { actor: res.locals.actor, action: "machine.saved", entityId: id, at },
      );
    });
    res.json({ id });
  });
  route("post", "/releases", async (req, res, { db, bucket }) => {
    const version = boundedText(req.body.version, "Versão", 30, true);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/.test(version))
      throw new OperationsError("Versão inválida.");
    const path = String(req.body.path),
      pattern =
        /^operations\/releases\/[a-f0-9-]{36}\/[a-f0-9]{32}\.(zip|exe|msi)$/;
    if (!pattern.test(path))
      throw new OperationsError("Arquivo da versão inválido.");
    const [metadata] = await bucket.file(path).getMetadata(),
      size = Number(metadata.size),
      generation = Number(metadata.generation),
      extension = path.split(".").at(-1);
    if (
      metadata.metadata?.uploadedBy !== res.locals.actor ||
      !Number.isSafeInteger(generation) ||
      size <= 0 ||
      size > 50 * 1024 * 1024
    )
      throw new OperationsError(
        "O arquivo da versão não pertence a este envio.",
      );
    const hash = createHash("sha256");
    let received = 0;
    let header = Buffer.alloc(0);
    for await (const chunk of bucket
      .file(path, { generation })
      .createReadStream()) {
      const bytes = Buffer.from(chunk);
      received += bytes.length;
      if (received > 50 * 1024 * 1024)
        throw new OperationsError("Arquivo muito grande.");
      if (header.length < 8)
        header = Buffer.concat([header, bytes]).subarray(0, 8);
      hash.update(bytes);
    }
    if (
      received !== size ||
      !(extension === "zip"
        ? header[0] === 0x50 && header[1] === 0x4b
        : extension === "exe"
          ? header[0] === 0x4d && header[1] === 0x5a
          : header.toString("hex") === "d0cf11e0a1b11ae1")
    )
      throw new OperationsError(
        "O conteúdo não corresponde ao formato informado.",
      );
    const sha256 = hash.digest("hex"),
      description = boundedText(req.body.description || "", "Descrição", 2000),
      mandatory = req.body.mandatory === true;
    const ref = db.collection(collections.releases).doc(version);
    await db.runTransaction(async (transaction) => {
      const old = (await transaction.get(ref)).data();
      if (old) {
        if (
          old.path === path &&
          old.sha256 === sha256 &&
          old.description === description &&
          old.mandatory === mandatory
        )
          return;
        throw new OperationsError("A versão já existe.", 409);
      }
      const at = new Date().toISOString();
      transaction.create(ref, {
        version,
        path,
        generation,
        sha256,
        size,
        description,
        mandatory,
        createdAt: at,
        createdBy: res.locals.actor,
      });
      transaction.create(
        db.collection(collections.activity).doc(randomUUID()),
        {
          actor: res.locals.actor,
          action: "release.created",
          entityId: version,
          at,
        },
      );
    });
    res.json({ id: version, sha256 });
  });
  route("get", "/releases/:id/download", async (req, res, { db, bucket }) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/.test(req.params.id))
      throw new OperationsError("Versão inválida.");
    const release = (
      await db.collection(collections.releases).doc(req.params.id).get()
    ).data();
    if (
      !release ||
      !/^operations\/releases\/[a-f0-9-]{36}\/[a-f0-9]{32}\.(zip|exe|msi)$/.test(
        release.path,
      )
    )
      throw new OperationsError("Versão não encontrada.", 404);
    const [url] = await bucket
      .file(release.path, { generation: release.generation })
      .getSignedUrl({
        action: "read",
        expires: Date.now() + 300_000,
        responseDisposition: "attachment",
      });
    res.json({ url });
  });
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
      if (status >= 500 && res.locals.actor)
        void deps
          .services()
          .db.collection(collections.errors)
          .doc(randomUUID())
          .create({
            actor: res.locals.actor,
            code: "OPERATIONS_FAILURE",
            at: new Date().toISOString(),
          })
          .catch(() => {});
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
