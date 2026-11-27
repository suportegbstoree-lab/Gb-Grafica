import express from "express";
import { createHash, randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { StaffDocumentDeps } from "./staffDocuments.js";
import { sanitizeStaffPdfBase } from "./staffPdfSanitize.js";
import { prepareLabelExport } from "./staffLabelExport.js";
import { OperationsError } from "../lib/operations.js";
import {
  labelProductIdentity,
  LABEL_PARSER_VERSION,
  incompleteLabelReading,
  type ImportedLabel,
  type LabelArchiveHeader,
} from "../lib/staffLabelImport.js";

type Bucket = ReturnType<StaffDocumentDeps["services"]>["bucket"];
export interface LabelBucket {
  file(path: string): Pick<ReturnType<Bucket["file"]>, "save" | "delete" | "getSignedUrl" | "download">;
}
const digest = /^[a-f0-9]{64}$/;
const validNumber = (n: unknown, max: number): n is number =>
  Number.isSafeInteger(n) && Number(n) >= 1 && Number(n) <= max;
const conflict = () =>
  new OperationsError("Esta importação mudou. Atualize a lista para continuar.", 409);
const invalid = () => new OperationsError("Dados da etiqueta inválidos.");
const MAX_PART = 512 * 1024;
function decode(data: unknown, limit: number) {
  if (
    typeof data !== "string" ||
    data.length > 4 * Math.ceil(limit / 3) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    throw invalid();
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > limit || bytes.toString("base64") !== data) throw invalid();
  return bytes;
}
function pageLabel(input: any): ImportedLabel {
  if (!input || !Array.isArray(input.products) || input.products.length > 300) throw invalid();
  const products = input.products.map((product: any) => {
    if (
      !product ||
      !["description", "variation", "sku"].every(
        (key) => typeof product[key] === "string" && product[key].length <= 2000,
      ) ||
      !(product.sku.trim() || product.description.trim())
    )
      throw invalid();
    const { sku, description, variation } = product;
    return {
      sku,
      description,
      variation,
      key: createHash("sha256").update(labelProductIdentity(product)).digest("hex"),
    };
  });
  if (!products.length && !(typeof input.issue === "string" && input.issue.trim())) throw invalid();
  const result: ImportedLabel = { products };
  if (input.issue) result.issue = String(input.issue).slice(0, 500);
  if (typeof input.warning === "string" && input.warning.trim()) result.warning = input.warning.slice(0, 500);
  if (input.parserVersion === LABEL_PARSER_VERSION) result.parserVersion = LABEL_PARSER_VERSION;
  return result;
}

export function staffLabelArchiveRouter(database: () => Firestore, bucket: () => LabelBucket) {
  const router = express.Router();
  router.use("/upload", express.json({ limit: "3mb" }));
  const imports = () => database().collection("_staffLabelImports");
  function post(path: string, fn: (body: any) => Promise<unknown>) {
    router.post(path, (req, res, next) => {
      void fn(req.body ?? {})
        .then((result) => res.json(result ?? { ok: true }))
        .catch(next);
    });
  }
  function archive(body: any) {
    if (
      typeof body.id !== "string" ||
      !digest.test(body.id) ||
      typeof body.revision !== "string" ||
      !/^[a-f0-9]{32}$/.test(body.revision)
    )
      throw invalid();
    const ref = imports().doc(body.id);
    const pages = ref.collection("versions").doc(body.revision).collection("pages");
    function check(data: FirebaseFirestore.DocumentData | undefined): LabelArchiveHeader {
      if (!data || data.revision !== body.revision) throw conflict();
      return data as LabelArchiveHeader;
    }
    const file = (number: number) =>
      bucket().file(`staff-label-imports/${body.id}/${body.revision}/${number}.pdf`);
    const exports = ref.collection("versions").doc(body.revision).collection("exports");
    return { ref, pages, check, file, exports };
  }
  post("/list", async (body) => {
    let query = imports().orderBy("id").limit(100);
    if (body.after) {
      if (!digest.test(body.after)) throw invalid();
      query = query.startAfter(body.after);
    }
    const snapshot = await query.get();
    const entries = snapshot.docs.map((doc) => doc.data());
    const categories = entries.some((h) => h.confirmed)
      ? await database().collection("_staffLabelCategories").select().get()
      : undefined;
    const active = new Set(categories?.docs.map((doc) => doc.id));
    return entries.map(({ confirmedCategories, ...h }) => ({
      ...h,
      confirmed: h.confirmed && (confirmedCategories ?? []).every((id: string) => active.has(id)),
    }));
  });
  post("/begin", async ({ id, name, total }) => {
    if (
      typeof id !== "string" ||
      !digest.test(id) ||
      typeof name !== "string" ||
      !name.trim() ||
      !validNumber(total, 100000)
    )
      throw invalid();
    const ref = imports().doc(id);
    return database().runTransaction(async (tx) => {
      const old = (await tx.get(ref)).data();
      if (old) {
        if (old.state === "deleting" || old.total !== total) throw conflict();
        return old;
      }
      const header: LabelArchiveHeader = {
        id,
        revision: randomUUID().replaceAll("-", ""),
        name: name.slice(0, 255),
        total,
        count: 0,
        state: "uploading",
        importedAt: Date.now(),
        confirmed: false,
      };
      tx.create(ref, header);
      return header;
    });
  });
  post("/read", async (body) => {
    const a = archive(body);
    a.check((await a.ref.get()).data());
    if (!Number.isSafeInteger(body.after) || body.after < 0) throw invalid();
    const snapshot = await a.pages.where("number", ">", body.after).orderBy("number").limit(100).get();
    return {
      pages: snapshot.docs
        .filter((doc) => doc.get("state") !== "pending")
        .map((doc) => ({
          ...doc.get("label"),
          number: doc.get("number"),
          excluded: doc.get("excluded") === true,
        })),
      after: snapshot.size === 100 ? snapshot.docs.at(-1)!.get("number") : null,
    };
  });
  // Large individual pages use temporary parts below the Firestore document limit.
  // A reservation exists before either the parts or the final Storage object can be written.
  post("/upload/part", async (body) => {
    const a = archive(body);
    const bytes = decode(body.data, MAX_PART);
    if (!validNumber(body.number, 100000) || !validNumber(body.part, 100)) throw invalid();
    const page = a.pages.doc(String(body.number));
    await database().runTransaction(async (tx) => {
      const header = a.check((await tx.get(a.ref)).data());
      const doc = await tx.get(page);
      if (header.state !== "uploading" || body.number > header.total) throw conflict();
      if (doc.get("state") === "ready") return;
      if (!doc.exists) tx.create(page, { number: body.number, state: "pending" });
      tx.set(page.collection("parts").doc(String(body.part)), { part: body.part, bytes });
    });
  });
  post("/upload/pages", async (body) => {
    const a = archive(body);
    if (!Array.isArray(body.pages) || !body.pages.length || body.pages.length > 24) throw invalid();
    for (const item of body.pages) {
      if (!validNumber(item?.number, 100000)) throw invalid();
      const number = item.number;
      const label = pageLabel(item.label);
      const page = a.pages.doc(String(number));
      const needed = await database().runTransaction(async (tx) => {
        const header = a.check((await tx.get(a.ref)).data());
        const old = await tx.get(page);
        if (header.state === "deleting" || number > header.total) throw conflict();
        if (old.get("state") === "ready") return false;
        if (header.state !== "uploading") throw conflict();
        if (!old.exists) tx.create(page, { number, state: "pending" });
        return true;
      });
      if (!needed) continue;
      let bytes: Buffer;
      if (item.parts !== undefined) {
        if (!validNumber(item.parts, 100)) throw invalid();
        const parts = await page.collection("parts").orderBy("part").get();
        if (parts.size !== item.parts || parts.docs.some((doc, i) => doc.get("part") !== i + 1))
          throw new OperationsError(
            "O envio da página ficou incompleto. Selecione o PDF novamente.",
            409,
          );
        bytes = Buffer.concat(parts.docs.map((doc) => Buffer.from(doc.get("bytes"))));
      } else bytes = decode(item.data, 2 * 1024 * 1024);
      const pdf = await sanitizeStaffPdfBase(bytes);
      if (pdf.pages.length !== 1)
        throw new OperationsError("Cada etiqueta deve ter exatamente uma página.");
      const file = a.file(number);
      try {
        await file.save(pdf.output, {
          resumable: false,
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { contentType: "application/pdf", cacheControl: "private,no-store" },
        });
      } catch (e) {
        if (Number((e as any).code) !== 412) throw e;
      }
      const retained = await database().runTransaction(async (tx) => {
        const header = (await tx.get(a.ref)).data();
        const old = await tx.get(page);
        if (
          !header ||
          header.revision !== body.revision ||
          header.state === "deleting" ||
          !old.exists ||
          old.get("state") === "deleting"
        )
          return false;
        if (old.get("state") === "ready") return true;
        const count = header.count + 1;
        if (item.parts) {
          for (let part = 1; part <= item.parts; part++)
            tx.delete(page.collection("parts").doc(String(part)));
        }
        tx.set(page, { state: "ready", number, label });
        tx.update(a.ref, { count, state: count === header.total ? "ready" : "uploading" });
        return true;
      });
      if (!retained) {
        await removeObject(file);
        throw conflict();
      }
    }
  });
  post("/identify", async (body) => {
    const a = archive(body);
    if (!validNumber(body.number, 100000)) throw invalid();
    const label = pageLabel({ products: body.products, parserVersion: LABEL_PARSER_VERSION });
    const page = a.pages.doc(String(body.number));
    await database().runTransaction(async (tx) => {
      const header = a.check((await tx.get(a.ref)).data());
      const old = await tx.get(page);
      if (
        header.state !== "ready" ||
        old.get("state") !== "ready" ||
        old.get("excluded") ||
        !old.get("label") ||
        !incompleteLabelReading(old.get("label"))
      )
        throw conflict();
      tx.update(page, { label });
      tx.update(a.ref, { confirmed: false });
    });
  });
  post("/reparse", async body => {
    const a = archive(body);
    if (!Array.isArray(body.pages) || !body.pages.length || body.pages.length > 12) throw invalid();
    const updates = body.pages.map((page: any) => {
      if (
        !page || !validNumber(page.number, 100000) ||
        !Number.isSafeInteger(page.expectedVersion) || page.expectedVersion < 0
      ) throw invalid();
      return {
        number: page.number,
        expectedVersion: page.expectedVersion,
        label: pageLabel({ ...page.label, parserVersion: LABEL_PARSER_VERSION }),
      };
    });
    await database().runTransaction(async tx => {
      const header = a.check((await tx.get(a.ref)).data());
      if (header.state !== "ready") throw conflict();
      const documents = await Promise.all(updates.map(update => tx.get(a.pages.doc(String(update.number)))));
      let changed = false;
      documents.forEach((doc, i) => {
        const current = doc.get("label") as ImportedLabel | undefined, update = updates[i];
        // A concurrent manual correction or cancellation wins over this background repair.
        if (
          doc.get("state") !== "ready" || doc.get("excluded") || !current ||
          !incompleteLabelReading(current) || (current.parserVersion ?? 0) !== update.expectedVersion
        ) return;
        tx.update(a.pages.doc(String(update.number)), { label: update.label });
        changed = true;
      });
      if (changed) tx.update(a.ref, { confirmed: false });
    });
  });
  post("/confirm", async (body) => {
    const a = archive(body);
    await database().runTransaction(async (tx) => {
      const header = a.check((await tx.get(a.ref)).data());
      if (header.state !== "ready") throw conflict();
      const [pages, categories] = await Promise.all([
        tx.get(a.pages),
        tx.get(database().collection("_staffLabelCategories")),
      ]);
      const ids = new Set(categories.docs.map((doc) => doc.id)),
        keys = new Set<string>();
      for (const doc of pages.docs) {
        if (doc.get("excluded")) continue;
        const label = doc.get("label") as ImportedLabel;
        if (doc.get("state") !== "ready" || !label) throw conflict();
        if (incompleteLabelReading(label))
          throw new OperationsError(
            "Há etiquetas com leitura incompleta. Reprocesse a leitura ou confirme os produtos dessas páginas.", 409,
          );
        label.products.forEach((p) => keys.add(p.key));
      }
      const products = [...keys];
      const used = new Set<string>();
      for (let i = 0; i < products.length; i += 30) {
        const saved = await tx.get(
          database()
            .collection("_staffLabelProductCategories")
            .where("key", "in", products.slice(i, i + 30)),
        );
        saved.docs.forEach((doc) => used.add(doc.get("categoryId")));
        if (
          saved.size !== Math.min(30, products.length - i) ||
          saved.docs.some((doc) => !ids.has(doc.get("categoryId")))
        )
          throw new OperationsError("Ainda há etiquetas sem categoria neste PDF.", 409);
      }
      tx.update(a.ref, { confirmed: true, confirmedCategories: [...used] });
    });
  });
  post("/exclude", async (body) => {
    const a = archive(body);
    if (
      !Array.isArray(body.numbers) ||
      !body.numbers.length ||
      body.numbers.length > 200 ||
      !body.numbers.every((n: unknown) => validNumber(n, 100000))
    )
      throw invalid();
    const numbers = [...new Set<number>(body.numbers)];
    await database().runTransaction(async (tx) => {
      const header = a.check((await tx.get(a.ref)).data());
      if (header.state !== "ready") throw conflict();
      const pages = await Promise.all(numbers.map((n) => tx.get(a.pages.doc(String(n)))));
      if (pages.some((doc) => doc.get("state") !== "ready")) throw conflict();
      const fresh = pages.filter((doc) => !doc.get("excluded"));
      if (!fresh.length) return;
      fresh.forEach((doc) =>
        tx.update(a.pages.doc(String(doc.get("number"))), { excluded: true, excludedAt: Date.now() }),
      );
      tx.update(a.ref, {
        excludedCount: (header.excludedCount ?? 0) + fresh.length,
        selectionVersion: (header.selectionVersion ?? 0) + 1,
        confirmed: false,
      });
    });
  });
  post("/export", async (body) => {
    const a = archive(body);
    a.check((await a.ref.get()).data());
    return prepareLabelExport(database(), bucket(), body);
  });
  post("/links", async (body) => {
    const a = archive(body),
      header = a.check((await a.ref.get()).data());
    if (
      header.state === "deleting" ||
      !Array.isArray(body.numbers) ||
      !body.numbers.length ||
      body.numbers.length > 24
    )
      throw invalid();
    return Promise.all(
      body.numbers.map(async (n: number) => {
        if (
          !validNumber(n, header.total) ||
          (await a.pages.doc(String(n)).get()).data()?.state !== "ready"
        )
          throw conflict();
        const [url] = await a
          .file(n)
          .getSignedUrl({ action: "read", version: "v4", expires: Date.now() + 5 * 60_000 });
        return url;
      }),
    );
  });
  async function removeObject(file: ReturnType<LabelBucket["file"]>) {
    try {
      await file.delete({ ignoreNotFound: true });
    } catch (e) {
      if (Number((e as any).code) !== 404) throw e;
    }
  }
  post("/remove", async (body) => {
    const a = archive(body);
    const single = body.number !== undefined;
    if (single && !validNumber(body.number, 100000)) throw invalid();
    const page = single ? a.pages.doc(String(body.number)) : undefined;
    const mode = await database().runTransaction(async (tx) => {
      const parent = (await tx.get(a.ref)).data();
      if (!parent) return "done";
      const header = a.check(parent);
      if (!page || (header.state === "deleting" && header.count <= 1)) {
        tx.update(a.ref, { state: "deleting" });
        return "all";
      }
      if (header.state !== "ready") throw conflict();
      const old = await tx.get(page);
      if (!old.exists) return "done";
      tx.update(page, { state: "deleting" });
      return "single";
    });
    if (mode === "done") return { done: true };
    if (mode === "single") {
      await removeObject(a.file(body.number));
      await database().recursiveDelete(page!.collection("parts"));
      const last = await database().runTransaction(async (tx) => {
        const parent = (await tx.get(a.ref)).data();
        if (!parent || parent.revision !== body.revision || parent.state === "deleting") return false;
        const old = await tx.get(page!);
        if (!old.exists) return false;
        tx.delete(page!);
        if (parent.count === 1)
          tx.update(a.ref, {
            count: 0,
            state: "deleting",
            selectionVersion: (parent.selectionVersion ?? 0) + 1,
          });
        else
          tx.update(a.ref, {
            count: parent.count - 1,
            excludedCount: Math.max(0, (parent.excludedCount ?? 0) - (old.get("excluded") ? 1 : 0)),
            selectionVersion: (parent.selectionVersion ?? 0) + 1,
            confirmed: false,
          });
        return parent.count === 1;
      });
      return { done: !last, empty: last };
    }
    // Bound each invocation so removing a whole weekly file can be retried.
    const batch = await a.pages.limit(16).get();
    await Promise.all(
      batch.docs.map(async (doc) => {
        await removeObject(a.file(doc.get("number")));
        await database().recursiveDelete(doc.ref);
      }),
    );
    if (batch.size === 16) return { done: false };
    const exports = await a.exports.limit(1).get();
    if (exports.size) {
      const manifest = exports.docs[0];
      const files = await manifest.ref.collection("files").limit(16).get();
      for (const doc of files.docs) {
        await removeObject(bucket().file(doc.get("path")));
        await doc.ref.delete();
      }
      if (files.size < 16) await database().recursiveDelete(manifest.ref);
      return { done: false };
    }
    await database().runTransaction(async (tx) => {
      const parent = (await tx.get(a.ref)).data();
      if (parent?.revision === body.revision && parent.state === "deleting") tx.delete(a.ref);
    });
    return { done: true };
  });
  return router;
}
