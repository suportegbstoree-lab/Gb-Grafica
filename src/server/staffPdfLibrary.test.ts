import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { unzipSync } from "fflate";
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
import { baseForPdfLayout, defaultPdfLayout, newPdfLine, staffPdfStoragePath } from "../lib/staffPdf";
import { resolveStaffPdfCsvModel } from "../lib/staffPdfCsv";
import { cleanupStaffPdfBatches } from "./staffPdfBatches";
import { staffPdfBatchFilePath, staffPdfZipEntries } from "./staffPdfArchive";
import {
  automaticStaffBarcode,
  staffPdfDefaultFilename,
} from "../lib/staffPdfBarcode";
import { OperationsError } from "../lib/operations";
import { uploadStaffPdfBase } from "../services/staffPdfBaseUpload";
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
  const downloads: string[] = [],
    signatures: string[] = [],
    signedUploads: Array<{ name: string; options: any }> = [];
  let gen = 1,
    revoked = false,
    clock = Date.now();
  const bucket = {
    name: "test.firebasestorage.app",
    combine: async (sources: { name: string; generation?: string }[], destination: { name: string }, opts: any) => {
      assert.ok(sources.length > 0 && sources.length <= 32);
      assert.equal(opts.ifGenerationMatch, 0);
      if (objects.has(destination.name)) throw Object.assign(new Error("exists"), { code: 412 });
      const bytes = Buffer.concat(sources.map(({ name, generation }) => {
        const object = objects.get(name)!;
        assert.ok(object, name);
        if (generation) assert.equal(generation, object.meta.generation);
        return object.bytes;
      }));
      objects.set(destination.name, {
        bytes,
        meta: { generation: String(++gen), size: bytes.length },
      });
    },
    file: (name: string, opts?: any) => ({
      name,
      generation: opts?.generation,
      exists: async () => [objects.has(name)],
      getMetadata: async () => {
        const v = objects.get(name);
        if (!v) throw Object.assign(new Error("missing"), { code: 404 });
        return [v.meta];
      },
      download: async (range?: any) => {
        downloads.push(name);
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
      copy: async (destination: { name: string }, options: any) => {
        const source = objects.get(name);
        assert.ok(source);
        assert.equal(opts?.generation, source.meta.generation);
        assert.equal(options.preconditionOpts?.ifGenerationMatch, 0);
        assert.ok(!objects.has(destination.name));
        objects.set(destination.name, {
          bytes: source.bytes,
          meta: {
            ...options,
            size: source.bytes.length,
            generation: String(++gen),
          },
        });
      },
      getSignedUrl: async (options: any) => {
        signatures.push(name);
        if (options.action === "write") signedUploads.push({ name, options });
        return [`https://signed.example.test/${name}`];
      },
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
          : ["generator", "another-generator"].includes(role)
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
      downloads,
      signatures,
      signedUploads,
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
test("signed base uploads resume after lost upload and finalize responses without deleting a saved base", async () =>
  scenario(async ({ request, docs, objects, signedUploads, time }) => {
    const bytes = await pdf(2);
    const file = new File([bytes], "Base assinada.pdf");
    const requestId = "c".repeat(36);
    const id = pdfLibraryId(`manager:${requestId}`);
    const path = `staff-pdf-bases/${id}/upload.pdf`;
    const calls: string[] = [];
    let puts = 0;
    let loseFinalizeResponse = true;
    const clientRequest = async (route: string, body: unknown) => {
      calls.push(route);
      const response = await request(`/library${route}`, "manager", body);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (route.endsWith("/finalize") && loseFinalizeResponse) {
        loseFinalizeResponse = false;
        throw new TypeError("Lost finalize response");
      }
      return data;
    };
    const fetcher: typeof fetch = async (url, options) => {
      puts++;
      assert.equal(String(url), `https://signed.example.test/${path}`);
      assert.equal(options?.method, "PUT");
      assert.equal(options?.credentials, "omit");
      assert.equal(options?.redirect, "error");
      assert.deepEqual(options?.headers, {
        "Content-Type": "application/pdf",
        "x-goog-if-generation-match": "0",
      });
      assert.equal(options.body, file);
      assert.deepEqual(signedUploads[0].options, {
        version: "v4", action: "write", expires: time() + 300000,
        contentType: "application/pdf",
        extensionHeaders: { "content-length": String(file.size), "x-goog-if-generation-match": "0" },
      });
      objects.set(path, {
        bytes,
        meta: { contentType: "application/pdf", size: bytes.length, generation: "10" },
      });
      throw new TypeError("Lost upload response");
    };
    const upload = () => uploadStaffPdfBase(file, requestId, undefined, "Cadernetas", clientRequest, fetcher);
    await assert.rejects(upload(), /Confira a conexão/);
    assert.equal(docs.get(`_staffPdfBases/${id}`).status, "uploading");
    await assert.rejects(upload(), /Lost finalize response/);
    assert.equal(docs.get(`_staffPdfBases/${id}`).status, "ready");
    assert.equal(await upload(), id);
    assert.equal(puts, 1);
    assert.equal(signedUploads.length, 1);
    assert.equal(calls.filter(route => route.endsWith("/finalize")).length, 1);
    assert.equal(calls.some(route => route.endsWith("/delete")), false);
    const library = await (await request("/library", "manager")).json();
    assert.equal(library.pendingUploads.length, 0);
    assert.equal(library.bases.length, 1);
    assert.equal(library.bases[0].pageCount, 2);
    assert.equal(library.bases[0].category, "Cadernetas");
    assert.equal((await PDFDocument.load(objects.get(staffPdfStoragePath(id)).bytes)).getPageCount(), 2);
  }));

test("signed base targets validate sizes, metadata and current permissions before publishing", async () =>
  scenario(async ({ request, docs, objects, signedUploads, revoke }) => {
    const bytes = await pdf(1);
    const body = { name: "Base.pdf", requestId: "a".repeat(36), size: bytes.length };
    for (const size of [0, 7, 50 * 1024 * 1024 + 1, 10.5, "100"])
      assert.equal((await request("/library/bases", "manager", { ...body, size })).status, 422);
    assert.equal(signedUploads.length, 0);
    assert.equal((await request("/library/bases", "generator", body)).status, 403);
    const pending = await (await request("/library/bases", "manager", body)).json();
    assert.equal(signedUploads.length, 1);
    assert.equal((await request("/library/bases", "manager", { ...body, size: bytes.length + 1 })).status, 409);
    const meta = { contentType: "application/pdf", size: bytes.length, generation: "10", metadata: {} };
    objects.set(pending.path, { bytes, meta });
    for (const invalid of [
      { size: bytes.length + 1 },
      { contentType: "image/png" },
      { generation: "invalid" },
      { metadata: { uploadedBy: "another-manager" } },
    ]) {
      objects.set(pending.path, { bytes, meta: { ...meta, ...invalid } });
      assert.equal((await request(`/library/bases/${pending.id}/finalize`, "manager", {})).status, 422);
      assert.equal((await request("/library/bases", "manager", body)).status, 409);
    }
    objects.set(pending.path, { bytes, meta });
    const retry = await (await request("/library/bases", "manager", body)).json();
    assert.equal(retry.uploaded, true);
    assert.equal(retry.url, undefined);
    assert.equal((await request(`/library/bases/${pending.id}/finalize`, "generator", {})).status, 403);
    revoke();
    assert.equal((await request(`/library/bases/${pending.id}/finalize`, "manager", {})).status, 403);
    assert.equal(docs.get(`_staffPdfBases/${pending.id}`).status, "uploading");
  }));

test("signed replacements preserve base, mold and alphabet links", async () =>
  scenario(async ({ request, docs, objects }) => {
    const originalBytes = await pdf(2);
    const start = await (await request("/library/bases", "manager", {
      name: "Kit.pdf", requestId: "a".repeat(36),
    })).json();
    objects.set(start.path, {
      bytes: originalBytes,
      meta: { contentType: "application/pdf", size: originalBytes.length, generation: "5", metadata: { uploadedBy: "manager" } },
    });
    await request(`/library/bases/${start.id}/finalize`, "manager", {});
    const ref = `_staffPdfBases/${start.id}`;
    const base = docs.get(ref);
    const alphabet = { folderName: "Kit", letters: { A: { path: `staff-pdf-bases/${start.id}/letters/${"c".repeat(32)}.png` } }, sizePercent: 45 };
    docs.set(ref, { ...base, alphabet, displayName: "Kit renomeado.pdf" });
    const layout = { ...defaultPdfLayout(), base_id: start.id };
    await request("/library/layouts", "manager", { name: "Kit_template__2p", layout });
    const file = new File([await pdf(2)], "Novo arquivo.pdf", { type: "application/pdf" });
    const clientRequest = async (route: string, body: unknown) => {
      const response = await request(`/library${route}`, "manager", body);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data;
    };
    const fetcher: typeof fetch = async (url) => {
      const path = new URL(String(url)).pathname.slice(1);
      objects.set(path, {
        bytes: Buffer.from(await file.arrayBuffer()),
        meta: { contentType: "application/pdf", size: file.size, generation: "11" },
      });
      return new Response(null, { status: 200 });
    };
    const replacement = { id: start.id, revision: base.revision, name: "Kit renomeado.pdf", sourceName: "Kit.pdf" };
    const upload = () => uploadStaffPdfBase(file, "b".repeat(36), replacement, undefined, clientRequest, fetcher);
    assert.equal(await upload(), start.id);
    assert.equal(await upload(), start.id);
    const updated = docs.get(ref);
    assert.equal(updated.name, "Kit.pdf");
    assert.equal(updated.displayName, "Kit renomeado.pdf");
    assert.deepEqual(updated.alphabet, alphabet);
    assert.notEqual(updated.revision, base.revision);
    const library = await (await request("/library", "manager")).json();
    assert.equal(library.bases.length, 1);
    assert.equal(library.pendingUploads.length, 0);
    assert.equal(baseForPdfLayout(library.layouts[0], library.bases)?.id, start.id);
  }));

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
test("the barcode default is shared and validates generator access and dimensions", async () =>
  scenario(async ({ request, docs }) => {
    const original = { widthMm: 45, heightMm: 12, horizontalScale: 1.8 };
    const changed = { widthMm: 60, heightMm: 14, horizontalScale: 1.2 };
    assert.deepEqual((await (await request("/library", "generator")).json()).barcodeDefault, original);
    const route = "/library/barcode-default";
    assert.equal((await request(route, "manager", { size: changed })).status, 403);
    assert.equal((await request(route, "generator", { size: { ...changed, heightMm: 0 } })).status, 422);
    assert.equal((await request(route, "generator", { size: { ...changed, barcode: "ignored" } })).status, 200);
    assert.deepEqual(docs.get("_staffPdfSettings/barcode"), changed);
    assert.deepEqual((await (await request("/library", "manager")).json()).barcodeDefault, changed);
    assert.equal((await request(route, "generator", { size: original })).status, 200);
    assert.deepEqual(docs.get("_staffPdfSettings/barcode"), original);
  }));
test("saving a mold publishes its changes to products and variations with the same layout ID", async () =>
  scenario(async ({ request, docs }) => {
    const name = "Vinculado_template";
    const first = await request("/library/layouts", "manager", { name, layout: defaultPdfLayout() });
    assert.equal(first.status, 200);
    const { id } = await first.json();
    const ref = `_staffPdfLayouts/${id}`;
    const previous = docs.get(ref);
    const pdf = { id: "a".repeat(32), path: "catalog/templates/example/base.pdf" };
    const bound = { revision: "b".repeat(32), layoutId: id, layoutRevision: previous.revision, layout: previous.layout, fonts: [], pdf };
    const other = { ...bound, layoutId: "c".repeat(32) };
    docs.set("anuncios/linked", { nome: "Produto", moldePdf: bound, atributos: [{
      nome: "Estilo", opcoes: ["A", "B"], configuracao: { A: { moldePdf: bound }, B: { moldePdf: other } },
    }] });
    docs.set("orders/paid", { itens: [{ moldePedido: { layout: previous.layout } }] });
    const response = await request("/library/layouts", "manager", {
      id, name: "Molde renomeado", revision: previous.revision,
      layout: { ...previous.layout, font_name: "FreeMono", font_size: 222, initial_size_percent: 49 },
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { id, updatedProducts: 1 });
    const stored = docs.get("anuncios/linked"), current = docs.get(ref);
    assert.equal(current.name, "Molde renomeado");
    assert.deepEqual(current.previousNames, [name]);
    for (const binding of [stored.moldePdf, stored.atributos[0].configuracao.A.moldePdf]) {
      assert.notEqual(binding.revision, bound.revision);
      assert.equal(binding.layoutRevision, current.revision);
      assert.equal(binding.layout.font_size, 222);
      assert.equal(binding.layout.initial_size_percent, 49);
      assert.equal(binding.fonts[0].id, "mono");
      assert.deepEqual(binding.pdf, pdf);
    }
    assert.deepEqual(stored.atributos[0].configuracao.B.moldePdf, other);
    assert.equal(docs.get("orders/paid").itens[0].moldePedido.layout.font_size, 150);
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
    assert.equal(docs.has(`_staffPdfLayouts/${id}`), false);
    assert.ok([...docs.keys()].some((key) => key.startsWith("_catalogTrash/")));
    const before = docs.size;
    await request("/library/layouts/import", "manager", {
      templates: { good: defaultPdfLayout(), bad: { color: "red" } },
    });
    assert.equal(docs.size, before);
  }));
test("renaming an internal PDF preserves its file, revision, legacy mold and alphabet", async () =>
  scenario(async ({ request, docs, signatures }) => {
    const id = "a".repeat(32), revision = "b".repeat(32);
    const ref = `_staffPdfBases/${id}`, path = staffPdfStoragePath(id);
    const letterPath = `staff-pdf-bases/${id}/letters/${"d".repeat(32)}.png`;
    const nameIndex = `_staffPdfBaseNames/${pdfLibraryId("Kit.pdf")}`;
    const alphabet = { folderName: "Kit", letters: { A: { path: letterPath } }, sizePercent: 45 };
    const original = { status: "ready", name: "Kit.pdf", revision, path, generation: "5", alphabet, pageCount: 4, pages: [] };
    docs.set(ref, original);
    docs.set(nameIndex, { baseId: id });
    const moldId = "c".repeat(32);
    const mold = { name: "Kit_template__4p", enabled: true, revision: moldId, layout: defaultPdfLayout() };
    docs.set(`_staffPdfLayouts/${moldId}`, mold);
    const route = `/library/bases/${id}/rename`;
    const input = { name: "Coleção de Cadernos", expectedName: "Kit.pdf", baseRevision: revision };
    assert.equal((await request(route, "generator", input)).status, 403);
    assert.equal((await request(route, "manager", { ...input, name: "../base" })).status, 422);
    assert.equal((await request(route, "manager", { ...input, baseRevision: "0".repeat(32) })).status, 409);
    assert.equal((await request(route, "manager", input)).status, 200);
    assert.equal((await request(route, "manager", input)).status, 200);
    assert.equal((await request(route, "manager", { ...input, name: "Outra base" })).status, 409);
    const library = await (await request("/library", "manager")).json();
    assert.equal(library.bases[0].name, "Coleção de Cadernos.pdf");
    assert.equal(library.bases[0].sourceName, "Kit.pdf");
    assert.equal(baseForPdfLayout(library.layouts[0], library.bases)?.id, id);
    for (const label of ["Kit", "Coleção de Cadernos"]) {
      assert.deepEqual(resolveStaffPdfCsvModel(label, library.bases, library.layouts), { baseId: id, layoutId: moldId });
    }
    const initial = await request(`/library/bases/${id}/initial?letter=A`, "generator");
    assert.deepEqual(await initial.json(), { url: `https://signed.example.test/${letterPath}`, sizePercent: 45 });
    assert.deepEqual(signatures, [letterPath]);
    const saved = docs.get(ref);
    for (const [key, value] of Object.entries(original)) assert.deepEqual(saved[key], value);
    assert.deepEqual(docs.get(`_staffPdfLayouts/${moldId}`), mold);
    assert.deepEqual(docs.get(nameIndex), { baseId: id });
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
      true,
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

test("decorative letters use the folder stem of an imported template and preserve the uploaded PNG", async () =>
  scenario(async ({ request, docs, objects }) => {
    const id = "a".repeat(32),
      revision = "b".repeat(32),
      path = `staff-pdf-bases/${id}/letters/${"c".repeat(32)}.png`,
      accentedPath = `staff-pdf-bases/${id}/letters/${"d".repeat(32)}.png`;
    docs.set(`_staffPdfBases/${id}`, {
      name: "Alfabeto_template__2p.pdf",
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
    objects.set(accentedPath, objects.get(path)!);
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
          letters: { A: { path }, É: { path: accentedPath }, E: { path } },
        })
      ).status,
      200,
    );
    for (const [letter, expectedPath] of [
      ["A", path],
      ["E", path],
      ["e\u0301", accentedPath],
      ["Ê", path],
    ]) {
      const initial = await request(
        `/library/bases/${id}/initial?letter=${encodeURIComponent(letter)}`,
        "generator",
      );
      assert.equal(initial.status, 200);
      assert.equal(
        (await initial.json()).url,
        `https://signed.example.test/${expectedPath}`,
      );
    }
    assert.deepEqual(objects.get(accentedPath).bytes, png);
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
    const layoutId = pdfLibraryId("Marrom_template");
    const mold = {
      enabled: true,
      name: "Marrom_template",
      revision,
      layout: { ...defaultPdfLayout(), base_id: "f".repeat(32) },
    };
    const layoutPath = `_staffPdfLayouts/${layoutId}`;
    docs.set(layoutPath, mold);
    const alias = {
      folderName: "Marrom",
      layoutId,
      letters: { É: { path: accentedPath } },
    };
    assert.equal(
      (await request(`/library/bases/${id}/alphabet`, "manager", alias)).status,
      409,
    );
    docs.set(layoutPath, { ...mold, layout: { ...mold.layout, base_id: id } });
    assert.equal(
      (
        await request(`/library/bases/${id}/alphabet`, "manager", {
          ...alias,
          baseRevision: revision,
        })
      ).status,
      409,
    );
    assert.equal(
      (await request(`/library/bases/${id}/alphabet`, "manager", alias)).status,
      200,
    );
    const library = await (await request("/library", "manager")).json();
    assert.equal(
      library.bases.find((base: { id: string }) => base.id === id)
        .initialFolderName,
      "Marrom",
    );
    const linked = await (
      await request(`/library/bases/${id}/initial?letter=%C3%89`, "generator")
    ).json();
    assert.equal(linked.url, `https://signed.example.test/${accentedPath}`);
  }));

test("batch recipes snapshot inputs, preserve tracking and enforce ownership, idempotence and three-day expiry", async () =>
  scenario(async ({ request, docs, objects, services, advance, time, downloads }) => {
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
      barcodeVersion: 2,
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
    assert.equal(recipe.job.barcodeVersion, 2);
    assert.equal(recipe.job.outputName, "Kit ANA BR2684621549924");
    const withoutBarcode = {
      job: { ...job, barcode: "", barcodeVersion: undefined, outputName: "Kit ANA" },
      requestId: "f".repeat(36),
    };
    const optional = await request(`/library/batches/${batch.id}/items`, "generator", withoutBarcode);
    assert.equal(optional.status, 201);
    const optionalRecipe = await optional.json();
    assert.equal(optionalRecipe.job.barcode, undefined);
    assert.equal(optionalRecipe.item.outputName, "Kit ANA");
    assert.equal(optionalRecipe.item.barcode, undefined);
    // Recreate the original ID scheme for a recipe started before the fix.
    const legacyId = createHash("sha256")
      .update(`generator:${withoutBarcode.requestId}`).digest("hex").slice(0, 32);
    const optionalPath = `_staffPdfBatchItems/${optionalRecipe.item.id}`;
    docs.set(`_staffPdfBatchItems/${legacyId}`, docs.get(optionalPath)!);
    docs.delete(optionalPath);
    const resumed = await request(`/library/batches/${batch.id}/items`, "generator", withoutBarcode);
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).item.id, legacyId);

    const secondBatch = await request("/library/batches", "generator", { requestId: "e".repeat(36) });
    assert.equal(secondBatch.status, 201);
    const { batch: rerun } = await secondBatch.json();
    const rerunPath = `/library/batches/${rerun.id}/items`;
    const rerunBody = { ...withoutBarcode, job: { ...withoutBarcode.job, outputName: "Kit ANA REFEITO" } };
    const retries = await Promise.all([
      request(rerunPath, "generator", rerunBody),
      request(rerunPath, "generator", rerunBody),
    ]);
    assert.deepEqual(retries.map(({ status }) => status).sort(), [200, 201]);
    const [first, retry] = await Promise.all(retries.map((response) => response.json()));
    assert.equal(first.item.id, retry.item.id);
    assert.notEqual(first.item.id, legacyId);
    assert.equal(first.item.outputName, "Kit ANA REFEITO");
    assert.equal((await request(`${rerunPath}/${legacyId}`, "generator")).status, 404);
    const newRerun = await request(rerunPath, "generator", body);
    assert.equal(newRerun.status, 201);
    assert.notEqual((await newRerun.json()).item.id, recipe.item.id);
    assert.equal((await (await request(rerunPath, "generator")).json()).items.length, 2);
    assert.equal(docs.get(`_staffPdfBatches/${rerun.id}`)?.itemCount, 2);
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
    const itemUrl = `/library/batches/${batch.id}/items/${recipe.item.id}`;
    assert.equal((await request(`${itemUrl}/complete`, "generator", {})).status, 409);
    const bytes = Buffer.from(await pdf(2));
    const upload = { size: bytes.length, crc32: crc32(bytes).toString(16).padStart(8, "0") };
    assert.equal((await request(`${itemUrl}/upload`, "generator", { ...upload, size: 51 * 1024 * 1024 })).status, 422);
    assert.equal((await request(`${itemUrl}/upload`, "customer", upload)).status, 403);
    const signed = await (await request(`${itemUrl}/upload`, "generator", upload)).json();
    const pathToOutput = staffPdfBatchFilePath(batch.id, recipe.item.id);
    assert.equal(signed.url, `https://signed.example.test/${pathToOutput}`);
    assert.equal(signed.headers["x-goog-if-generation-match"], "0");
    assert.equal(signed.headers["x-goog-meta-zipcrc"], upload.crc32);
    objects.set(pathToOutput, { bytes, meta: {
      generation: "999", size: bytes.length, contentType: "application/pdf", metadata: { zipcrc: upload.crc32 },
    } });
    assert.equal((await (await request(itemUrl, "generator")).json()).uploadExists, true);
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
    const savedFile = await (await request(`${itemUrl}/file`, "generator")).json();
    assert.equal(savedFile.file.url, signed.url);
    const archiveUrl = `/library/batches/${batch.id}/archive`;
    assert.equal((await request(archiveUrl, "customer", {})).status, 403);
    const legacyDoc = docs.get(`_staffPdfBatchItems/${legacyId}`)!;
    docs.set(`_staffPdfBatchItems/${legacyId}`, { ...legacyDoc, status: "ready" });
    assert.deepEqual(await (await request(archiveUrl, "generator", {})).json(), { legacy: [legacyId] });
    objects.set(staffPdfBatchFilePath(batch.id, legacyId), { bytes, meta: {
      generation: "1000", size: bytes.length, contentType: "application/pdf", metadata: { zipcrc: upload.crc32 },
    } });
    assert.equal((await request(`/library/batches/${batch.id}/items/${legacyId}/complete`, "generator", {})).status, 200);
    assert.equal((await request(archiveUrl, "customer", { format: "pdf" })).status, 403);
    const direct = await (await request(archiveUrl, "generator", { format: "pdf" })).json();
    assert.equal(direct.name, `${batch.reference}.pdf`);
    const directPath = new URL(direct.url).pathname.slice(1);
    const combined = objects.get(directPath)!.bytes;
    assert.equal((await PDFDocument.load(combined)).getPageCount(), 4);
    assert.ok(![...objects.keys()].some((path) => path.endsWith(".zip")));
    const originalReads = downloads.filter((path) => path.includes("/files/")).length;
    const result = await (await request(archiveUrl, "generator", {})).json();
    assert.equal(result.name, `${batch.reference}.zip`);
    const zipPath = new URL(result.url).pathname.slice(1);
    const zip = unzipSync(objects.get(zipPath)!.bytes);
    assert.deepEqual(Buffer.from(zip["Kit ANA BR2684621549924.pdf"]), bytes);
    assert.deepEqual(Buffer.from(zip["Kit ANA.pdf"]), bytes);
    assert.deepEqual(Buffer.from(zip["Lote completo.pdf"]), combined);
    assert.equal(downloads.filter((path) => path.includes("/files/")).length, originalReads);
    const readCount = downloads.length;
    assert.equal((await (await request(archiveUrl, "generator", {})).json()).url, result.url);
    assert.equal((await (await request(archiveUrl, "generator", { format: "pdf" })).json()).url, direct.url);
    assert.equal((await (await request("/library/batches", "another-generator")).json()).batches[0].id, batch.id);
    assert.equal((await request(`/library/batches/${batch.id}/items/${recipe.item.id}/file`, "another-generator")).status, 200);
    assert.equal((await request(archiveUrl, "another-generator", { format: "pdf" })).status, 200);
    assert.equal((await request(`/library/batches/${batch.id}/items/${recipe.item.id}/upload`, "another-generator", upload)).status, 404);
    assert.equal(downloads.length, readCount);
    const activities = [...docs.keys()].filter((key) =>
      key.startsWith("_operationsActivity/"),
    );
    assert.equal(activities.length, 1);
    const channelRequest = { requestId: "0".repeat(36), marketplace: "shopee", name: "Produção - Shopee" };
    const classifiedBatch = await request("/library/batches", "generator", channelRequest);
    assert.equal(classifiedBatch.status, 201);
    const { batch: shopee } = await classifiedBatch.json();
    assert.equal(shopee.marketplace, "shopee");
    assert.equal((await (await request("/library/batches", "generator", channelRequest)).json()).batch.id, shopee.id);
    assert.equal((await request("/library/batches", "generator", { ...channelRequest, marketplace: "tiktok" })).status, 409);
    const shopeeItems = "/library/batches/" + shopee.id + "/items";
    assert.equal((await request(shopeeItems, "generator", body)).status, 409);
    assert.equal((await request(shopeeItems, "generator", { ...body, job: { ...job, marketplace: "tiktok" } })).status, 409);
    const shopeeItem = await request(shopeeItems, "generator", { ...body, job: { ...job, marketplace: "shopee" } });
    assert.equal(shopeeItem.status, 201);
    assert.equal((await shopeeItem.json()).job.marketplace, "shopee");
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
      deleted: 3,
      failed: 0,
    });
    assert.equal(
      [...objects.keys()].some((key) => key.startsWith("staff-pdf-batches/")),
      false,
    );
    assert.equal(docs.has(`_staffPdfBatches/${batch.id}`), false);
    assert.equal(docs.has(`_staffPdfBatches/${shopee.id}`), false);
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
        letters: { Á: { path: initialPath } },
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
    line.text = "Ágata";
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
    docs.get(`_staffPdfLayouts/${layoutId}`).layout.initial_size_percent = 42;
    const resized = await request(
      `/library/batches/${batch.id}/items`,
      "generator",
      {
        ...body,
        requestId: "1".repeat(36),
      },
    );
    assert.equal(resized.status, 201);
    assert.equal((await resized.json()).initial.sizePercent, 42);
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

test("PDF categories isolate identical filenames and retain the original category when replacing a base", async () =>
  scenario(async ({ request, docs, objects, services }) => {
    async function create(category: string, id: string, replacement?: unknown) {
      return request("/library/bases", "manager", {
        name: "Kit.pdf",
        category,
        requestId: id.repeat(36),
        replacement,
      });
    }
    async function finish(pending: { id: string; path: string }) {
      const bytes = await pdf(2);
      objects.set(pending.path, {
        bytes,
        meta: {
          contentType: "application/pdf",
          size: bytes.length,
          generation: "1",
          metadata: { uploadedBy: "manager" },
        },
      });
      assert.equal(
        (await request(`/library/bases/${pending.id}/finalize`, "manager", {}))
          .status,
        200,
      );
    }
    const first = await create("Cadernetas", "a");
    assert.equal(first.status, 201);
    const a = await first.json();
    await finish(a);
    const second = await create("Agendas", "b");
    assert.equal(second.status, 201);
    const b = await second.json();
    await finish(b);
    const listing = await (await request("/library", "manager")).json();
    assert.deepEqual(listing.bases.map((base: any) => base.category).sort(), [
      "Agendas",
      "Cadernetas",
    ]);
    assert.equal((await create("Cadernetas", "c")).status, 409);
    assert.equal((await create("../Privado", "d")).status, 422);
    const base = await resolveStaffPdfBase(services, a.id);
    const replace = await create("Cadernetas", "e", {
      id: a.id,
      revision: base.revision,
    });
    assert.equal(replace.status, 201);
    await finish(await replace.json());
    assert.equal(
      (await resolveStaffPdfBase(services, a.id)).category,
      "Cadernetas",
    );
    assert.equal(
      (await resolveStaffPdfBase(services, b.id)).category,
      "Agendas",
    );
    assert.equal(
      (await request(`/library/bases/${a.id}/delete`, "manager", {})).status,
      200,
    );
    assert.equal((await create("Cadernetas", "f")).status, 201);
    assert.equal(docs.get(`_staffPdfBases/${b.id}`).status, "ready");
  }));

test("product binding copies catalog PDF, previews and initials without client downloads", async () =>
  scenario(
    async ({ request, docs, objects, services, downloads, signatures }) => {
      const id = "b".repeat(32);
      const pdfPath = `catalog/templates/source/${id}.pdf`;
      const pagePath = `catalog/products/source/${"c".repeat(32)}.webp`;
      const letterPath = `catalog/products/source/${"d".repeat(32)}.png`;
      const url = (path: string) =>
        `https://firebasestorage.googleapis.com/v0/b/${services.bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
      const file = await pdf(1);
      for (const [path, type, bytes] of [
        [pdfPath, "application/pdf", file],
        [pagePath, "image/webp", Buffer.from("cover")],
        [letterPath, "image/png", Buffer.from("initial")],
      ] as const)
        objects.set(path, {
          bytes,
          meta: {
            generation: "25",
            contentType: type,
            size: bytes.length,
            metadata: { firebaseStorageDownloadTokens: "old-token" },
          },
        });
      docs.set("anuncios/source", {
        modelosPdf: [
          {
            id,
            path: pdfPath,
            name: "Flores.pdf",
            pages: [url(pagePath)],
            alphabet: {
              folderName: "Flores",
              sizePercent: 70,
              letters: { É: { path: letterPath, url: url(letterPath) } },
            },
          },
        ],
      });
      const base = await resolveStaffPdfBase(services, `catalog_source_${id}`);
      const path = `/library/bases/${base.id}/product-copy`;
      const body = { productId: "target", baseRevision: base.revision };
      assert.equal((await request(path, "generator", body)).status, 403);
      assert.equal(
        (await request(path, "root", { ...body, baseRevision: "stale" }))
          .status,
        409,
      );
      assert.equal(objects.size, 3);
      const response = await request(path, "root", body);
      assert.equal(response.status, 200);
      const { template, assets, sourceUrl } = await response.json();
      assert.equal(sourceUrl, undefined);
      assert.equal(template.pages.length, 1);
      assert.match(
        decodeURIComponent(template.pages[0]),
        /catalog\/products\/target\//,
      );
      assert.equal(template.alphabet.sizePercent, 70);
      assert.equal(assets.length, 3);
      assert.equal(
        [...docs.keys()].filter((key) =>
          key.startsWith("_catalogAssetCleanup/"),
        ).length,
        3,
      );
      assert.deepEqual(objects.get(template.path).bytes, file);
      assert.equal(
        objects.get(template.path).meta.metadata.firebaseStorageDownloadTokens,
        undefined,
      );
      assert.equal(
        objects.get(template.alphabet.letters.É.path).bytes.toString(),
        "initial",
      );
      assert.ok(
        template.alphabet.letters.É.url.includes(
          objects.get(template.alphabet.letters.É.path).meta.metadata
            .firebaseStorageDownloadTokens,
        ),
      );
      assert.deepEqual(downloads, []);
      assert.deepEqual(signatures, []);
    },
  ));

test("ZIP64 records offsets past 4 GiB with no total-byte cutoff", () => {
  const bytes = 50 * 1024 * 1024;
  const rows = Array.from({ length: 100 }, () => ({ name: "Arquivo", bytes, crc32: 0 }));
  const { localHeaders, directory } = staffPdfZipEntries(rows);
  assert.equal(localHeaders.length, rows.length);
  assert.equal(localHeaders[1].subarray(30).toString(), "Arquivo (2).pdf");
  const offset = localHeaders.reduce((sum, header) => sum + header.length + bytes, 0);
  assert.ok(offset > 0xffffffff);
  const zip64 = directory.subarray(-98);
  assert.equal(zip64.readUInt32LE(0), 0x06064b50);
  assert.equal(zip64.readBigUInt64LE(32), 100n);
  assert.equal(zip64.readBigUInt64LE(48), BigInt(offset));
  assert.equal(directory.readUInt32LE(directory.length - 6), 0xffffffff);

  const largeEntryBytes = 5 * 1024 ** 3;
  const largeEntry = staffPdfZipEntries([{ name: "Lote completo", bytes: largeEntryBytes, crc32: 0 }]);
  const local = largeEntry.localHeaders[0];
  assert.equal(local.readUInt32LE(18), 0xffffffff);
  assert.equal(local.readUInt16LE(28), 20);
  assert.equal(local.readBigUInt64LE(local.length - 16), BigInt(largeEntryBytes));
  assert.equal(local.readBigUInt64LE(local.length - 8), BigInt(largeEntryBytes));
  assert.equal(largeEntry.directory.readUInt32LE(20), 0xffffffff);
  const centralExtra = 46 + largeEntry.directory.readUInt16LE(28);
  assert.equal(largeEntry.directory.readBigUInt64LE(centralExtra + 4), BigInt(largeEntryBytes));
});

test("an archive resumes both stages and preserves the page order of all 501 stored PDFs", async () =>
  scenario(async ({ request, docs, objects, downloads }) => {
    const create = await request("/library/batches", "generator", { requestId: "c".repeat(36), name: "Lote único" });
    assert.equal(create.status, 201);
    const { batch } = await create.json();
    const count = 501;
    let lastBytes: Buffer;
    for (let i = 0; i < count; i++) {
      const id = (count - i - 1).toString(16).padStart(32, "0");
      const document = await PDFDocument.create();
      document.addPage([600 + i, 840]);
      document.addPage([600 + i, 841]);
      const bytes = Buffer.from(await document.save());
      lastBytes = bytes;
      const output = { bytes: bytes.length, crc32: crc32(bytes), generation: "10" };
      docs.set(`_staffPdfBatchItems/${id}`, {
        batchId: batch.id, ownerId: "generator", position: i + 1,
        job: { outputName: "Álbum" }, status: "ready", pdf: output,
      });
      objects.set(staffPdfBatchFilePath(batch.id, id), {
        bytes, meta: { generation: output.generation },
      });
    }
    Object.assign(docs.get(`_staffPdfBatches/${batch.id}`)!, {
      fileCount: count, itemCount: count, archive: { fileCount: count, fingerprint: "a".repeat(64) },
    });
    const items = `/library/batches/${batch.id}/items`;
    const firstPage = await (await request(items, "generator")).json();
    const lastPage = await (await request(`${items}?cursor=${firstPage.next}`, "generator")).json();
    assert.equal(firstPage.items.length, 500);
    assert.equal(lastPage.items.length, 1);
    assert.equal(lastPage.next, undefined);
    assert.equal(lastPage.items[0].id, (count - 1).toString(16).padStart(32, "0"));
    const endpoint = `/library/batches/${batch.id}/archive`;
    const stages = new Set();
    let built = await (await request(endpoint, "generator", {})).json();
    assert.equal(built.progress.stage, "merge");
    // A fresh caller can resume without the previous browser's cursor.
    built = await (await request(endpoint, "generator", {})).json();
    for (let i = 0; built.progress && i < 20; i++) {
      stages.add(built.progress.stage);
      built = await (await request(endpoint, "generator", built.progress)).json();
    }
    assert.deepEqual(stages, new Set(["merge", "zip"]));
    assert.equal(built.name, "Lote único.zip");
    const zipped = unzipSync(objects.get(new URL(built.url).pathname.slice(1))!.bytes);
    assert.equal(Object.keys(zipped).length, count + 1);
    assert.deepEqual(Buffer.from(zipped["Álbum (501).pdf"]), lastBytes!);
    const merged = await PDFDocument.load(zipped["Lote completo.pdf"]);
    assert.equal(merged.getPageCount(), count * 2);
    for (let i = 0; i < count; i++) {
      assert.deepEqual(merged.getPage(i * 2).getSize(), { width: 600 + i, height: 840 });
      assert.deepEqual(merged.getPage(i * 2 + 1).getSize(), { width: 600 + i, height: 841 });
    }
    assert.equal(downloads.filter((path) => path.includes("/files/")).length, count);
    const readCount = downloads.length;
    assert.equal((await (await request(endpoint, "generator", {})).json()).url, built.url);
    assert.equal(downloads.length, readCount);
  }));

test("a categoria das etiquetas é compartilhada, idempotente e protege escolhas concorrentes", async () =>
  scenario(async ({request}) => {
    const route = "/library/label-categories", key = "a".repeat(64);
    const create = (name:string) => request(route + "/create","generator",{name});
    const lookup = () => request(route + "/lookup","another-generator",{keys:[key]});
    assert.equal((await request(route + "/create","manager",{name:"Adesivos"})).status,403);
    assert.equal((await create(" ")).status,422);
    assert.deepEqual(await (await lookup()).json(), {categories:[],assignments:{}});
    const [a,b] = await Promise.all([create("Caderneta saúde"),create("  Caderneta SAUDE  ")]);
    const cat = await a.json();
    assert.deepEqual(cat,await b.json());
    const second = await (await create("Adesivos")).json();
    const assign = (categoryId:string, role = "generator") => request(route + "/assign",role,{key,categoryId});
    assert.equal((await assign("c".repeat(64))).status,404);
    const both = await Promise.all([assign(cat.id), assign(second.id,"another-generator")]);
    assert.deepEqual(both.map(r=>r.status).sort(),[200,409]);
    const {assignments,categories} = await (await lookup()).json();
    assert.equal(categories.length,2);
    assert.equal((await assign(assignments[key])).status,200);
    assert.equal((await request(route + "/lookup","generator",{keys:["malformado"]})).status,422);
  }));

test("as etiquetas são PDFs privados de uma página, compartilhados e removidos pelo número original", async () =>
  scenario(async ({ request, objects, docs }) => {
    const root = "/library/label-categories/archive/";
    const id = "a".repeat(64);
    const call = (path: string, data: object, role = "generator") => request(root + path, role, data);
    for (const path of [
      "list",
      "read",
      "begin",
      "upload/part",
      "upload/pages",
      "identify",
      "links",
      "confirm",
      "remove",
    ])
      assert.equal((await call(path, {}, "manager")).status, 403);
    const begin = async () => (await call("begin", { id, name: "semana.pdf", total: 3 })).json();
    const { revision } = await begin();
    const ref = { id, revision };
    const one = Buffer.from(await pdf(1));
    const label = { products: [{ sku: "10", description: "Adesivo", variation: "" }] };
    const upload = (pages: any[]) => call("upload/pages", { ...ref, pages });
    const send = (number: number) => upload([{ number, data: one.toString("base64"), label }]);
    assert.equal(
      (await upload([{ number: 2, data: Buffer.from(await pdf(2)).toString("base64"), label }])).status,
      422,
    );
    assert.equal((await send(1)).status, 200);
    assert.equal((await send(1)).status, 200);
    assert.equal((await begin()).count, 1);
    assert.equal((await call("confirm", ref)).status, 409);
    assert.equal((await begin()).revision, revision);
    const half = Math.floor(one.length / 2);
    assert.equal(
      (
        await call("upload/part", {
          ...ref,
          number: 2,
          part: 1,
          data: one.subarray(0, half).toString("base64"),
        })
      ).status,
      200,
    );
    assert.equal((await upload([{ number: 2, parts: 2, label }])).status, 409);
    assert.equal(
      (
        await call("upload/part", {
          ...ref,
          number: 2,
          part: 2,
          data: one.subarray(half).toString("base64"),
        })
      ).status,
      200,
    );
    assert.equal((await upload([{ number: 2, parts: 2, label }])).status, 200);
    assert.equal((await send(3)).status, 200);
    assert.equal((await begin()).state, "ready");
    assert.equal([...docs.keys()].filter((k) => String(k).includes("/parts/")).length, 0);
    assert.equal(objects.size, 3);
    for (const stored of objects.values())
      assert.equal((await PDFDocument.load(stored.bytes)).getPageCount(), 1);
    const links = (numbers: number[]) => call("links", { ...ref, numbers }, "another-generator");
    assert.equal((await links([2])).status, 200);
    assert.equal((await call("remove", { ...ref, number: 2 }, "another-generator")).status, 200);
    assert.equal(objects.size, 2);
    assert.equal((await links([2])).status, 409);
    const visible = await (await call("read", { ...ref, after: 0 }, "another-generator")).json();
    assert.deepEqual(
      visible.pages.map((p: any) => p.number),
      [1, 3],
    );
    assert.equal((await begin()).count, 2);
    assert.equal((await send(2)).status, 409);
    assert.equal((await call("remove", ref)).status, 200);
    assert.equal(objects.size, 0);
    assert.deepEqual(await (await call("list", {})).json(), []);
    const fresh = await begin();
    assert.notEqual(fresh.revision, revision);
    assert.equal((await call("remove", ref)).status, 409);
  }));

test("renomear uma categoria legada mantém os vínculos e recriar um nome excluído exige nova classificação", async () =>
  scenario(async ({ request, docs }) => {
    const root = "/library/label-categories/",
      key = "f".repeat(64);
    const id = createHash("sha256").update("cadernos").digest("hex");
    docs.set("_staffLabelCategories/" + id, { name: "Cadernos" });
    const call = (path: string, body: object) => request(root + path, "generator", body);
    assert.equal((await call("assign", { key, categoryId: id })).status, 200);
    assert.equal((await call("rename", { id, expectedName: "Cadernos", name: "Agendas" })).status, 200);
    assert.equal((await (await call("create", { name: "Agendas" })).json()).id, id);
    const other = await (await call("create", { name: "Cadernos" })).json();
    assert.notEqual(other.id, id);
    assert.equal((await call("rename", { id, expectedName: "Agendas", name: "Cadernos" })).status, 409);
    assert.equal((await call("remove", { id, expectedName: "Cadernos" })).status, 409);
    assert.equal((await (await call("lookup", { keys: [key] })).json()).assignments[key], id);
    assert.equal((await call("remove", { id, expectedName: "Agendas" })).status, 200);
    assert.deepEqual(
      (await (await call("lookup", { keys: [key], includeCategories: false })).json()).assignments,
      {},
    );
    const replacement = await (await call("create", { name: "Agendas" })).json();
    assert.notEqual(replacement.id, id);
    assert.equal((await call("assign", { key, categoryId: replacement.id })).status, 200);
  }));

test("cancelamentos preservam individuais e produzem PDFs persistidos separados em ordem", async () =>
  scenario(async ({ request, objects, downloads, docs }) => {
    const root = "/library/label-categories/archive/";
    const call = (action: string, body: object, role = "generator") =>
      request(root + action, role, body);
    const id = "e".repeat(64);
    const header = await (await call("begin", { id, name: "semana.pdf", total: 27 })).json();
    const ref = { id, revision: header.revision };
    const rows = [];
    for (let n = 1; n <= 27; n++) {
      const pdf = await PDFDocument.create();
      pdf.addPage([100 + n, 200]);
      rows.push({
        number: n,
        data: Buffer.from(await pdf.save()).toString("base64"),
        label:
          n <= 3
            ? { products: [], issue: "Sem identificação" }
            : { products: [{ sku: "ABC", description: "Agenda", variation: "" }] },
      });
    }
    for (let i = 0; i < rows.length; i += 24)
      assert.equal((await call("upload/pages", { ...ref, pages: rows.slice(i, i + 24) })).status, 200);
    assert.equal((await call("exclude", { ...ref, numbers: [1] }, "manager")).status, 403);
    assert.equal((await call("export", { ...ref, kind: "active" }, "manager")).status, 403);
    async function exportPdf(kind: string) {
      let version: number | undefined;
      for (let i = 0; i < 6; i++) {
        const response = await call("export", { ...ref, kind, version }, "another-generator");
        assert.equal(response.status, 200, await response.clone().text());
        const result = await response.json();
        if (result.url) {
          const saved = objects.get(new URL(result.url).pathname.slice(1));
          assert.ok(saved);
          return { result, pdf: await PDFDocument.load(saved.bytes) };
        }
        version = result.version;
      }
      throw new Error("Exportação não terminou.");
    }
    const original = await exportPdf("active");
    assert.equal(original.pdf.getPageCount(), 27);
    const readCount = downloads.length;
    await exportPdf("active");
    assert.equal(downloads.length, readCount, "PDF pronto deve ser reutilizado");
    assert.equal((await call("confirm", ref)).status, 409);
    assert.equal((await call("exclude", { ...ref, numbers: [1, 2] })).status, 200);
    const selectionVersion = docs.get("_staffLabelImports/" + id).selectionVersion;
    assert.equal((await call("exclude", { ...ref, numbers: [1, 2] })).status, 200);
    assert.equal(docs.get("_staffLabelImports/" + id).selectionVersion, selectionVersion);
    assert.equal((await call("export", { ...ref, kind: "active", version: 0 })).status, 409);
    assert.equal((await call("exclude", { ...ref, numbers: [3] })).status, 200);
    const active = await exportPdf("active"),
      excluded = await exportPdf("excluded");
    assert.deepEqual(
      active.pdf.getPages().map((p) => p.getWidth()),
      Array.from({ length: 24 }, (_, i) => 104 + i),
    );
    assert.deepEqual(
      excluded.pdf.getPages().map((p) => p.getWidth()),
      [101, 102, 103],
    );
    for (let n = 1; n <= 27; n++)
      assert.ok(objects.has("staff-label-imports/" + id + "/" + ref.revision + "/" + n + ".pdf"));
    const category = await (
      await request("/library/label-categories/create", "generator", { name: "Agendas" })
    ).json();
    const key = createHash("sha256")
      .update(JSON.stringify(["sku", "ABC"]))
      .digest("hex");
    await request("/library/label-categories/assign", "generator", { key, categoryId: category.id });
    assert.equal(
      (await call("confirm", ref)).status,
      200,
      "pendências excluídas deixam de bloquear a revisão",
    );
    const listing = await (await call("list", {})).json();
    assert.equal(listing[0].excludedCount, 3);
    assert.equal(listing[0].count, 27);
    const read = await (await call("read", { ...ref, after: 0 })).json();
    assert.equal(read.pages.filter((p: any) => p.excluded).length, 3);
    for (let i = 0; i < 20; i++) {
      const reply = await (await call("remove", ref)).json();
      if (reply.done) break;
      if (i === 19) throw new Error("A exclusão do arquivo não terminou.");
    }
    assert.equal(objects.size, 0, "remover o arquivo também limpa os PDFs agrupados");
  }));

test("remover o último PDF pelo fluxo anterior também limpa as exportações do arquivo", async () =>
  scenario(async ({ request, objects }) => {
    const root = "/library/label-categories/archive/";
    const call = (action: string, body: object) => request(root + action, "generator", body);
    const id = "d".repeat(64);
    const header = await (await call("begin", { id, name: "antigo.pdf", total: 1 })).json();
    const ref = { id, revision: header.revision };
    await call("upload/pages", {
      ...ref,
      pages: [
        {
          number: 1,
          data: Buffer.from(await pdf(1)).toString("base64"),
          label: { products: [], issue: "Revisar" },
        },
      ],
    });
    await call("export", { ...ref, kind: "active" });
    await call("export", { ...ref, kind: "active" });
    for (let i = 0; i < 5; i++)
      if ((await (await call("remove", { ...ref, number: 1 })).json()).done) break;
    assert.equal(objects.size, 0);
    assert.deepEqual(await (await call("list", {})).json(), []);
  }));
