import express from "express";
import { createHash } from "node:crypto";
import {
  normalizePersonalizationFonts,
  normalizeTextCustomization,
} from "../lib/textCustomization.js";
import {
  fixedStaffPdfMain,
  normalizeStaffPdfJob,
  staffPdfInitialSize,
  STAFF_PDF_SYSTEM_FONT,
  staffPdfFont,
  type StaffPdfJob,
} from "../lib/staffPdf.js";
import { parsePrintProfile } from "../lib/printProfile.js";
import {
  isStaffPdfSimpleJob,
  staffPdfBatchName,
  type StaffPdfBatchJob,
} from "../lib/staffPdfBatch.js";
import { staffPdfOutputName } from "../lib/staffPdf.js";
import {
  isStaffBarcodeVersion,
  normalizeStaffBarcode,
  STAFF_BATCH_TTL_MS,
} from "../lib/staffPdfBarcode.js";
import {
  DEFAULT_DECORATIVE_INITIAL_PERCENT,
  findAlphabetLetter,
  matchingAlphabetName,
} from "../lib/decorativeInitial.js";
import { adminAssetPathFromUrl, isAdminFontPath } from "../lib/adminAsset.js";
import {
  validDocumentId,
  STAFF_DOCUMENT_MAX_BYTES,
} from "../lib/staffDocument.js";
import { OperationsError } from "../lib/operations.js";
import { resolveStaffPdfBase } from "./staffPdfLibrary.js";
import { composeStaffPdfArchive, staffPdfAttachment, staffPdfBatchArchivePath, staffPdfBatchFilePath, STAFF_PDF_ARCHIVE_VERSION } from "./staffPdfArchive.js";
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
  function batchName(value: unknown) {
    try { return staffPdfBatchName(value); }
    catch (error) { throw new OperationsError((error as Error).message); }
  }
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
    ...(data.name ? { name: data.name } : {}),
    createdAt: data.createdAt,
    expiresAt: data.expiresAt,
    ownerName: data.ownerName,
    count: data.itemCount ?? data.itemIds?.length ?? 0,
  });
  const itemView = (id: string, data: any) => ({
    id,
    outputName: data.job.outputName,
    barcode: data.job.barcode,
    status: data.status,
    hasFile: Boolean(data.pdf),
  });
  async function access(id: string, user: WorkActor, ownerOnly = false) {
    if (!validDocumentId(id)) throw new OperationsError("Lote inválido.");
    const ref = services().db.collection("_staffPdfBatches").doc(id);
    const data = (await ref.get()).data();
    if (!data || (ownerOnly && !user.admin && data.ownerId !== user.uid))
      throw new OperationsError("Lote não encontrado.", 404);
    if (Date.parse(data.expiresAt) <= now())
      throw new OperationsError("Este lote expirou.", 410);
    return { ref, data };
  }
  async function itemAccess(batchId: string, itemId: string, user: WorkActor, ownerOnly = false) {
    const batch = await access(batchId, user, ownerOnly);
    if (!validDocumentId(itemId)) throw new OperationsError("Item inválido.");
    const ref = services().db.collection("_staffPdfBatchItems").doc(itemId);
    const data = (await ref.get()).data();
    if (
      !data ||
      data.batchId !== batchId ||
      data.ownerId !== batch.data.ownerId ||
      (!user.admin && batch.data.ownerId !== user.uid && data.status !== "ready")
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
    const [originalUrl, fonts, initial, uploadExists] = await Promise.all([
      url(data.original),
      Promise.all(data.fonts.map(async (font: any) => {
        const { asset, ...value } = font;
        return asset ? { ...value, arquivoUrl: await url(asset), assetKey: asset } : value;
      })),
      data.initial && (async () => ({
        url: await url(data.initial.asset),
        sizePercent: data.initial.sizePercent,
        assetKey: data.initial.asset,
      }))(),
      data.pdf ? false : services().bucket.file(staffPdfBatchFilePath(batchId, itemId)).exists().then(([exists]) => exists),
    ]);
    return {
      item: itemView(itemId, data),
      job: data.job,
      fitMargin: data.fitMargin,
      originalUrl,
      originalKey: data.original,
      fonts,
      rendererVersion: 1,
      ...(uploadExists ? { uploadExists: true } : {}),
      ...(data.printProfile ? { printProfile: data.printProfile } : {}),
      ...(initial ? { initial } : {}),
    };
  }
  async function snapshot(
    batchId: string,
    source: string,
    limit: number,
    expected?: string,
  ) {
    const { bucket } = services();
    const knownKey = expected && hash(JSON.stringify([source, expected]));
    const knownDestination = knownKey ? bucket.file(assetPath(batchId, knownKey)) : undefined;
    if (knownKey && knownDestination && (await knownDestination.exists())[0]) return knownKey;
    const file = bucket.file(source, expected ? { generation: expected } : undefined);
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
    const key = knownKey || hash(JSON.stringify([source, String(meta.generation)]));
    const dest = knownDestination ?? bucket.file(assetPath(batchId, key));
    if (knownDestination || !(await dest.exists())[0]) {
      const [bytes] = await bucket.file(source, { generation: String(meta.generation) })
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
    action(async (req, res) => {
      const user = actor(res);
      const collection = services().db.collection("_staffPdfBatches");
      let query = collection.where("expiresAt", ">", new Date(now()).toISOString()).orderBy("expiresAt", "desc").limit(101);
      if (req.query.cursor !== undefined) {
        if (!validDocumentId(req.query.cursor)) throw new OperationsError("Página inválida.");
        const cursor = await collection.doc(req.query.cursor).get();
        if (!cursor.exists) throw new OperationsError("Atualize os lotes para continuar.", 409);
        query = query.startAfter(cursor);
      }
      const rows = await query.get();
      const page = rows.docs.slice(0, 100);
      res.json({
        batches: page.flatMap(row => {
          const data = row.data();
          const canManage = user.admin || data.ownerId === user.uid;
          return canManage || (data.fileCount ?? data.itemIds?.length ?? 0) > 0
            ? [{ ...view(row.id, data), canManage }] : [];
        }),
        ...(rows.size > 100 ? { next: page[page.length - 1].id } : {}),
      });
    }),
  );
  router.post(
    "/",
    action(async (req, res) => {
      const user = actor(res);
      const id = idFor(user.uid, req.body?.requestId);
      const ref = services().db.collection("_staffPdfBatches").doc(id);
      const name = batchName(req.body?.name ?? "");
      const owner = await activityActor(services().db, user);
      await services().db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) return;
        tx.create(ref, {
          ownerId: user.uid,
          ownerName: owner.actorName,
          name,
          itemCount: 0,
          createdAt: new Date(now()).toISOString(),
          expiresAt: new Date(now() + STAFF_BATCH_TTL_MS).toISOString(),
          reference: `LOTE-${id.slice(0, 10).toUpperCase()}`,
        });
      });
      const { data } = await access(id, user);
      res.status(201).json({ batch: view(id, data) });
    }),
  );
  router.post(
    "/:batchId/name",
    action(async (req, res) => {
      const user = actor(res), id = req.params.batchId;
      if (!validDocumentId(id)) throw new OperationsError("Lote inválido.");
      const name = batchName(req.body?.name);
      const { db } = services();
      const ref = db.collection("_staffPdfBatches").doc(id);
      const batch = await db.runTransaction(async (tx) => {
        const data = (await tx.get(ref)).data();
        if (!data || (!user.admin && data.ownerId !== user.uid))
          throw new OperationsError("Lote não encontrado.", 404);
        if (Date.parse(data.expiresAt) <= now())
          throw new OperationsError("Este lote expirou.", 410);
        tx.set(ref, { name }, { merge: true });
        return view(id, { ...data, name });
      });
      res.json({ batch });
    }),
  );
  router.get(
    "/:batchId/items",
    action(async (req, res) => {
      const user = actor(res);
      const { data } = await access(req.params.batchId, user);
      const collection = services().db.collection("_staffPdfBatchItems");
      const pageSize = 500;
      let query = collection
        .where("batchId", "==", req.params.batchId)
        .select("job.outputName", "job.barcode", "status", "pdf")
        .orderBy("__name__")
        .limit(pageSize + 1);
      if (req.query.cursor !== undefined) {
        if (!validDocumentId(req.query.cursor)) throw new OperationsError("Página do lote inválida.");
        query = query.startAfter(collection.doc(req.query.cursor));
      }
      const rows = await query.get();
      const page = rows.docs.slice(0, pageSize);
      res.json({
        items: page.filter((row) => user.admin || data.ownerId === user.uid || row.data().status === "ready").map((row) => itemView(row.id, row.data())),
        ...(rows.size > pageSize ? { next: page[page.length - 1].id } : {}),
      });
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
      const legacyId = idFor(user.uid, req.body?.requestId);
      const id = hash(`${batchId}:${legacyId}`).slice(0, 32);
      const items = services().db.collection("_staffPdfBatchItems");
      const itemRef = items.doc(id);
      const legacyRef = items.doc(legacyId);
      const fingerprint = hash(JSON.stringify(req.body?.job ?? null));
      async function findSavedItem(get: (ref: typeof itemRef) => Promise<FirebaseFirestore.DocumentSnapshot>) {
        const current = (await get(itemRef)).data();
        // The original ID omitted the batch. Keep that ID only for resuming its own batch.
        const legacy = current ? undefined : (await get(legacyRef)).data();
        const saved = current ?? (legacy?.batchId === batchId ? legacy : undefined);
        if (!saved) return;
        if (saved.batchId !== batchId || saved.ownerId !== user.uid || saved.fingerprint !== fingerprint)
          throw new OperationsError("O pedido mudou durante a geração.", 409);
        return { id: current ? id : legacyId, data: saved };
      }
      const old = await findSavedItem((ref) => ref.get());
      if (old) {
        res.json(await payload(batchId, old.id, old.data, batch.expiresAt));
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
      let initialSize: number | undefined;
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
          !isStaffBarcodeVersion(input.barcodeVersion)
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
        if (!job.outputName)
          throw new OperationsError("Informe o nome do arquivo.");
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
        initialSize = staffPdfInitialSize(layout.layout);
      }
      async function snapshotFonts(job: StaffPdfBatchJob) {
        const snapshots = [];
        const ids = isStaffPdfSimpleJob(job)
          ? [
            job.customization.fonte,
            ...(job.customization.linhas || []).map((line) => line.fonte || job.customization.fonte),
          ]
          : job.lines.map((line) => line.fontId);
        for (const id of new Set(ids)) {
          const font = staffPdfFont(id, fonts) || STAFF_PDF_SYSTEM_FONT;
          const { arquivoUrl, ...safe } = font;
          if (arquivoUrl) {
            const path = adminAssetPathFromUrl(arquivoUrl, services().bucket.name);
            if (!path || !isAdminFontPath(path))
              throw new OperationsError(
                `Cadastre a fonte “${font.nome}” pelo upload de fontes para preservar este lote.`,
              );
            snapshots.push({ ...safe, asset: await snapshot(batchId, path, 16 * 1024 * 1024) });
          } else snapshots.push(safe);
        }
        return snapshots;
      }
      const alphabet = base.alphabet;
      const letter = findAlphabetLetter(
        alphabet?.letters,
        isStaffPdfSimpleJob(job) ? job.customization.texto : job.lines[0].text,
      );
      const path = letter && alphabet?.letters?.[letter]?.path;
      const initialPath = path && matchingAlphabetName(base.name, alphabet.folderName) ? path : undefined;
      if (initialPath) {
        const valid = base.source === "internal"
          ? new RegExp(`^staff-pdf-bases/${base.id}/letters/[a-f0-9]{32}[.]png$`).test(initialPath)
          : new RegExp(`^catalog/products/${base.productId}/[a-f0-9]{32}[.]png$`).test(initialPath);
        if (!valid) throw new OperationsError("Inicial inválida.");
      }
      const [original, recipeFonts, initialAsset] = await Promise.all([
        snapshot(batchId, base.path, STAFF_DOCUMENT_MAX_BYTES, base.generation),
        snapshotFonts(job),
        initialPath && snapshot(batchId, initialPath, STAFF_DOCUMENT_MAX_BYTES),
      ]);
      const initial = initialAsset ? {
        asset: initialAsset,
        sizePercent: initialSize ?? (alphabet.sizePercent || DEFAULT_DECORATIVE_INITIAL_PERCENT),
      } : undefined;
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
      const result = await services().db.runTransaction(async (tx) => {
        const parent = (await tx.get(batchRef)).data();
        if (!parent || Date.parse(parent.expiresAt) <= now())
          throw new OperationsError("Lote expirado.", 410);
        const existing = await findSavedItem((ref) => tx.get(ref));
        if (existing) return { ...existing, created: false };
        const position = (parent.itemCount ?? parent.itemIds?.length ?? 0) + 1;
        const data = { ...value, position };
        tx.create(itemRef, data);
        tx.set(batchRef, { itemCount: position }, { merge: true });
        return { id, data, created: true };
      });
      res.status(result.created ? 201 : 200)
        .json(await payload(batchId, result.id, result.data, batch.expiresAt));
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
    "/:batchId/items/:itemId/upload",
    action(async (req, res) => {
      const { batchId, itemId } = req.params;
      const { data, item } = await itemAccess(batchId, itemId, actor(res), true);
      const { size, crc32 } = req.body ?? {};
      if (!Number.isSafeInteger(size) || size < 8 || size > STAFF_DOCUMENT_MAX_BYTES ||
          typeof crc32 !== "string" || !/^[0-9a-f]{8}$/.test(crc32))
        throw new OperationsError("PDF gerado inválido.");
      const file = services().bucket.file(staffPdfBatchFilePath(batchId, itemId));
      if (item.pdf || (await file.exists())[0]) {
        res.json({ uploaded: true });
        return;
      }
      const headers = {
        "Content-Type": "application/pdf",
        "x-goog-if-generation-match": "0",
        "x-goog-meta-zipcrc": crc32,
      };
      const [url] = await file.getSignedUrl({
        version: "v4",
        action: "write",
        expires: Math.min(now() + 300000, Date.parse(data.expiresAt)),
        contentType: headers["Content-Type"],
        extensionHeaders: {
          "content-length": String(size),
          "x-goog-if-generation-match": headers["x-goog-if-generation-match"],
          "x-goog-meta-zipcrc": headers["x-goog-meta-zipcrc"],
        },
      });
      res.json({ url, headers });
    }),
  );
  router.post(
    "/:batchId/items/:itemId/complete",
    action(async (req, res) => {
      const user = actor(res);
      const { batchId, itemId } = req.params;
      const { ref: batchRef, itemRef, item } = await itemAccess(batchId, itemId, user, true);
      if (!item.pdf) {
        const file = services().bucket.file(staffPdfBatchFilePath(batchId, itemId));
        const [meta] = await file.getMetadata().catch((error) => {
          if (Number(error?.code) === 404) throw new OperationsError("O PDF do lote ainda não foi salvo.", 409);
          throw error;
        });
        const generation = String(meta.generation);
        const size = Number(meta.size);
        const crc = meta.metadata?.zipcrc;
        if (!/^\d+$/.test(generation) || meta.contentType !== "application/pdf" ||
            !Number.isSafeInteger(size) || size < 8 || size > STAFF_DOCUMENT_MAX_BYTES ||
            typeof crc !== "string" || !/^[0-9a-f]{8}$/.test(crc))
          throw new OperationsError("O arquivo salvo não é um PDF válido.");
        const [header] = await services().bucket.file(file.name, { generation }).download({ start: 0, end: 4 });
        if (header.toString("ascii") !== "%PDF-")
          throw new OperationsError("O arquivo salvo não é um PDF válido.");
        const who = item.status !== "ready" ? await activityActor(services().db, user) : undefined;
        const pdf = { bytes: size, crc32: Number.parseInt(crc, 16), generation };
        await services().db.runTransaction(async (tx) => {
          const current = (await tx.get(itemRef)).data();
          if (!current || Date.parse(current.expiresAt) <= now())
            throw new OperationsError("Lote expirado.", 410);
          if (current.pdf) return;
          const batch = (await tx.get(batchRef)).data();
          if (!batch || Date.parse(batch.expiresAt) <= now())
            throw new OperationsError("Lote expirado.", 410);
          if (current.status !== "ready" && who) {
            const audit = await prepareWorkActivity(
              services().db,
              who,
              "document.generated",
              itemId,
              tx,
              { now: now(), id: `batch-item-${itemId}`, reference: current.job.outputName, taskId: current.taskId },
            );
            audit.write(tx);
          }
          tx.set(batchRef, { fileCount: (batch.fileCount ?? 0) + 1 }, { merge: true });
          tx.set(itemRef, {
            pdf,
            ...(current.status === "ready" ? {} : { status: "ready", completedAt: new Date(now()).toISOString() }),
          }, { merge: true });
        });
      }
      res.json({ ready: true });
    }),
  );
  router.get(
    "/:batchId/items/:itemId/file",
    action(async (req, res) => {
      const { batchId, itemId } = req.params;
      const { item, data } = await itemAccess(batchId, itemId, actor(res));
      if (item.status !== "ready")
        throw new OperationsError("O PDF ainda está na fila.", 409);
      if (!item.pdf) {
        res.json({ file: null });
        return;
      }
      const [url] = await services().bucket.file(staffPdfBatchFilePath(batchId, itemId)).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Math.min(now() + 300000, Date.parse(data.expiresAt)),
        queryParams: { generation: item.pdf.generation },
        responseDisposition: req.query.inline === "true" ? "inline" : staffPdfAttachment(item.job.outputName, "pdf"),
      });
      res.json({ file: { url, name: `${item.job.outputName}.pdf` } });
    }),
  );
  router.post(
    "/:batchId/archive",
    action(async (req, res) => {
      const batchId = req.params.batchId;
      const { ref, data } = await access(batchId, actor(res));
      const { db, bucket } = services();
      const format = req.body?.format ?? "zip";
      if (format !== "zip" && format !== "pdf")
        throw new OperationsError("Formato de download inválido.");
      const cacheField = format === "pdf" ? "consolidatedArchive" : "archive";
      const count = data.fileCount ?? 0;
      const name = staffPdfOutputName(data.name || "") || data.reference;
      const sendArchive = async (path: string) => {
        const [url] = await bucket.file(path).getSignedUrl({
          version: "v4",
          action: "read",
          expires: Math.min(now() + 300000, Date.parse(data.expiresAt)),
          responseDisposition: staffPdfAttachment(name, format),
        });
        res.json({ url, name: `${name}.${format}` });
      };
      const candidates = format === "pdf" ? [data.archive, data.consolidatedArchive] : [data.archive];
      const cached = candidates.find((entry) =>
        entry?.version === STAFF_PDF_ARCHIVE_VERSION &&
        entry.fileCount === count &&
        /^[a-f0-9]{64}$/.test(entry.fingerprint),
      );
      if (cached) {
        await sendArchive(staffPdfBatchArchivePath(batchId, cached.fingerprint, format));
        return;
      }
      const rows = await db.collection("_staffPdfBatchItems")
        .where("batchId", "==", batchId)
        .select("ownerId", "status", "pdf", "job.outputName", "position", "completedAt")
        .get();
      const ready = rows.docs.filter((row) => row.data().status === "ready" && row.data().ownerId === data.ownerId);
      const legacy = ready.filter((row) => !row.get("pdf")).map((row) => row.id);
      if (legacy.length) {
        res.json({ legacy });
        return;
      }
      if (!ready.length) {
        res.json({ empty: true });
        return;
      }
      const cursor = req.body?.cursor;
      const fingerprint = req.body?.fingerprint;
      const stage = req.body?.stage;
      const progress = (stage === "merge" || stage === "zip") &&
        Number.isSafeInteger(cursor) && cursor >= 0 && typeof fingerprint === "string"
        ? { stage: stage as "merge" | "zip", cursor, fingerprint } : undefined;
      const entries = ready.sort((a, b) =>
        (a.get("position") ?? 0) - (b.get("position") ?? 0) ||
        (a.get("completedAt") ?? "").localeCompare(b.get("completedAt") ?? "") ||
        a.id.localeCompare(b.id),
      ).map((row) => ({
        id: row.id,
        name: row.data().job.outputName,
        bytes: row.data().pdf.bytes,
        crc32: row.data().pdf.crc32,
        generation: row.data().pdf.generation,
      }));
      const result = await composeStaffPdfArchive(bucket, batchId, entries, format, progress);
      if ("progress" in result) {
        res.json(result);
        return;
      }
      // New completions invalidate the archive. Retain the current snapshot for its caller.
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data();
        if (current && (current.fileCount ?? 0) === count)
          tx.set(ref, {
            [cacheField]: { version: STAFF_PDF_ARCHIVE_VERSION, fileCount: count, fingerprint: result.fingerprint },
          }, { merge: true });
      });
      await sendArchive(result.file.name);
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
      const query = services.db.collection("_staffPdfBatchItems").where("batchId", "==", row.id);
      for (;;) {
        const items = await query.limit(450).get();
        if (!items.size) break;
        const batch = services.db.batch();
        items.docs.forEach((item) => batch.delete(item.ref));
        await batch.commit();
      }
      await row.ref.delete();
      deleted++;
    } catch {
      failed++;
    }
  }
  return { deleted, failed };
}
