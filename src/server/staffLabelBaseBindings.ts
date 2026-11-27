import express from "express";
import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { OperationsError } from "../lib/operations.js";
import { labelBaseIdentity, type LabelBaseBinding } from "../lib/staffLabelImport.js";

export type LabelBaseResolver = (id: string) => Promise<{ name: string; displayName?: string }>;
const invalid = () => new OperationsError("Dados do vínculo da base inválidos.");
function identity(product: any) {
  if (
    !product ||
    !["sku", "description", "variation"].every(
      (field) => typeof product[field] === "string" && product[field].length <= 2000,
    ) ||
    !(product.sku.trim() || product.description.trim())
  )
    throw invalid();
  return labelBaseIdentity(product);
}

export function staffLabelBaseBindingsRouter(database: () => Firestore, resolveBase: LabelBaseResolver) {
  const router = express.Router();
  const collection = () => database().collection("_staffLabelBaseBindings");
  async function view(baseId: string | null, version: number): Promise<LabelBaseBinding> {
    if (!baseId) return { baseId: null, version, available: false };
    try {
      const base = await resolveBase(baseId);
      return { baseId, version, available: true, name: base.displayName ?? base.name };
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
      return { baseId, version, available: false };
    }
  }
  router.post("/lookup", (req, res, next) => {
    void (async () => {
      if (!Array.isArray(req.body?.products) || req.body.products.length > 100) throw invalid();
      const identities = [...new Set<string>(req.body.products.map(identity))];
      const keys = identities.map((id) => createHash("sha256").update(id).digest("hex"));
      const matches: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      for (let start = 0; start < keys.length; start += 30) {
        const snapshot = await collection()
          .where("key", "in", keys.slice(start, start + 30))
          .get();
        matches.push(...snapshot.docs);
      }
      const cached = new Map<string, Promise<LabelBaseBinding>>();
      const bindings = await Promise.all(
        matches.map(async (doc) => {
          const baseId = doc.get("baseId") as string | null;
          const version = doc.get("version") as number;
          const key = JSON.stringify([baseId, version]);
          if (!cached.has(key)) cached.set(key, view(baseId, version));
          return [doc.get("identity"), await cached.get(key)] as const;
        }),
      );
      res.json(Object.fromEntries(bindings));
    })().catch(next);
  });
  router.post("/save", (req, res, next) => {
    void (async () => {
      const id = identity(req.body?.product);
      const { baseId, expectedVersion } = req.body;
      if (
        (baseId !== null && (typeof baseId !== "string" || !baseId || baseId.length > 160)) ||
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 0
      )
        throw invalid();
      if (baseId !== null) await resolveBase(baseId);
      const key = createHash("sha256").update(id).digest("hex");
      const ref = collection().doc(key);
      const version = await database().runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data();
        if ((current?.baseId ?? null) === baseId) return current?.version ?? 0;
        if ((current?.version ?? 0) !== expectedVersion)
          throw new OperationsError(
            "Outra pessoa alterou o vínculo deste produto. Confira a base atual antes de salvar.",
            409,
          );
        const version = expectedVersion + 1;
        tx.set(ref, { key, identity: id, baseId, version, updatedAt: Date.now() });
        return version;
      });
      res.json(await view(baseId, version));
    })().catch(next);
  });
  return router;
}
