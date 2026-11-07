import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { PDFDocument, PDFName, degrees, rgb } from "pdf-lib";
import { memoryFirestore } from "../../test/helpers/memoryFirestore";
import {
  createStaffPdfLibraryRouter,
  pdfLibraryId,
  sanitizeStaffPdfBase,
  resolveStaffPdfBase,
} from "./staffPdfLibrary";
import { createStaffDocumentRouters, sanitizeStaffPdf } from "./staffDocuments";
import { defaultPdfLayout, newPdfLine } from "../lib/staffPdf";
import { cleanupStaffPdfBatches } from "./staffPdfBatches";
import {
  automaticStaffBarcode,
  staffPdfDefaultFilename,
} from "../lib/staffPdfBarcode";
import { OperationsError } from "../lib/operations";
async function pdf(pages = 4) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = d.addPage([595, 842]);
    p.drawRectangle({
      x: 20,
      y: 20,
      width: 20,
      height: 20,
      color: rgb(1, 0, 0),
    });
  }
  d.addJavaScript("bad", 'app.alert("bad")');
  return Buffer.from(await d.save());
}
test("internal PDF sanitizer accepts four and sixteen pages, normalizes rotation and removes active document data", async () => {
  const source = await PDFDocument.load(await pdf());
  source.getPage(2).setRotation(degrees(90));
  const cleaned = await sanitizeStaffPdfBase(await source.save()),
    output = await PDFDocument.load(cleaned.output);
  assert.equal(output.getPageCount(), 4);
  assert.deepEqual(output.getPage(2).getSize(), { width: 842, height: 595 });
  assert.equal(output.getPage(2).getRotation().angle, 0);
  assert.equal(output.catalog.get(PDFName.of("Names")), undefined);
  assert.equal((await sanitizeStaffPdfBase(await pdf(16))).pages.length, 16);
  await assert.rejects(() => sanitizeStaffPdfBase(pdfBuffer()), /PDF/);
  const tooMany = await pdf(17);
  await assert.rejects(() => sanitizeStaffPdfBase(tooMany), /16/);
  assert.equal(
    (
      await PDFDocument.load(
        await sanitizeStaffPdf(await pdf(), "T", "2026-11-04T12:00:00Z", 4),
      )
    ).getPageCount(),
    4,
  );
  const fourPages = await pdf();
  await assert.rejects(
    () => sanitizeStaffPdf(fourPages, "T", "2026-11-04T12:00:00Z", 2),
    /quantidade/,
  );
});
function pdfBuffer() {
  return Buffer.from("not pdf");
}
test("empty back pages remain valid static pages instead of breaking PDF embedding", async () => {
  const source = await PDFDocument.create();
  for (let i = 0; i < 4; i++) source.addPage([595, 842]);
  const { output, pages } = await sanitizeStaffPdfBase(await source.save());
  assert.equal(pages.length, 4);
  const sanitized = await sanitizeStaffPdf(
    output,
    "Blank backs",
    "2026-11-04T12:00:00Z",
    4,
  );
  assert.equal((await PDFDocument.load(sanitized)).getPageCount(), 4);
});
async function scenario(run: (s: any) => Promise<void>) {
  const memory = memoryFirestore([
      [
        "config/main",
        {
          fontes_personalizacao: [
            {
              id: "mono",
              nome: "FreeMono",
              cssFamily: "monospace",
              ativo: true,
            },
          ],
        },
      ],
    ]),
    objects = new Map<string, { bytes: Buffer; meta: any }>();
  let gen = 1,
    revoked = false,
    clock = Date.now();
  const bucket = {
    name: "test.firebasestorage.app",
    file: (name: string, opts?: any) => ({
      name,
      exists: async () => [objects.has(name)],
      getMetadata: async () => {
        const v = objects.get(name);
        if (!v) throw Object.assign(new Error("missing"), { code: 404 });
        return [v.meta];
      },
      download: async (range?: any) => {
        const v = objects.get(name);
        if (!v) throw Object.assign(new Error("missing"), { code: 404 });
        if (opts?.generation && opts.generation !== v.meta.generation)
          throw new Error("changed");
        return [range ? v.bytes.subarray(range.start, range.end + 1) : v.bytes];
      },
      save: async (bytes: Buffer, options: any) => {
        if (
          objects.has(name) &&
          options.preconditionOpts?.ifGenerationMatch === 0
        )
          throw Object.assign(new Error("exists"), { code: 412 });
        objects.set(name, {
          bytes: Buffer.from(bytes),
          meta: {
            ...options.metadata,
            size: bytes.length,
            generation: String(++gen),
          },
        });
      },
      delete: async () => {
        if (!objects.delete(name))
          throw Object.assign(new Error("missing"), { code: 404 });
      },
      getSignedUrl: async () => [`https://signed.example.test/${name}`],
    }),
  };
  const authorize = async (req: express.Request) => {
    const role = req.get("authorization");
    if (!role) throw new OperationsError("Entre.", 401);
    return {
      uid: role,
      admin: role === "root",
      permissions: revoked
        ? []
        : role === "manager"
          ? ["documents.templates.manage"]
          : role === "generator"
            ? ["documents.generate"]
            : [],
    };
  };
  const services = { db: memory.db, bucket } as any,
    deps = {
      services: () => services,
      authorize,
      origin: () => "https://example.test",
      now: () => clock,
    };
  const app = express();
  app.use(express.json());
  app.use("/library", createStaffPdfLibraryRouter(deps));
  app.use("/documents", createStaffDocumentRouters(deps).admin);
  app.use((e: any, _r: any, res: any, _n: any) =>
    res.status(e.status || 422).json({ error: e.message }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = (path: string, role: string, body?: any) =>
    fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: role, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    await run({
      ...memory,
      objects,
      request,
      services,
      advance: (ms: number) => {
        clock += ms;
      },
      time: () => clock,
      revoke: () => {
        revoked = true;
      },
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
test("PDF-library access is independent from products/orders and template permission does not grant generation", async () =>
  scenario(async ({ request }) => {
    assert.equal((await request("/library", "customer")).status, 403);
    assert.equal((await request("/library", "generator")).status, 200);
    assert.equal((await request("/library", "manager")).status, 200);
    assert.equal(
      (
        await request("/library/layouts", "generator", {
          name: "X",
          layout: defaultPdfLayout(),
        })
      ).status,
      403,
    );
    assert.equal((await request("/documents", "manager", {})).status, 403);
  }));
test("JSON imports preserve existing molds, malformed maps have no writes, edits and deletions use revision checks", async () =>
  scenario(async ({ request, docs }) => {
    let response = await request("/library/layouts/import", "manager", {
      templates: { X_template: defaultPdfLayout() },
    });
    assert.deepEqual(await response.json(), { created: 1, skipped: 0 });
    response = await request("/library/layouts/import", "manager", {
      templates: { X_template: { ...defaultPdfLayout(), font_size: 999 } },
    });
    assert.deepEqual(await response.json(), { created: 0, skipped: 1 });
    const id = pdfLibraryId("X_template"),
      old = docs.get(`_staffPdfLayouts/${id}`);
    assert.equal(old.layout.font_size, 150);
    response = await request("/library/layouts", "manager", {
      name: "X_template",
      layout: defaultPdfLayout(),
      revision: "0".repeat(32),
    });
    assert.equal(response.status, 409);
    response = await request(`/library/layouts/${id}/delete`, "manager", {
      revision: old.revision,
    });
    assert.equal(response.status, 200);
    assert.equal(docs.get(`_staffPdfLayouts/${id}`).enabled, false);
    const before = docs.size;
    await request("/library/layouts/import", "manager", {
      templates: { good: defaultPdfLayout(), bad: { color: "red" } },
    });
    assert.equal(docs.size, before);
  }));
test("four-page bases stay private, create no product, lock duplicate names, and generate idempotent staff documents", async () =>
  scenario(async ({ request, docs, objects, services, revoke }) => {
    const start = await request("/library/bases", "manager", {
        name: "Kit.pdf",
        requestId: "a".repeat(36),
      }),
      pending = await start.json();
    assert.equal(start.status, 201);
    objects.set(pending.path, {
      bytes: await pdf(),
      meta: {
        contentType: "application/pdf",
        size: 4000,
        generation: "5",
        metadata: { uploadedBy: "manager" },
      },
    });
    assert.equal(
      (await request(`/library/bases/${pending.id}/finalize`, "manager", {}))
        .status,
      200,
    );
    assert.equal(
      [...docs.keys()].some((k) => k.startsWith("anuncios/")),
      false,
    );
    assert.equal(
      (
        await request("/library/bases", "manager", {
          name: "Kit.pdf",
          requestId: "b".repeat(36),
        })
      ).status,
      409,
    );
    const base = await resolveStaffPdfBase(services, pending.id);
    assert.equal(base.pageCount, 4);
    assert.equal(
      (await request(`/library/bases/${pending.id}/file`, "customer")).status,
      403,
    );
    await request("/library/layouts", "manager", {
      name: "Kit",
      layout: { ...defaultPdfLayout(), font_name: "FreeMono.otf" },
    });
    const t = docs.get(`_staffPdfLayouts/${pdfLibraryId("Kit")}`),
      line = newPdfLine(t.layout, [
        { id: "mono", nome: "FreeMono", cssFamily: "monospace", ativo: true },
      ]);
    line.text = "Ana";
    const payload = {
      requestId: "c".repeat(36),
      staffJob: {
        schemaVersion: 1,
        baseId: base.id,
        baseRevision: base.revision,
        layoutId: pdfLibraryId("Kit"),
        layoutRevision: t.revision,
        lines: [line],
      },
    };
    const created = await request("/documents", "generator", payload),
      value = await created.json();
    assert.equal(created.status, 201);
    assert.equal(
      docs.get(`_staffDocuments/${value.document.id}`).expectedPageCount,
      4,
    );
    assert.equal(
      (await request("/documents", "generator", payload)).status,
      201,
    );
    assert.equal(
      (
        await request("/documents", "generator", {
          ...payload,
          staffJob: { ...payload.staffJob, baseRevision: "0".repeat(32) },
        })
      ).status,
      409,
    );
    revoke();
    assert.equal(
      (await request(`/library/bases/${base.id}/file`, "generator")).status,
      403,
    );
  }));

test("replacing a PDF validates first, preserves its identity and rejects stale concurrent replacements", async () =>
  scenario(async ({ request, docs, objects, services }) => {
    async function start(
      char: string,
      replacement?: { id: string; revision: string },
    ) {
      const response = await request("/library/bases", "manager", {
        name: "Kit.pdf",
        requestId: char.repeat(36),
        replacement,
      });
      assert.equal(response.status, 201);
      return response.json();
    }
    async function stage(pending: { path: string }, bytes: Buffer) {
      objects.set(pending.path, {
        bytes,
        meta: {
          contentType: "application/pdf",
          size: bytes.length,
          generation: "5",
          metadata: { uploadedBy: "manager" },
        },
      });
    }
    const finalize = (id: string) =>
      request(`/library/bases/${id}/finalize`, "manager", {});
    const original = await start("a");
    await stage(original, await pdf(4));
    assert.equal((await finalize(original.id)).status, 200);
    const before = await resolveStaffPdfBase(services, original.id);
    const replacement = { id: before.id, revision: before.revision };
    const invalid = await start("b", replacement);
    await stage(invalid, Buffer.from("%PDF-invalid"));
    assert.ok((await finalize(invalid.id)).status >= 400);
    assert.equal(
      (await resolveStaffPdfBase(services, original.id)).revision,
      before.revision,
    );
    const first = await start("c", replacement);
    const stale = await start("d", replacement);
    await stage(first, await pdf(2));
    await stage(stale, await pdf(3));
    assert.equal((await finalize(first.id)).status, 200);
    const after = await resolveStaffPdfBase(services, original.id);
    assert.equal(after.pageCount, 2);
    assert.notEqual(after.revision, before.revision);
    assert.match(after.path, new RegExp(first.id));
    assert.equal((await finalize(first.id)).status, 200);
    assert.equal((await finalize(stale.id)).status, 409);
    assert.equal(objects.has(after.path), true);
    assert.equal(
      objects.has(`staff-pdf-bases/${original.id}/versions/${stale.id}.pdf`),
      false,
    );
    assert.equal(
      docs.get(`_staffPdfBaseNames/${pdfLibraryId("Kit.pdf")}`).baseId,
      original.id,
    );
    assert.equal(
      (await request(`/library/bases/${first.id}/delete`, "manager", {}))
        .status,
      200,
    );
    assert.equal(objects.has(after.path), true);
  }));

test("decorative letters require exact folder names and owned PNGs, and active letters cannot be removed as temporary uploads", async () =>
  scenario(async ({ request, docs, objects }) => {
    const id = "a".repeat(32),
      revision = "b".repeat(32),
      path = `staff-pdf-bases/${id}/letters/${"c".repeat(32)}.png`;
    docs.set(`_staffPdfBases/${id}`, {
      name: "Alfabeto.pdf",
      path: `staff-pdf-bases/${id}/original.pdf`,
      status: "ready",
      revision,
      pageCount: 2,
      pages: [],
    });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    objects.set(path, {
      bytes: png,
      meta: {
        contentType: "image/png",
        size: png.length,
        generation: "6",
        metadata: { uploadedBy: "manager" },
      },
    });
    assert.equal(
      (
        await request(`/library/bases/${id}/alphabet`, "generator", {
          folderName: "Alfabeto",
          letters: { A: { path } },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request(`/library/bases/${id}/alphabet`, "manager", {
          folderName: "Outro",
          letters: { A: { path } },
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await request(`/library/bases/${id}/alphabet`, "manager", {
          folderName: 4,
          letters: { A: { path } },
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await request(`/library/bases/${id}/alphabet`, "manager", {
          folderName: "Alfabeto",
          letters: { A: { path } },
        })
      ).status,
      200,
    );
    assert.equal(
      (await request(`/library/bases/${id}/initial?letter=A`, "generator"))
        .status,
      200,
    );
    assert.equal(
      (
        await (
          await request(`/library/bases/${id}/initial?letter=B`, "generator")
        ).json()
      ).url,
      null,
    );
    assert.equal(
      (
        await request(
          `/library/bases/${id}/alphabet-upload/delete`,
          "manager",
          { path },
        )
      ).status,
      422,
    );
    assert.ok(objects.has(path));
  }));

test("batch recipes snapshot inputs, preserve tracking and enforce ownership, idempotence and three-day expiry", async () =>
  scenario(async ({ request, docs, objects, services, advance, time }) => {
    const baseId = "a".repeat(32),
      layoutId = "b".repeat(32);
    const layout = { ...defaultPdfLayout(), font_name: "FreeMono" };
    const path = `staff-pdf-bases/${baseId}/original.pdf`;
    objects.set(path, {
      bytes: await pdf(2),
      meta: { size: 3000, contentType: "application/pdf", generation: "1" },
    });
    docs.set(`_staffPdfBases/${baseId}`, {
      name: "Kit.pdf",
      status: "ready",
      path,
      generation: "1",
      pageCount: 2,
      pages: [
        { width: 595, height: 842 },
        { width: 595, height: 842 },
      ],
      revision: baseId,
    });
    docs.set(`_staffPdfLayouts/${layoutId}`, {
      enabled: true,
      layout,
      revision: layoutId,
    });
    const parentResponse = await request("/library/batches", "generator", {
      requestId: "c".repeat(36),
    });
    assert.equal(parentResponse.status, 201);
    const { batch } = await parentResponse.json();
    assert.equal(
      Date.parse(batch.expiresAt) - Date.parse(batch.createdAt),
      3 * 86400000,
    );
    assert.equal((await request("/library/batches", "manager")).status, 403);
    const line = newPdfLine(layout, [
      { id: "mono", nome: "FreeMono", cssFamily: "monospace", ativo: true },
    ]);
    line.text = "ANA";
    const barcode = "BR2684621549924";
    const job = {
      schemaVersion: 1,
      baseId,
      baseRevision: baseId,
      layoutId,
      layoutRevision: layoutId,
      lines: [line],
      barcode,
      outputName: staffPdfDefaultFilename("Kit", "ANA", barcode),
    };
    const body = { job, requestId: "d".repeat(36) };
    const response = await request(
      `/library/batches/${batch.id}/items`,
      "generator",
      body,
    );
    assert.equal(response.status, 201);
    const recipe = await response.json();
    assert.equal(recipe.job.barcode, barcode);
    assert.equal(recipe.job.outputName, "Kit ANA BR2684621549924");
    assert.match(
      recipe.originalUrl,
      new RegExp(`staff-pdf-batches/${batch.id}/assets/`),
    );
    assert.equal(
      [...objects.keys()].some(
        (key) => key.includes("document.pdf") || key.endsWith(".png"),
      ),
      false,
    );
    assert.equal(
      (
        await request(
          `/library/batches/${batch.id}/items/${recipe.item.id}`,
          "customer",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          `/library/batches/${batch.id}/items/${recipe.item.id}`,
          "root",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          `/library/batches/${batch.id}/items/${recipe.item.id}/complete`,
          "generator",
          {},
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          `/library/batches/${batch.id}/items/${recipe.item.id}/complete`,
          "generator",
          {},
        )
      ).status,
      200,
    );
    const activities = [...docs.keys()].filter((key) =>
      key.startsWith("_operationsActivity/"),
    );
    assert.equal(activities.length, 1);
    objects.delete(path);
    docs.delete(`_staffPdfBases/${baseId}`);
    docs.delete(`_staffPdfLayouts/${layoutId}`);
    docs.get("config/main").fontes_personalizacao = [];
    assert.equal(
      (await request(`/library/batches/${batch.id}/items`, "generator", body))
        .status,
      200,
    );
    const replay = await request(
      `/library/batches/${batch.id}/items/${recipe.item.id}`,
      "generator",
    );
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).fonts[0].nome, "FreeMono");
    assert.equal(
      (
        await request(`/library/batches/${batch.id}/items`, "generator", {
          ...body,
          job: { ...job, barcode: automaticStaffBarcode("e".repeat(36)) },
        })
      ).status,
      409,
    );
    advance(3 * 86400000 + 11 * 60000);
    assert.equal(
      (await request(`/library/batches/${batch.id}/items`, "generator")).status,
      410,
    );
    assert.deepEqual(
      (await (await request("/library/batches", "generator")).json()).batches,
      [],
    );
    services.bucket.deleteFiles = async ({ prefix }: { prefix: string }) => {
      for (const key of objects.keys())
        if (key.startsWith(prefix)) objects.delete(key);
    };
    services.db.batch = () => {
      const deletes: any[] = [];
      return {
        delete: (ref: any) => deletes.push(ref),
        commit: async () => {
          for (const ref of deletes) await ref.delete();
        },
      };
    };
    assert.deepEqual(await cleanupStaffPdfBatches(services, time()), {
      deleted: 1,
      failed: 0,
    });
    assert.equal(
      [...objects.keys()].some((key) => key.startsWith("staff-pdf-batches/")),
      false,
    );
    assert.equal(docs.has(`_staffPdfBatches/${batch.id}`), false);
  }));

test("batch recipes freeze font files and decorative initials instead of linking current catalog assets", async () =>
  scenario(async ({ request, docs, objects }) => {
    const baseId = "a".repeat(32),
      layoutId = "b".repeat(32);
    const basePath = `staff-pdf-bases/${baseId}/original.pdf`;
    const fontPath = `catalog/fonts/mono/${"c".repeat(32)}.otf`;
    const initialPath = `staff-pdf-bases/${baseId}/letters/${"d".repeat(32)}.png`;
    for (const [path, type, bytes] of [
      [basePath, "application/pdf", await pdf(2)],
      [fontPath, "font/otf", Buffer.from("OTTO-original-font")],
      [initialPath, "image/png", Buffer.from("original-initial")],
    ] as const)
      objects.set(path, {
        bytes,
        meta: { size: bytes.length, contentType: type, generation: "1" },
      });
    const font = {
      id: "mono",
      nome: "FreeMono",
      cssFamily: "FreeMono",
      ativo: false,
      arquivoUrl: `https://firebasestorage.googleapis.com/v0/b/test.firebasestorage.app/o/${encodeURIComponent(fontPath)}?alt=media`,
      arquivoFormato: "otf" as const,
    };
    docs.get("config/main").fontes_personalizacao = [font];
    docs.set(`_staffPdfBases/${baseId}`, {
      name: "Kit.pdf",
      status: "ready",
      path: basePath,
      generation: "1",
      revision: baseId,
      alphabet: {
        folderName: "Kit",
        sizePercent: 65,
        letters: { A: { path: initialPath } },
      },
    });
    const layout = { ...defaultPdfLayout(), font_name: "FreeMono" };
    docs.set(`_staffPdfLayouts/${layoutId}`, {
      enabled: true,
      revision: layoutId,
      layout,
    });
    const { batch } = await (
      await request("/library/batches", "generator", {
        requestId: "e".repeat(36),
      })
    ).json();
    const line = newPdfLine(layout, [font]);
    line.text = "ANA";
    const body = {
      requestId: "f".repeat(36),
      job: {
        schemaVersion: 1,
        baseId,
        baseRevision: baseId,
        layoutId,
        layoutRevision: layoutId,
        lines: [line],
        barcode: "BR263172448223P",
        outputName: "Kit ANA BR263172448223P",
      },
    };
    const saved = await request(
      `/library/batches/${batch.id}/items`,
      "generator",
      body,
    );
    assert.equal(saved.status, 201);
    const recipe = await saved.json();
    assert.equal(recipe.initial.sizePercent, 65);
    assert.match(recipe.fonts[0].arquivoUrl, /staff-pdf-batches/);
    assert.match(recipe.initial.url, /staff-pdf-batches/);
    const snapshot = docs.get(`_staffPdfBatchItems/${recipe.item.id}`);
    assert.equal(snapshot.fonts[0].arquivoUrl, undefined);
    const originalFont = objects.get(
      `staff-pdf-batches/${batch.id}/assets/${snapshot.fonts[0].asset}`,
    ).bytes;
    assert.equal(originalFont.toString(), "OTTO-original-font");
    objects.delete(fontPath);
    objects.delete(initialPath);
    assert.equal(
      (
        await request(
          `/library/batches/${batch.id}/items/${recipe.item.id}`,
          "generator",
        )
      ).status,
      200,
    );
    assert.equal(originalFont.toString(), "OTTO-original-font");
  }));
