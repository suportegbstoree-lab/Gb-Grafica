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
    revoked = false;
  const bucket = {
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
