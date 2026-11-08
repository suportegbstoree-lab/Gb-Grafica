import express from "express";
import { createHash } from "node:crypto";
import {
  normalizePersonalizationFonts,
  normalizeTextCustomization,
} from "../lib/textCustomization.js";
import {
  fixedStaffPdfMain,
  normalizeStaffPdfJob,
  STAFF_PDF_SYSTEM_FONT,
  staffPdfFont,
  type StaffPdfJob,
} from "../lib/staffPdf.js";
import { parsePrintProfile } from "../lib/printProfile.js";
import {
  isStaffPdfSimpleJob,
  type StaffPdfBatchJob,
} from "../lib/staffPdfBatch.js";
import { staffPdfOutputName } from "../lib/staffPdf.js";
import { normalizeStaffBarcode } from "../lib/staffPdfBarcode.js";
import { STAFF_BATCH_TTL_MS } from "../lib/staffPdfBarcode.js";
import {
  firstInitial,
  matchingAlphabetName,
} from "../lib/decorativeInitial.js";
import { adminAssetPathFromUrl, isAdminFontPath } from "../lib/adminAsset.js";
import {
  validDocumentId,
  STAFF_DOCUMENT_MAX_BYTES,
} from "../lib/staffDocument.js";
import { OperationsError } from "../lib/operations.js";
import { resolveStaffPdfBase } from "./staffPdfLibrary.js";
import { prepareWorkActivity } from "./workTracking.js";
import { activityActor } from "./staffActivity.js";
import type { StaffDocumentDeps } from "./staffDocuments.js";
import type { WorkActor } from "./workRouter.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const idFor = (uid: string, requestId: unknown) => {
  if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/.test(requestId))
    throw new OperationsError("Identificador do lote inválido.");
  return hash(`${uid}:${requestId}`).slice(0, 32);
};
const assetPath = (batchId: string, key: string) =>
  `staff-pdf-batches/${batchId}/assets/${key}`;

