import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { PDFDocument, PDFName, PDFDict, rgb } from "pdf-lib";
import { memoryFirestore } from "../../test/helpers/memoryFirestore";
import {
  createStaffDocumentRouters,
  sanitizeStaffPdf,
  cleanupStaffDocuments,
} from "./staffDocuments";
import { staffDocumentPath, STAFF_DOCUMENT_TTL_MS } from "../lib/staffDocument";
import { OperationsError } from "../lib/operations";
const templateId = "a".repeat(32),
  templatePath = `catalog/templates/product/${templateId}.pdf`;
async function pdfBytes(pages = 2) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawRectangle({
      x: 20,
      y: 20,
      width: 100,
      height: 100,
      color: rgb(1, 0, 0),
    });
  }
  pdf.addJavaScript("script", 'app.alert("unwanted")');
  return Buffer.from(await pdf.save());
}
function bucketMemory() {
  const objects = new Map<string, { bytes: Buffer; metadata: any }>();
  let generation = 10;
  const signed: any[] = [];
  const file = (name: string, options?: any) => ({
    name,
    exists: async () => [objects.has(name)],
    getMetadata: async () => {
      const entry = objects.get(name);
      if (!entry) throw Object.assign(new Error("missing"), { code: 404 });
      return [entry.metadata];
    },
    download: async () => {
      const entry = objects.get(name);
      if (
        !entry ||
        (options?.generation &&
          String(entry.metadata.generation) !== String(options.generation))
      )
        throw Object.assign(new Error("missing"), { code: 404 });
      return [entry.bytes];
    },
    save: async (bytes: Buffer, opts: any) => {
      if (opts.preconditionOpts?.ifGenerationMatch === 0 && objects.has(name))
        throw Object.assign(new Error("exists"), { code: 412 });
      objects.set(name, {
        bytes: Buffer.from(bytes),
        metadata: {
          ...opts.metadata,
          size: bytes.length,
          generation: String(++generation),
        },
      });
    },
    delete: async () => {
      if (!objects.delete(name))
        throw Object.assign(new Error("missing"), { code: 404 });
    },
    getSignedUrl: async (opts: any) => {
      signed.push({ name, ...opts });
      return [`https://signed.example.test/${encodeURIComponent(name)}`];
    },
  });
  return { objects, bucket: { file }, signed };
}
async function scenario(run: (s: any) => Promise<void>) {
  const memory = memoryFirestore([
      [
        "anuncios/product",
        {
          modelosPdf: [
            {
              id: templateId,
              path: templatePath,
              name: "Borboleta.pdf",
              pages: ["https://example.test/page.png"],
            },
          ],
        },
      ],
      [
        "config/main",
        {
          fontes_personalizacao: [
            { id: "mono", nome: "Mono", cssFamily: "monospace", ativo: true },
          ],
        },
      ],
      ["_staffProfiles/ana", { name: "Ana Designer" }],
    ]),
    storage = bucketMemory();
  let now = Date.parse("2026-11-01T12:00:00Z"),
    revoked = false,
    providerCalls: any[] = [];
  let providerMode = "accepted";
  const services = { db: memory.db, bucket: storage.bucket } as any;
  const authorize = async (req: express.Request) => {
    const uid = req.get("authorization");
    if (!uid) throw new OperationsError("Entre novamente.", 401);
    return {
      uid,
      admin: uid === "root",
      permissions:
        revoked || uid === "no-permission" ? [] : ["documents.generate"],
    };
  };
  const routers = createStaffDocumentRouters({
    services: () => services,
    authorize,
    origin: () => "https://store.example.test",
    now: () => now,
    fetcher: async (input: any, init: any) => {
      providerCalls.push({ input, ...init });
      return new Response(
        JSON.stringify(
          providerMode === "accepted"
            ? { id: "resend-accepted" }
            : { error: "temporary" },
        ),
        {
          status: providerMode === "accepted" ? 200 : 503,
        },
      );
    },
  });
  const app = express();
  app.use(express.json());
  app.use("/docs", routers.admin);
  app.use("/api/documents/shared", routers.shared);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = (path: string, body?: unknown, user = "ana") =>
    fetch(base + "/docs" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(user ? { Authorization: user } : {}),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const reserve = async (
    requestId = "12345678-1234-4234-8234-123456789012",
  ) => {
    const response = await call("", {
      productId: "product",
      templateId,
      requestId,
      customization: {
        texto: "Ana",
        fonte: "mono",
        cor: "#000000",
        tamanhoFonte: 5,
        posicao: { x: 50, y: 50 },
      },
      ownerId: "forged",
      expiresAt: "2099-01-01",
      price: "0.01",
    });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  };
  const put = async (created: any, provided?: Buffer) => {
    const bytes = provided || (await pdfBytes());
    storage.objects.set(created.path, {
      bytes,
      metadata: {
        size: bytes.length,
        generation: "42",
        contentType: "application/pdf",
        metadata: {
          ownerId: "ana",
          documentId: created.document.id,
          kind: "staff-document",
        },
      },
    });
  };
  try {
    await run({
      memory,
      storage,
      services,
      call,
      reserve,
      put,
      base,
      get now() {
        return now;
      },
      advance: (ms: number) => {
        now += ms;
      },
      revoke: () => {
        revoked = true;
      },
      providerCalls,
      providerMode: (mode: string) => {
        providerMode = mode;
      },
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}
test("static PDF sanitation keeps two vector pages and physical size but discards active document scripts", async () => {
  const source = await pdfBytes(),
    result = await PDFDocument.load(
      await sanitizeStaffPdf(source, "Borboleta.pdf", "2026-11-01T12:00:00Z"),
    );
  assert.equal(result.getPageCount(), 2);
  assert.ok(Math.abs(result.getPage(0).getWidth() - 595.28) < 0.01);
  assert.equal(result.catalog.has(PDFName.of("Names")), false);
  const xobjects = result
    .getPage(0)
    .node.Resources()
    ?.lookup(PDFName.of("XObject"), PDFDict);
  assert.ok(
    xobjects && xobjects.keys().length > 0,
    "page content stays embedded, not rasterized",
  );
  await assert.rejects(
    sanitizeStaffPdf(await pdfBytes(1), "invalid", "2026-11-01"),
    /contracapa/,
  );
  await assert.rejects(
    sanitizeStaffPdf(new Uint8Array([1, 2, 3]), "invalid", "2026-11-01"),
    /válido/,
  );
});
test("staff PDF generation checks permission, binds owner, resumes, sanitizes and records once with seven-day retention", async () =>
  scenario(async (s: any) => {
    assert.equal((await s.call("", undefined, "")).status, 401);
    assert.equal((await s.call("", undefined, "no-permission")).status, 403);
    const created = await s.reserve(),
      id = created.document.id;
    assert.equal(created.document.ownerId, "ana");
    assert.equal(created.document.ownerName, "Ana Designer");
    assert.equal(created.uploadExists, false);
    assert.equal(created.path, staffDocumentPath("ana", id, true));
    assert.equal(created.document.customization, undefined);
    await s.put(created);
    const retried = await s.reserve();
    assert.equal(retried.document.id, id);
    assert.equal(retried.uploadExists, true);
    assert.equal((await s.call(`/${id}/file`)).status, 409);
    assert.equal((await s.call(`/${id}/finalize`, {}, "other")).status, 404);
    let response = await s.call(`/${id}/finalize`, {});
    assert.equal(response.status, 200, await response.clone().text());
    const saved = (await response.json()).document;
    assert.equal(saved.status, "ready");
    assert.equal(
      Date.parse(saved.expiresAt) - Date.parse(saved.completedAt),
      STAFF_DOCUMENT_TTL_MS,
    );
    assert.equal(s.storage.objects.has(created.path), false);
    assert.ok(s.storage.objects.has(staffDocumentPath("ana", id)));
    assert.match(saved.sha256, /^[a-f0-9]{64}$/);
    response = await s.call(`/${id}/finalize`, {});
    assert.equal(response.status, 200);
    assert.equal(
      [...s.memory.docs].filter(([k]: any) =>
        k.startsWith("_operationsActivity/"),
      ).length,
      1,
    );
    assert.equal(
      (await (await s.call("", undefined, "other")).json()).documents.length,
      0,
    );
    assert.equal(
      (await (await s.call("", undefined, "root")).json()).documents.length,
      1,
    );
    assert.equal((await s.call(`/${id}/file`, undefined, "other")).status, 404);
    assert.equal((await s.call(`/${id}/file?mode=print`)).status, 200);
    assert.equal(s.storage.signed.at(-1).responseDisposition, "inline");
    s.revoke();
    assert.equal((await s.call(`/${id}/file`)).status, 403);
  }));
test("explicit shared links are revocable, expire at seven days and cleanup also advances past cancelled generations", async () =>
  scenario(async (s: any) => {
    const created = await s.reserve();
    await s.put(created);
    await s.call(`/${created.document.id}/finalize`, {});
    const id = created.document.id;
    const url = (await (await s.call(`/${id}/share`, {})).json()).url,
      parsed = new URL(url);
    assert.equal(parsed.pathname, `/api/documents/shared/${id}`);
    assert.match(parsed.searchParams.get("token")!, /^[a-f0-9]{64}$/);
    assert.equal(
      url.includes("/" + parsed.searchParams.get("token")),
      false,
      "secret stays out of request paths",
    );
    let response = await fetch(s.base + parsed.pathname + parsed.search, {
      redirect: "manual",
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    await s.call(`/${id}/revoke-sharing`, {});
    assert.equal(
      (
        await fetch(s.base + parsed.pathname + parsed.search, {
          redirect: "manual",
        })
      ).status,
      410,
    );
    const cancelled = await s.reserve("22345678-1234-4234-8234-123456789012");
    await s.call(`/${cancelled.document.id}/cancel`, {});
    s.advance(STAFF_DOCUMENT_TTL_MS + 1);
    assert.equal((await s.call(`/${id}/file`)).status, 410);
    const clean = await cleanupStaffDocuments(s.services, s.now);
    assert.equal(clean.failed, 0);
    assert.equal(clean.deleted, 2);
    assert.equal(s.storage.objects.size, 0);
    assert.equal(
      s.memory.docs.get(`_staffDocuments/${id}`).customization,
      undefined,
    );
    assert.equal(
      s.memory.docs.get(`_staffDocuments/${id}`).expiresAt,
      undefined,
    );
    assert.equal((await cleanupStaffDocuments(s.services, s.now)).deleted, 0);
  }));
test("staff document emails use one immutable recipient/body/idempotency key and never claim delivery", async () => {
  const previous = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    APP_URL: process.env.APP_URL,
  };
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "orders@example.test";
  process.env.APP_URL = "https://store.example.test";
  try {
    await scenario(async (s: any) => {
      const created = await s.reserve();
      await s.put(created);
      await s.call(`/${created.document.id}/finalize`, {});
      const path = `/${created.document.id}/email`,
        body = {
          to: "buyer@example.test",
          requestId: "32345678-1234-4234-8234-123456789012",
        };
      assert.equal((await s.call(path, body, "other")).status, 404);
      let response = await s.call(path, body);
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json()).status, "accepted");
      await s.call(path, body);
      assert.equal(s.providerCalls.length, 1);
      assert.match(
        s.providerCalls[0].headers["Idempotency-Key"],
        /^staff-document-/,
      );
      const sent = JSON.parse(s.providerCalls[0].body);
      assert.deepEqual(sent.to, ["buyer@example.test"]);
      assert.ok(sent.attachments[0].content.length > 0);
      assert.match(sent.text, /token=/);
      assert.equal(
        (await s.call(path, { ...body, to: "someone@example.test" })).status,
        409,
      );
      delete process.env.RESEND_API_KEY;
      assert.equal(
        (
          await s.call(path, {
            ...body,
            requestId: "42345678-1234-4234-8234-123456789012",
          })
        ).status,
        503,
      );
      assert.equal(s.providerCalls.length, 1);
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("ambiguous document email retries preserve the body and sender and stop after the provider deduplication window", async () => {
  const previous = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    APP_URL: process.env.APP_URL,
  };
  Object.assign(process.env, {
    RESEND_API_KEY: "test-key",
    EMAIL_FROM: "orders@example.test",
    APP_URL: "https://store.example.test",
  });
  try {
    await scenario(async (s: any) => {
      const created = await s.reserve();
      await s.put(created);
      await s.call(`/${created.document.id}/finalize`, {});
      const path = `/${created.document.id}/email`,
        body = {
          to: "buyer@example.test",
          requestId: "52345678-1234-4234-8234-123456789012",
        };
      s.providerMode("pending");
      const first = await s.call(path, body);
      assert.equal(first.status, 202);
      assert.equal((await first.json()).status, "pending");
      process.env.EMAIL_FROM = "changed@example.test";
      s.providerMode("accepted");
      const next = await s.call(path, body);
      assert.equal(next.status, 200);
      assert.equal(s.providerCalls[0].body, s.providerCalls[1].body);
      assert.equal(
        s.providerCalls[0].headers["Idempotency-Key"],
        s.providerCalls[1].headers["Idempotency-Key"],
      );
      const other = {
        ...body,
        requestId: "62345678-1234-4234-8234-123456789012",
      };
      s.providerMode("pending");
      assert.equal((await s.call(path, other)).status, 202);
      s.advance(24 * 3600000);
      assert.equal(
        (await (await s.call(path, other)).json()).status,
        "needs_review",
      );
      assert.equal(s.providerCalls.length, 3);
    });
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
test("staff document paths reject traversal and controls but support legitimate Firebase UIDs", () => {
  for (const uid of ["../other", "ana/other", "ana\\other", "a\u0000b"])
    assert.throws(() => staffDocumentPath(uid, "a".repeat(32)));
  assert.equal(
    staffDocumentPath("user-x_1", "a".repeat(32)),
    `staff-documents/user-x_1/${"a".repeat(32)}/document.pdf`,
  );
});
