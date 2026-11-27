import { createHash, randomBytes } from "node:crypto";
import express from "express";
import { OperationsError } from "../lib/operations.js";
import { normalizePdfCategory } from "../lib/staffPdfCategory.js";
import type { Firestore } from "firebase-admin/firestore";
import { staffLabelArchiveRouter, type LabelBucket } from "./staffLabelArchive.js";
import { staffLabelBaseBindingsRouter, type LabelBaseResolver } from "./staffLabelBaseBindings.js";
import type { WorkActor } from "./workRouter.js";

const keyPattern = /^[a-f0-9]{64}$/;
function isKey(key: unknown): key is string {
  return typeof key === "string" && keyPattern.test(key);
}
export function staffLabelCategoryRouter(database: () => Firestore, bucket: () => LabelBucket, resolveBase: LabelBaseResolver) {
  const router = express.Router();
  router.use((_req, res, next) => {
    const actor: WorkActor = res.locals.user;
    if (actor.admin || actor.permissions?.includes("documents.generate")) return next();
    next(new OperationsError("Sua função não permite categorizar etiquetas.", 403));
  });
  const categories = () => database().collection("_staffLabelCategories");
  router.use("/base-bindings", staffLabelBaseBindingsRouter(database, resolveBase));
  router.use("/archive", staffLabelArchiveRouter(database, bucket));
  const assignments = () => database().collection("_staffLabelProductCategories");
  function post(path: string, handle: (req: express.Request, res: express.Response) => Promise<void>) {
    router.post(path, (req, res, next) => {
      void handle(req, res).catch(next);
    });
  }
  post("/lookup", async (req, res) => {
    const { keys, includeCategories = true } = req.body ?? {};
    if (
      !Array.isArray(keys) ||
      keys.length > 300 ||
      !keys.every(isKey) ||
      typeof includeCategories !== "boolean"
    )
      throw new OperationsError("Consulta de etiquetas inválida.");
    const distinct = [...new Set<string>(keys)];
    const chunks = [];
    for (let i = 0; i < distinct.length; i += 30)
      chunks.push(
        assignments()
          .where("key", "in", distinct.slice(i, i + 30))
          .get(),
      );
    const [list, matches] = await Promise.all([categories().get(), Promise.all(chunks)]);
    const activeIds = new Set(list.docs.map((doc) => doc.id));
    res.json({
      categories: includeCategories
        ? list.docs.map((doc) => ({ id: doc.id, name: doc.get("name") }))
        : [],
      assignments: Object.fromEntries(
        matches.flatMap((snapshot) =>
          snapshot.docs
            .filter((doc) => activeIds.has(doc.get("categoryId")))
            .map((doc) => [doc.id, doc.get("categoryId")]),
        ),
      ),
    });
  });
  const names = () => database().collection("_staffLabelCategoryNames");
  function categoryName(value: unknown) {
    try {
      return normalizePdfCategory(value);
    } catch {
      throw new OperationsError("Informe um nome de categoria de até 100 caracteres.");
    }
  }
  function nameKey(name: string) {
    const normalized = name.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
    if (!normalized.trim()) throw new OperationsError("Informe o nome da categoria.");
    return createHash("sha256").update(normalized).digest("hex");
  }
  // Original categories used the hash of their first name as their document ID.
  async function findName(tx: FirebaseFirestore.Transaction, name: string) {
    const key = nameKey(name);
    const index = await tx.get(names().doc(key));
    const id = index.get("id") || key;
    const doc = await tx.get(categories().doc(id));
    return doc.exists && nameKey(doc.get("name")) === key ? { id, name: doc.get("name") } : undefined;
  }
  post("/create", async (req, res) => {
    const name = categoryName(req.body?.name);
    const category = await database().runTransaction(async (tx) => {
      const match = await findName(tx, name);
      if (match) return match;
      const id = randomBytes(32).toString("hex");
      tx.create(categories().doc(id), { name });
      tx.set(names().doc(nameKey(name)), { id });
      return { id, name };
    });
    res.json(category);
  });
  for (const action of ["rename", "remove"] as const) {
    post("/" + action, async (req, res) => {
      const { id, expectedName } = req.body ?? {};
      if (!isKey(id)) throw new OperationsError("Categoria inválida.");
      const ref = categories().doc(id);
      await database().runTransaction(async (tx) => {
        const category = await tx.get(ref);
        if (!category.exists || category.get("name") !== expectedName)
          throw new OperationsError("A categoria mudou. Atualize a lista e tente novamente.", 409);
        const oldKey = nameKey(expectedName);
        if (action === "remove") {
          tx.delete(names().doc(oldKey));
          tx.delete(ref);
          return;
        }
        const name = categoryName(req.body.name);
        const other = await findName(tx, name);
        if (other && other.id !== id)
          throw new OperationsError("Já existe uma categoria com esse nome.", 409);
        if (oldKey !== nameKey(name)) tx.delete(names().doc(oldKey));
        tx.set(names().doc(nameKey(name)), { id });
        tx.update(ref, { name });
      });
      res.json({ ok: true });
    });
  }
  post("/assign", async (req, res) => {
    const { key, categoryId } = req.body ?? {};
    if (!isKey(key) || !isKey(categoryId)) throw new OperationsError("Produto ou categoria inválidos.");
    const ref = assignments().doc(key);
    await database().runTransaction(async (tx) => {
      const [category, current] = await Promise.all([tx.get(categories().doc(categoryId)), tx.get(ref)]);
      if (!category.exists) throw new OperationsError("A categoria não existe. Atualize a lista.", 404);
      if (current.exists) {
        if (current.get("categoryId") === categoryId) return;
        if ((await tx.get(categories().doc(current.get("categoryId")))).exists)
          throw new OperationsError(
            "Outra pessoa já definiu a categoria deste produto. Confira a categoria salva pela equipe.",
            409,
          );
      }
      tx.set(ref, { key, categoryId });
    });
    res.json({ categoryId });
  });
  return router;
}