export function createStaffPdfBatchRouter(deps: StaffDocumentDeps) {
  const router = express.Router();
  const now = () => deps.now?.() ?? Date.now();
  const services = deps.services;
  router.use((_req, res, next) => {
    const actor = res.locals.user as WorkActor | undefined;
    if (
      !actor ||
      (!actor.admin && !actor.permissions?.includes("documents.generate"))
    ) {
      next(new OperationsError("Sua função não permite gerar lotes.", 403));
      return;
    }
    next();
  });
  const action =
    (
      fn: (req: express.Request, res: express.Response) => Promise<void>,
    ): express.RequestHandler =>
    (req, res, next) => {
      void fn(req, res).catch(next);
    };
  const actor = (res: express.Response) => res.locals.user as WorkActor;
  const view = (id: string, data: any) => ({
    id,
    reference: data.reference,
    createdAt: data.createdAt,
    expiresAt: data.expiresAt,
    ownerName: data.ownerName,
    count: data.itemIds?.length || 0,
  });
  const itemView = (id: string, data: any) => ({
    id,
    outputName: data.job.outputName,
    barcode: data.job.barcode,
    status: data.status,
  });
  async function access(id: string, user: WorkActor) {
    if (!validDocumentId(id)) throw new OperationsError("Lote inválido.");
    const ref = services().db.collection("_staffPdfBatches").doc(id);
    const data = (await ref.get()).data();
    if (!data || (!user.admin && data.ownerId !== user.uid))
      throw new OperationsError("Lote não encontrado.", 404);
    if (Date.parse(data.expiresAt) <= now())
      throw new OperationsError("Este lote expirou.", 410);
    return { ref, data };
  }
  async function itemAccess(batchId: string, itemId: string, user: WorkActor) {
    const batch = await access(batchId, user);
    if (!validDocumentId(itemId)) throw new OperationsError("Item inválido.");
    const ref = services().db.collection("_staffPdfBatchItems").doc(itemId);
    const data = (await ref.get()).data();
    if (
      !data ||
      data.batchId !== batchId ||
      data.ownerId !== batch.data.ownerId
    )
      throw new OperationsError("Item não encontrado.", 404);
    return { ...batch, itemRef: ref, item: data };
  }
  async function payload(
    batchId: string,
    itemId: string,
    data: any,
    expiresAt: string,
  ) {
    const expiry = Math.min(now() + 300000, Date.parse(expiresAt));
    const url = async (key: string) => {
      if (!/^[a-f0-9]{64}$/.test(key))
        throw new OperationsError("Receita inválida.");
      const [value] = await services()
        .bucket.file(assetPath(batchId, key))
        .getSignedUrl({ action: "read", expires: expiry });
      return value;
    };
    const fonts = await Promise.all(
      data.fonts.map(async (font: any) => {
        const { asset, ...value } = font;
        return asset ? { ...value, arquivoUrl: await url(asset) } : value;
      }),
    );
    return {
      item: itemView(itemId, data),
      job: data.job,
      fitMargin: data.fitMargin,
      originalUrl: await url(data.original),
      fonts,
      rendererVersion: 1,
      ...(data.printProfile ? { printProfile: data.printProfile } : {}),
      ...(data.initial
        ? {
            initial: {
              url: await url(data.initial.asset),
              sizePercent: data.initial.sizePercent,
            },
          }
        : {}),
    };
  }
  async function snapshot(
    batchId: string,
    source: string,
    limit: number,
    expected?: string,
  ) {
    const file = services().bucket.file(
      source,
      expected ? { generation: expected } : undefined,
    );
    const [meta] = await file.getMetadata();
    if (
      !Number(meta.size) ||
      Number(meta.size) > limit ||
      !/^\d+$/.test(String(meta.generation))
    )
      throw new OperationsError(
        "Um arquivo da receita excede o limite permitido.",
      );
    if (expected && String(meta.generation) !== expected)
      throw new OperationsError(
        "A base mudou durante a geração. Revise a fila.",
        409,
      );
    const key = hash(JSON.stringify([source, String(meta.generation)]));
    const dest = services().bucket.file(assetPath(batchId, key));
    const [exists] = await dest.exists();
    if (!exists) {
      const [bytes] = await services()
        .bucket.file(source, { generation: String(meta.generation) })
        .download();
      if (bytes.length > limit)
        throw new OperationsError("Arquivo da receita maior que o permitido.");
      try {
        await dest.save(bytes, {
          resumable: false,
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            contentType: meta.contentType || "application/octet-stream",
            cacheControl: "private,no-store",
            metadata: {
              batchId,
              sha256: createHash("sha256").update(bytes).digest("hex"),
            },
          },
        });
      } catch (error) {
        if (Number((error as any)?.code) !== 412) throw error;
      }
    }
    return key;
  }
  router.get(
    "/",
    action(async (_req, res) => {
      const user = actor(res);
      let query: any = services().db.collection("_staffPdfBatches");
      if (!user.admin) query = query.where("ownerId", "==", user.uid);
      const rows = await query
        .where("expiresAt", ">", new Date(now()).toISOString())
        .orderBy("expiresAt", "desc")
        .limit(100)
        .get();
      res.json({
        batches: rows.docs.map((row: any) => view(row.id, row.data())),
      });
    }),
  );
  router.post(
    "/",
    action(async (req, res) => {
      const user = actor(res);
      const id = idFor(user.uid, req.body?.requestId);
      const ref = services().db.collection("_staffPdfBatches").doc(id);
      const name = await activityActor(services().db, user);
      await services().db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) return;
        tx.create(ref, {
          ownerId: user.uid,
          ownerName: name.actorName,
          itemIds: [],
          createdAt: new Date(now()).toISOString(),
          expiresAt: new Date(now() + STAFF_BATCH_TTL_MS).toISOString(),
          reference: `LOTE-${id.slice(0, 10).toUpperCase()}`,
        });
      });
      const { data } = await access(id, user);
      res.status(201).json({ batch: view(id, data) });
    }),
  );
  router.get(
    "/:batchId/items",
    action(async (req, res) => {
      await access(req.params.batchId, actor(res));
      const rows = await services()
        .db.collection("_staffPdfBatchItems")
        .where("batchId", "==", req.params.batchId)
        .limit(50)
        .get();
      res.json({ items: rows.docs.map((row) => itemView(row.id, row.data())) });
    }),
  );
  router.post(
    "/:batchId/items",
    action(async (req, res) => {
      const user = actor(res),
        batchId = req.params.batchId;
      const { ref: batchRef, data: batch } = await access(batchId, user);
      if (batch.ownerId !== user.uid)
        throw new OperationsError("Este lote pertence a outra pessoa.", 403);
      const id = idFor(user.uid, req.body?.requestId);
      const itemRef = services().db.collection("_staffPdfBatchItems").doc(id);
      const fingerprint = hash(JSON.stringify(req.body?.job ?? null));
      const old = (await itemRef.get()).data();
      if (old) {
        if (old.batchId !== batchId || old.fingerprint !== fingerprint)
          throw new OperationsError(
            "Este pedido já foi usado em outro lote.",
            409,
          );
        res.json(await payload(batchId, id, old, batch.expiresAt));
        return;
      }
      const config = (
        await services().db.collection("config").doc("main").get()
      ).data();
      const fonts = normalizePersonalizationFonts(
        config?.fontes_personalizacao,
      );
      let job: StaffPdfBatchJob;
      let base;
      let fitMargin = 0.2;
      let fullPage = false;
      let printProfile;
      if (req.body?.job?.kind === "simple") {
        const input = req.body.job;
        if (
          typeof input.productId !== "string" ||
          !/^[A-Za-z0-9_-]{1,100}$/.test(input.productId) ||
          !validDocumentId(input.templateId)
        )
          throw new OperationsError("Modelo inválido.");
        const customization = normalizeTextCustomization(
          input.customization,
          fonts,
        );
        if (!customization)
          throw new OperationsError("Personalização inválida.");
        let barcode;
        try {
          barcode = normalizeStaffBarcode(input.barcode);
        } catch (error) {
          throw new OperationsError((error as Error).message);
        }
        if (
          typeof input.outputName !== "string" ||
          !input.outputName ||
          staffPdfOutputName(input.outputName) !== input.outputName
        )
          throw new OperationsError("Nome do arquivo inválido.");
        base = await resolveStaffPdfBase(
          services(),
          `catalog_${input.productId}_${input.templateId}`,
        );
        const product = (
          await services().db.collection("anuncios").doc(input.productId).get()
        ).data();
        if (product?.printProfile) {
          printProfile = parsePrintProfile(product.printProfile);
          if (!printProfile)
            throw new OperationsError("Formato de impressão inválido.");
        }
        if (
          input.barcodeVersion !== undefined &&
          ![1, 2].includes(input.barcodeVersion)
        )
          throw new OperationsError("Versão do código de barras inválida.");
        job = {
          ...(input.barcodeVersion === undefined
            ? {}
            : { barcodeVersion: input.barcodeVersion }),
          kind: "simple",
          productId: input.productId,
          templateId: input.templateId,
          customization,
          barcode,
          outputName: input.outputName,
        };
      } else {
        try {
          job = normalizeStaffPdfJob(req.body?.job, fonts);
        } catch (error) {
          throw new OperationsError((error as Error).message);
        }
        if (!job.barcode || !job.outputName)
          throw new OperationsError("Informe o código e o nome do arquivo.");
        base = await resolveStaffPdfBase(services(), job.baseId);
        const layout = (
          await services()
            .db.collection("_staffPdfLayouts")
            .doc(job.layoutId)
            .get()
        ).data();
        if (
          base.revision !== job.baseRevision ||
          !layout?.enabled ||
          layout.revision !== job.layoutRevision
        )
          throw new OperationsError(
            "A base ou o molde mudou. Revise o pedido.",
            409,
          );
        if (
          job.lines[0].kind === "main" &&
          JSON.stringify(fixedStaffPdfMain(layout.layout, job.lines[0])) !==
            JSON.stringify(job.lines[0])
        )
          throw new OperationsError("A área principal deve seguir o molde.");
        fitMargin = layout.layout.fit_margin;
        fullPage = Boolean(layout.layout.imagem_full_page);
      }
      const original = await snapshot(
        batchId,
        base.path,
        STAFF_DOCUMENT_MAX_BYTES,
        base.generation,
      );
      const recipeFonts = [];
      for (const id of new Set(
        isStaffPdfSimpleJob(job)
          ? [
              job.customization.fonte,
              ...(job.customization.linhas || []).map(
                (line) => line.fonte || job.customization.fonte,
              ),
            ]
          : job.lines.map((line) => line.fontId),
      )) {
        const font = staffPdfFont(id, fonts) || STAFF_PDF_SYSTEM_FONT;
        const { arquivoUrl, ...safe } = font;
        if (arquivoUrl) {
          const path = adminAssetPathFromUrl(
            arquivoUrl,
            services().bucket.name,
          );
          if (!path || !isAdminFontPath(path))
            throw new OperationsError(
              `Cadastre a fonte “${font.nome}” pelo upload de fontes para preservar este lote.`,
            );
          recipeFonts.push({
            ...safe,
            asset: await snapshot(batchId, path, 16 * 1024 * 1024),
          });
        } else recipeFonts.push(safe);
      }
      let initial: { asset: string; sizePercent: number } | undefined;
      const letter = firstInitial(
        isStaffPdfSimpleJob(job) ? job.customization.texto : job.lines[0].text,
      );
      const alphabet = (base as any).alphabet;
      const path = letter && alphabet?.letters?.[letter]?.path;
      if (path && matchingAlphabetName(base.name, alphabet.folderName)) {
        const valid =
          base.source === "internal"
            ? new RegExp(
                `^staff-pdf-bases/${base.id}/letters/[a-f0-9]{32}[.]png$`,
              ).test(path)
            : new RegExp(
                `^catalog/products/${base.productId}/[a-f0-9]{32}[.]png$`,
              ).test(path);
        if (!valid) throw new OperationsError("Inicial inválida.");
        initial = {
          asset: await snapshot(batchId, path, STAFF_DOCUMENT_MAX_BYTES),
          sizePercent: fullPage ? 100 : alphabet.sizePercent || 60,
        };
      }
      const current = await deps.authorize(req);
      if (
        current.uid !== user.uid ||
        (!current.admin && !current.permissions?.includes("documents.generate"))
      )
        throw new OperationsError("Permissão revogada.", 403);
      const value = {
        batchId,
        ownerId: user.uid,
        fingerprint,
        job,
        original,
        fonts: recipeFonts,
        ...(initial ? { initial } : {}),
        fitMargin,
        ...(printProfile ? { printProfile } : {}),
        rendererVersion: 1,
        status: "pending",
        expiresAt: batch.expiresAt,
        ...(/^[a-f0-9]{32}$/.test(req.get("x-work-task") || "")
          ? { taskId: req.get("x-work-task") }
          : {}),
      };
      await services().db.runTransaction(async (tx) => {
        const parent = (await tx.get(batchRef)).data();
        const existing = (await tx.get(itemRef)).data();
        if (!parent || Date.parse(parent.expiresAt) <= now())
          throw new OperationsError("Lote expirado.", 410);
        if (existing) {
          if (
            existing.fingerprint !== fingerprint ||
            existing.batchId !== batchId
          )
            throw new OperationsError("O pedido mudou durante a geração.", 409);
          return;
        }
        if (parent.itemIds.length >= 50)
          throw new OperationsError("Este lote já possui 50 pedidos.");
        tx.create(itemRef, value);
        tx.set(batchRef, { itemIds: [...parent.itemIds, id] }, { merge: true });
      });
      res
        .status(201)
        .json(
          await payload(
            batchId,
            id,
            (await itemRef.get()).data(),
            batch.expiresAt,
          ),
        );
    }),
  );
  router.get(
    "/:batchId/items/:itemId",
    action(async (req, res) => {
      const { data, item } = await itemAccess(
        req.params.batchId,
        req.params.itemId,
        actor(res),
      );
      res.json(
        await payload(
          req.params.batchId,
          req.params.itemId,
          item,
          data.expiresAt,
        ),
      );
    }),
  );
  router.post(
    "/:batchId/items/:itemId/complete",
    action(async (req, res) => {
      const user = actor(res);
      const { itemRef, item } = await itemAccess(
        req.params.batchId,
        req.params.itemId,
        user,
      );
      if (item.status !== "ready") {
        const who = await activityActor(services().db, user);
        await services().db.runTransaction(async (tx) => {
          const current = (await tx.get(itemRef)).data();
          if (current?.status === "ready") return;
          if (!current || Date.parse(current.expiresAt) <= now())
            throw new OperationsError("Lote expirado.", 410);
          const audit = await prepareWorkActivity(
            services().db,
            who,
            "document.generated",
            req.params.itemId,
            tx,
            {
              now: now(),
              id: `batch-item-${req.params.itemId}`,
              reference: current.job.outputName,
              taskId: current.taskId,
            },
          );
          tx.set(
            itemRef,
            { status: "ready", completedAt: new Date(now()).toISOString() },
            { merge: true },
          );
          audit.write(tx);
        });
      }
      res.json({ ready: true });
    }),
  );
  return router;
}

export async function cleanupStaffPdfBatches(
  services: ReturnType<StaffDocumentDeps["services"]>,
  now = Date.now(),
) {
  const rows = await services.db
    .collection("_staffPdfBatches")
    .where("expiresAt", "<=", new Date(now).toISOString())
    .limit(50)
    .get();
  let deleted = 0,
    failed = 0;
  for (const row of rows.docs) {
    // Let in-flight snapshot writes finish before removing the entire prefix.
    if (now - Date.parse(row.data().expiresAt) < 10 * 60000) continue;
    try {
      await services.bucket.deleteFiles({
        prefix: `staff-pdf-batches/${row.id}/`,
      });
      const items = await services.db
        .collection("_staffPdfBatchItems")
        .where("batchId", "==", row.id)
        .get();
      const batch = services.db.batch();
      items.docs.forEach((item) => batch.delete(item.ref));
      batch.delete(row.ref);
      await batch.commit();
      deleted++;
    } catch {
      failed++;
    }
  }
  return { deleted, failed };
}
