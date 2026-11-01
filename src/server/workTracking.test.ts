import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { createWorkRouter } from "./workRouter";
import { prepareWorkActivity, workdayId } from "./workTracking";
import { memoryFirestore } from "../../test/helpers/memoryFirestore";
import { OperationsError } from "../lib/operations";
import { changeWorkday, workDay } from "../lib/work";
const now = Date.parse("2026-11-01T15:00:00-03:00");
test("only an owned active matching task can supply start time and completion is atomic and single-use", async () => {
  const memory = memoryFirestore(),
    id = "a".repeat(32);
  const start = new Date(now - 3600000).toISOString();
  memory.docs.set(`_workTasks/${id}`, {
    uid: "ana",
    kind: "product",
    reference: "product",
    startedAt: start,
    status: "active",
  });
  let day = changeWorkday(undefined, "ana", "open", now - 2 * 3600000);
  day = changeWorkday(day, "ana", "break", now - 1800000);
  day = changeWorkday(day, "ana", "return", now - 900000);
  memory.docs.set(`_workdays/${workdayId("ana", workDay(now))}`, { ...day });
  await memory.db.runTransaction(async (tx) => {
    const event = await prepareWorkActivity(
      memory.db,
      { actor: "other" },
      "product.updated",
      "product",
      tx,
      { taskId: id, now },
    );
    assert.equal(event.record.timing, "request");
    event.write(tx);
  });
  assert.equal(memory.docs.get(`_workTasks/${id}`)?.status, "active");
  await memory.db.runTransaction(async (tx) => {
    const event = await prepareWorkActivity(
      memory.db,
      { actor: "ana" },
      "product.updated",
      "different",
      tx,
      { taskId: id, now },
    );
    assert.equal(event.record.timing, "request");
    event.write(tx);
  });
  await memory.db.runTransaction(async (tx) => {
    const event = await prepareWorkActivity(
      memory.db,
      { actor: "ana" },
      "product.updated",
      "product",
      tx,
      { taskId: id, now },
    );
    assert.equal(event.record.startedAt, start);
    assert.equal(event.record.durationMs, 2700000);
    event.write(tx);
  });
  assert.equal(memory.docs.get(`_workTasks/${id}`)?.status, "completed");
  const reused = await prepareWorkActivity(
    memory.db,
    { actor: "ana" },
    "product.updated",
    "product",
    undefined,
    { taskId: id, now },
  );
  assert.equal(reused.record.timing, "request");
});
test("work HTTP is self-private, uses server timestamps, checks task permissions and gives full admin the team view", async () => {
  const memory = memoryFirestore();
  let actor: any = {
    uid: "ana",
    permissions: ["operations.self", "products.images"],
  };
  let time = now;
  memory.docs.set("_operationsActivity/a", {
    actor: "ana",
    actorName: "Ana",
    action: "product.updated",
    entityId: "p",
    at: new Date(now).toISOString(),
  });
  memory.docs.set("_operationsActivity/b", {
    actor: "bruno",
    actorName: "Bruno",
    action: "product.updated",
    entityId: "q",
    at: new Date(now).toISOString(),
  });
  const app = express();
  app.use(express.json());
  app.use(
    createWorkRouter({
      db: () => memory.db,
      now: () => time,
      authorize: async (req) => {
        if (!req.get("authorization"))
          throw new OperationsError("Acesso negado", 403);
        return actor;
      },
    }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = (path: string, body?: unknown) =>
    fetch(url + path, {
      headers: { Authorization: "test", "Content-Type": "application/json" },
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    assert.equal((await fetch(url + "/report")).status, 403);
    let result = await (await call("/report?period=day")).json();
    assert.equal(result.count, 1);
    assert.deepEqual(
      result.employees.map((e: any) => e.name),
      ["Ana"],
    );
    assert.equal((await call("/report?employee=bruno")).status, 403);
    assert.equal((await call("/tasks", { kind: "document" })).status, 403);
    const task = await (
      await call("/tasks", {
        kind: "product",
        reference: "p",
        uid: "bruno",
        startedAt: "forged",
      })
    ).json();
    assert.equal(memory.docs.get(`_workTasks/${task.id}`)?.uid, "ana");
    assert.equal(
      memory.docs.get(`_workTasks/${task.id}`)?.startedAt,
      new Date(now).toISOString(),
    );
    const opened = await (
      await call("/day", { action: "open", uid: "bruno", startedAt: "forged" })
    ).json();
    assert.equal(opened.day.uid, "ana");
    time += 3600000;
    await call("/day", { action: "break" });
    time += 3600000;
    await call("/day", { action: "return" });
    time += 3600000;
    const closed = await (await call("/day", { action: "close" })).json();
    assert.equal(closed.workedMs, 7200000);
    actor = { uid: "bruno", permissions: ["products.images"] };
    assert.equal((await call(`/tasks/${task.id}/cancel`, {})).status, 404);
    assert.equal((await call("/report")).status, 403);
    actor = { uid: "root", admin: true };
    result = await (await call("/report?period=day")).json();
    assert.equal(result.count, 2);
    assert.equal(result.employees.length, 2);
    const csv = await (await call("/report?period=day&format=csv")).text();
    assert.match(csv, /Ana/);
    assert.match(csv, /Bruno/);
    assert.equal((await call("/report?period=year")).status, 422);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
