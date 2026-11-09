import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
import { OperationsError } from "../lib/operations.js";
import {
  COUPON_CODE_IN_USE,
  normalizeCouponCode,
  normalizeCouponDraft,
  validCouponCode,
} from "../lib/salesCoupons.js";
import { variationTypeName } from "../lib/productSales.js";
import type { StaffPermission } from "../lib/staffAccess.js";
import type { getAdminServices } from "./firebaseAdmin.js";
import { prepareCatalogRetention } from "./catalogRetention.js";
import { COUPONS } from "./salesCoupons.js";

export const VARIATION_TYPES = "_variationTypes";

const resources = {
  "variation-types": {
    collection: VARIATION_TYPES,
    permission: "products.manage",
  },
  coupons: { collection: COUPONS, permission: "promotions.manage" },
} as const;

export function createSalesAdminRouter(deps: {
  services: typeof getAdminServices;
  authorize: (
    req: express.Request,
    permission: StaffPermission,
  ) => Promise<unknown>;
}) {
  const router = express.Router();
  router.use((_, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });
  router.get("/:resource", (req, res, next) => {
    void (async () => {
      const key = req.params.resource as keyof typeof resources;
      if (!Object.hasOwn(resources, key))
        throw new OperationsError("Cadastro inexistente.", 404);
      const resource = resources[key];
      await deps.authorize(req, resource.permission);
      const rows = await deps
        .services()
        .db.collection(resource.collection)
        .limit(501)
        .get();
      res.json({
        rows: rows.docs.slice(0, 500).map((doc) => doc.data()),
        truncated: rows.size > 500,
      });
    })().catch(next);
  });
  router.post("/:resource", (req, res, next) => {
    void (async () => {
      const key = req.params.resource as keyof typeof resources;
      if (!Object.hasOwn(resources, key))
        throw new OperationsError("Cadastro inexistente.", 404);
      const resource = resources[key];
      await deps.authorize(req, resource.permission);
      const { db, bucket } = deps.services();
      const { id, revision, remove, draft } = req.body || {};
      const coupons = key === "coupons";
      if (remove !== undefined && typeof remove !== "boolean") {
        throw new OperationsError("Ação inválida.");
      }
      if (
        (remove && !id) ||
        (id !== undefined &&
          (typeof id !== "string" ||
            !(coupons ? validCouponCode(id) : /^[a-f0-9]{32}$/.test(id))))
      ) {
        throw new OperationsError("Identificador inválido.");
      }
      let code = "";
      if (coupons && !id && draft?.code !== undefined) {
        if (typeof draft.code !== "string")
          throw new OperationsError("Código de cupom inválido.");
        code = normalizeCouponCode(draft.code);
        if (code && !validCouponCode(code))
          throw new OperationsError(
            "Use de 3 a 40 caracteres no código do cupom, com letras, números, hífen ou sublinhado.",
          );
      }
      const ref = db
        .collection(resource.collection)
        .doc(
          id ??
            (coupons
              ? code || "GB-" + randomBytes(6).toString("hex").toUpperCase()
              : randomUUID().replaceAll("-", "")),
        );
      let input: Record<string, unknown> = {};
      if (!remove) {
        try {
          input = coupons
            ? normalizeCouponDraft(draft)
            : { name: variationTypeName(draft?.name) };
        } catch (error) {
          throw new OperationsError((error as Error).message);
        }
      }
      const transaction = db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data();
        if (id && (!current || current.revision !== revision)) {
          throw new OperationsError(
            "O cadastro mudou. Atualize a lista e tente novamente.",
            409,
          );
        }
        if (coupons && !id && current)
          throw new OperationsError(COUPON_CODE_IN_USE, 409);
        if (remove) {
          const retain = await prepareCatalogRetention(
            db,
            tx,
            ref.path,
            current,
            null,
            bucket?.name || "",
          );
          tx.delete(ref);
          retain();
          return null;
        }
        if (coupons && Number(input.limit) < Number(current?.used || 0)) {
          throw new OperationsError(
            "O limite não pode ser menor que os usos e reservas existentes.",
          );
        }
        if (!coupons) {
          const all = await tx.get(db.collection(VARIATION_TYPES).limit(501));
          if (
            all.docs.some(
              (doc) =>
                doc.id !== ref.id &&
                String(doc.data().name).toLocaleLowerCase("pt-BR") ===
                  String(input.name).toLocaleLowerCase("pt-BR"),
            )
          ) {
            throw new OperationsError(
              "Já existe um tipo de variação com esse nome.",
            );
          }
          if (!id && all.size >= 500)
            throw new OperationsError(
              "O cadastro aceita até 500 tipos de variação.",
            );
        }
        const row = {
          ...input,
          ...(coupons
            ? {
                code: ref.id,
                used: current?.used ?? 0,
                ...(!id
                  ? { instanceId: randomUUID() }
                  : current?.instanceId
                    ? { instanceId: current.instanceId }
                    : {}),
              }
            : { id: ref.id }),
          revision: randomUUID().replaceAll("-", ""),
        };
        if (id) tx.set(ref, row);
        else tx.create(ref, row);
        return row;
      });
      const result = await transaction.catch((error: unknown) => {
        // Firestore may report an existing document at commit if two creates race.
        if (
          coupons &&
          !id &&
          error instanceof Error &&
          "code" in error &&
          error.code === 6
        )
          throw new OperationsError(COUPON_CODE_IN_USE, 409);
        throw error;
      });
      res.json({ row: result });
    })().catch(next);
  });
  router.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (!(error instanceof OperationsError)) return next(error);
      res.status(error.status).json({ error: error.message });
    },
  );
  return router;
}
