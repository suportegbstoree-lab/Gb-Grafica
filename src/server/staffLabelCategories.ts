import { createHash } from "node:crypto";
import express from "express";
import { OperationsError } from "../lib/operations.js";
import { normalizePdfCategory } from "../lib/staffPdfCategory.js";
import type { Firestore } from "firebase-admin/firestore";
import type { WorkActor } from "./workRouter.js";

const keyPattern = /^[a-f0-9]{64}$/;
function isKey(key: unknown): key is string {
  return typeof key === "string" && keyPattern.test(key);
}
export function staffLabelCategoryRouter(database: () => Firestore) {
  const router = express.Router();
  router.use((_req, res, next) => {
    const actor: WorkActor = res.locals.user;
    if (actor.admin || actor.permissions?.includes("documents.generate")) return next();
    next(new OperationsError("Sua função não permite categorizar etiquetas.", 403));
  });
  const categories = () => database().collection("_staffLabelCategories");
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
    const [list, matches] = await Promise.all([
      includeCategories ? categories().get() : undefined,
      Promise.all(chunks),
    ]);
    res.json({
      categories: list?.docs.map((doc) => ({ id: doc.id, name: doc.get("name") })) ?? [],
      assignments: Object.fromEntries(
        matches.flatMap((snapshot) => snapshot.docs.map((doc) => [doc.id, doc.get("categoryId")])),
      ),
    });
  });
  post("/create", async (req, res) => {
    let name: string;
    try {
      name = normalizePdfCategory(req.body?.name);
    } catch {
      throw new OperationsError("Informe um nome de categoria de até 100 caracteres.");
    }
    const normalized = name.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
    if (!normalized.trim()) throw new OperationsError("Informe o nome da categoria.");
    const id = createHash("sha256").update(normalized).digest("hex");
    const ref = categories().doc(id);
    const category = await database().runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (current.exists) return { id, name: current.get("name") as string };
      tx.create(ref, { name });
      return { id, name };
    });
    res.json(category);
  });
  post("/assign", async (req, res) => {
    const { key, categoryId } = req.body ?? {};
    if (!isKey(key) || !isKey(categoryId)) throw new OperationsError("Produto ou categoria inválidos.");
    const ref = assignments().doc(key);
    await database().runTransaction(async (tx) => {
      const [category, current] = await Promise.all([tx.get(categories().doc(categoryId)), tx.get(ref)]);
      if (!category.exists) throw new OperationsError("A categoria não existe. Atualize a lista.", 404);
      if (current.exists) {
        if (current.get("categoryId") !== categoryId)
          throw new OperationsError(
            "Outra pessoa já definiu a categoria deste produto. Confira a categoria salva pela equipe.",
            409,
          );
        return;
      }
      tx.create(ref, { key, categoryId });
    });
    res.json({ categoryId });
  });
  return router;
}
