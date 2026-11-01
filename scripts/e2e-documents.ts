import type express from "express";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createStaffDocumentRouters } from "../src/server/staffDocuments.js";
import { OperationsError } from "../src/lib/operations.js";
import type { Firestore } from "firebase-admin/firestore";
/** Isolated E2E bucket and email stub. Never imported by production. */
export function mountE2EDocuments(app: express.Express, db: Firestore) {
  process.env.RESEND_API_KEY = "e2e-never-network";
  process.env.EMAIL_FROM = "orders@example.test";
  process.env.APP_URL = "https://example.test";
  const objects = new Map<string, { bytes: Buffer; metadata: any }>(),
    signed = new Map<string, string>();
  let generation = 1;
  const entry = async (name: string) => {
    if (!objects.has(name) && name.startsWith("catalog/templates/")) {
      const bytes = await readFile(
        new URL("../e2e/fixtures/editor-template.pdf", import.meta.url),
      );
      objects.set(name, {
        bytes,
        metadata: {
          contentType: "application/pdf",
          size: bytes.length,
          generation: String(++generation),
        },
      });
    }
    const value = objects.get(name);
    if (!value) throw Object.assign(new Error("missing"), { code: 404 });
    return value;
  };
  const bucket = {
    file: (name: string) => ({
      name,
      exists: async () => [objects.has(name)],
      getMetadata: async () => [(await entry(name)).metadata],
      download: async () => [(await entry(name)).bytes],
      save: async (bytes: Buffer, opts: any) => {
        if (objects.has(name) && opts.preconditionOpts?.ifGenerationMatch === 0)
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
      getSignedUrl: async () => {
        const key = createHash("sha256").update(name).digest("hex");
        signed.set(key, name);
        return [`/__e2e/staff-files/${key}`];
      },
    }),
  };
  app.get("/__e2e/staff-files/:key", async (req, res) => {
    const name = signed.get(req.params.key);
    if (!name) {
      res.sendStatus(404);
      return;
    }
    try {
      res.type("application/pdf").send((await entry(name)).bytes);
    } catch {
      res.sendStatus(404);
    }
  });
  app.post("/__e2e/staff-upload/:id", expressRaw(), (req, res) => {
    if (!/^[a-f0-9]{32}$/.test(req.params.id)) {
      res.sendStatus(422);
      return;
    }
    const name = `staff-documents/e2e-user/${req.params.id}/upload.pdf`;
    objects.set(name, {
      bytes: req.body,
      metadata: {
        size: req.body.length,
        generation: String(++generation),
        contentType: "application/pdf",
        metadata: { ownerId: "e2e-user", documentId: req.params.id },
      },
    });
    res.json({ saved: true });
  });
  const routers = createStaffDocumentRouters({
    services: () => ({ db, bucket }) as any,
    origin: () => "https://example.test",
    authorize: async (req) => {
      if (req.get("authorization") !== "Bearer e2e-documents")
        throw new OperationsError("Acesso negado", 403);
      return {
        uid: "e2e-user",
        admin: req.get("x-e2e-role") === "administrator",
        permissions: ["documents.generate"],
      };
    },
    fetcher: async () =>
      new Response(JSON.stringify({ id: "fake-email" }), { status: 200 }),
  });
  app.use("/__e2e/documents", routers.admin);
}
import expressModule from "express";
function expressRaw() {
  return expressModule.raw({ type: "application/pdf", limit: "50mb" });
}
