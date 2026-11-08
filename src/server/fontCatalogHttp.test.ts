import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import app from "./app.js";

test("large font config bodies retain authentication and the higher parser bound is limited to their route", async () => {
  const previousMode = process.env.FIREBASE_APP_CHECK_MODE,
    previousLog = process.env.LOG_LEVEL;
  process.env.FIREBASE_APP_CHECK_MODE = "off";
  process.env.LOG_LEVEL = "silent";
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = (path: string, kb: number) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "a".repeat(kb * 1024) }),
    });
  try {
    assert.equal(
      (await post("/api/admin/catalog/config/main", 400)).status,
      401,
    );
    assert.equal(
      (await post("/api/admin/catalog/anuncios/test", 400)).status,
      413,
    );
    assert.equal(
      (await post("/api/admin/catalog/config/main", 801)).status,
      413,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousMode === undefined) delete process.env.FIREBASE_APP_CHECK_MODE;
    else process.env.FIREBASE_APP_CHECK_MODE = previousMode;
    if (previousLog === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previousLog;
  }
});
