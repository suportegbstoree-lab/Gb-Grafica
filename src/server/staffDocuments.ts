import { randomUUID, createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { resendEmailContent } from "./resendEmailTemplates.js";
import express from "express";
import type { getAdminServices } from "./firebaseAdmin.js";
import { FieldValue } from "firebase-admin/firestore";
import { isTemplatePath } from "../lib/pdfTemplate.js";
import { fixedStaffPdfMain, normalizeStaffPdfJob, STAFF_PDF_MAX_PAGES } from '../lib/staffPdf.js';
import { resolveStaffPdfBase } from './staffPdfLibrary.js';
import {
  normalizeTextCustomization,
  activePersonalizationFonts,
  normalizePersonalizationFonts,
} from "../lib/textCustomization.js";
import {
  STAFF_DOCUMENT_TTL_MS,
  STAFF_DOCUMENT_MAX_BYTES,
  staffDocumentPath,
  staffDocumentView,
  validDocumentId,
} from "../lib/staffDocument.js";
import { OperationsError } from "../lib/operations.js";
import { activityActor, recordStaffActivity } from "./staffActivity.js";
import { prepareWorkActivity } from "./workTracking.js";
import { emailAddress, emailConfiguration } from "./emailPreferences.js";
import type { WorkActor } from "./workRouter.js";
type Services = ReturnType<typeof getAdminServices>;
export interface StaffDocumentDeps {
  services: () => Services;
  authorize: (req: express.Request) => Promise<WorkActor>;
  origin: (req: express.Request) => string;
  limit?: (key: string, count: number, ms: number) => void;
  fetcher?: typeof fetch;
  now?: () => number;
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function sanitizeStaffPdf(
  bytes: Uint8Array,
  title: string,
  createdAt: string,
  expectedPageCount = 2,
) {
  if (
    bytes.length < 8 ||
    bytes.length > STAFF_DOCUMENT_MAX_BYTES ||
    Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-"
  )
    throw new OperationsError("O arquivo gerado não é um PDF válido.");
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new OperationsError("O PDF não pôde ser validado.");
  }
  if (!Number.isInteger(expectedPageCount) || expectedPageCount < 1 || expectedPageCount > STAFF_PDF_MAX_PAGES || source.getPageCount() !== expectedPageCount)
    throw new OperationsError(expectedPageCount === 2 ? 'Gere a capa e a contracapa automática. A quantidade de páginas não corresponde à base selecionada.' : 'A quantidade de páginas não corresponde à base selecionada.');
  const result = await PDFDocument.create();
  result.setTitle(title);
  result.setAuthor("GB Gráfica");
  result.setCreationDate(new Date(createdAt));
  result.setModificationDate(new Date(createdAt));
  for (const page of source.getPages()) {
    const { x, y, width, height } = page.getCropBox();
    if (
      ![x, y, width, height].every(Number.isFinite) ||
      width < 1 ||
      height < 1 ||
      width > 14400 ||
      height > 14400 ||
      page.getRotation().angle % 360 !== 0
    )
      throw new OperationsError("Formato do PDF inválido.");
    const sheet = result.addPage([width, height]);
    if (page.node.Contents()) {
      const embedded = await result.embedPage(page, { left: x, bottom: y, right: x + width, top: y + height });
      sheet.drawPage(embedded, { x: 0, y: 0, width, height });
    }
    for (const key of ["TrimBox", "BleedBox"] as const) {
      const box = key === "TrimBox" ? page.getTrimBox() : page.getBleedBox();
      if (key === "TrimBox")
        sheet.setTrimBox(box.x - x, box.y - y, box.width, box.height);
      else sheet.setBleedBox(box.x - x, box.y - y, box.width, box.height);
    }
  }
  const output = await result.save();
  if (output.length > STAFF_DOCUMENT_MAX_BYTES)
    throw new OperationsError("O PDF final excede o tamanho permitido.");
  return output;
}
export async function cleanupStaffDocuments(
  services: Services,
  now = Date.now(),
) {
  const rows = await services.db
    .collection("_staffDocuments")
    .where("expiresAt", "<=", new Date(now).toISOString())
    .limit(100)
    .get();
  let deleted = 0,
    failed = 0;
  for (const doc of rows.docs) {
    const data = doc.data();
    try {
      for (const upload of [true, false]) {
        try {
          await services.bucket
            .file(staffDocumentPath(data.ownerId, doc.id, upload))
            .delete();
        } catch (error) {
          if (Number((error as any)?.code) !== 404) throw error;
        }
      }
      await services.db
        .collection("_staffDocuments")
        .doc(doc.id)
        .set(
          {
            status: "expired",
            expiredAt: data.expiresAt,
            expiresAt: FieldValue.delete(),
            customization: FieldValue.delete(),
            shareEpoch: Number(data.shareEpoch || 0) + 1,
            purgedAt: new Date(now).toISOString(),
          },
          { merge: true },
        );
      deleted++;
    } catch {
      failed++;
    }
  }
  let metadataDeleted = 0,
    metadataTruncated = false;
  for (const collection of [
    "_staffDocumentShares",
    "_staffDocumentMails",
    "_workTasks",
  ]) {
    const expired = await services.db
      .collection(collection)
      .where("expiresAt", "<=", new Date(now).toISOString())
      .limit(100)
      .get();
    metadataTruncated ||= expired.size === 100;
    const result = await Promise.allSettled(
      expired.docs.map((doc) =>
        services.db.collection(collection).doc(doc.id).delete(),
      ),
    );
    metadataDeleted += result.filter(
      (item) => item.status === "fulfilled",
    ).length;
    failed += result.filter((item) => item.status === "rejected").length;
  }
  return {
    deleted,
    failed,
    metadataDeleted,
    truncated: rows.size === 100 || metadataTruncated,
  };
}
export function createStaffDocumentRouters(deps: StaffDocumentDeps) {
  const admin = express.Router(),
    shared = express.Router(),
    now = () => deps.now?.() ?? Date.now(),
    services = deps.services;
  const action =
    (
      fn: (req: express.Request, res: express.Response) => Promise<void>,
    ): express.RequestHandler =>
    (req, res, next) => {
      void fn(req, res).catch(next);
    };
  admin.use((req, res, next) => {
    void deps
      .authorize(req)
      .then((user) => {
        if (!user.admin && !user.permissions?.includes("documents.generate"))
          throw new OperationsError(
            "Sua função não permite gerar documentos.",
            403,
          );
        res.locals.user = user;
        res.setHeader("Cache-Control", "private, no-store");
        deps.limit?.(`staff-documents:${user.uid}`, 90, 60000);
        next();
      })
      .catch(next);
  });
  async function access(id: string, user: WorkActor, ready = true) {
    if (!validDocumentId(id)) throw new OperationsError("Documento inválido.");
    const ref = services().db.collection("_staffDocuments").doc(id),
      snapshot = await ref.get(),
      data = snapshot.data();
    if (!data || (!user.admin && data.ownerId !== user.uid))
      throw new OperationsError("Documento não encontrado.", 404);
    if (Date.parse(data.expiresAt) <= now() || data.status === "expired")
      throw new OperationsError(
        "Este documento expirou e não está mais disponível.",
        410,
      );
    if (ready && data.status !== "ready")
      throw new OperationsError("A geração ainda não foi concluída.", 409);
    return { ref, data };
  }
  async function template(productId: unknown, templateId: unknown) {
    if (
      typeof productId !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(productId) ||
      !validDocumentId(templateId)
    )
      throw new OperationsError("Selecione um modelo PDF do catálogo.");
    const p = (
        await services().db.collection("anuncios").doc(productId).get()
      ).data(),
      t = p?.modelosPdf?.find((value: any) => value.id === templateId);
    if (!t || !isTemplatePath(t.path, productId))
      throw new OperationsError("Modelo não encontrado.", 404);
    return t;
  }
  async function link(id: string, user: WorkActor, req: express.Request) {
    const { data } = await access(id, user),
      token =
        randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
      key = hash(token);
    await services()
      .db.collection("_staffDocumentShares")
      .doc(`${id}-${key}`)
      .create({
        documentId: id,
        ownerId: data.ownerId,
        epoch: Number(data.shareEpoch || 0),
        expiresAt: data.expiresAt,
        createdAt: new Date(now()).toISOString(),
      });
    return `${deps.origin(req)}/api/documents/shared/${id}?token=${token}`;
  }
  admin.get(
    "/",
    action(async (req, res) => {
      const user = res.locals.user as WorkActor;
      let query: any = services().db.collection("_staffDocuments");
      if (!user.admin) query = query.where("ownerId", "==", user.uid);
      const rows = await query
        .where("expiresAt", ">", new Date(now()).toISOString())
        .orderBy("expiresAt", "desc")
        .limit(100)
        .get();
      res.json({
        documents: rows.docs.map((doc: any) =>
          staffDocumentView(doc.id, doc.data()),
        ),
        truncated: rows.size === 100,
      });
    }),
  );
  admin.get(
    "/templates/:productId/:templateId",
    action(async (req, res) => {
      const t = await template(req.params.productId, req.params.templateId),
        file = services().bucket.file(t.path),
        [meta] = await file.getMetadata();
      if (
        meta.contentType !== "application/pdf" ||
        Number(meta.size) > STAFF_DOCUMENT_MAX_BYTES
      )
        throw new OperationsError("Modelo PDF inválido.");
      const [url] = await file.getSignedUrl({
        action: "read",
        expires: now() + 300000,
        responseDisposition: "inline",
      });
      res.json({ url });
    }),
  );
  admin.post(
    "/",
    action(async (req, res) => {
      const user = res.locals.user as WorkActor;
      deps.limit?.(`staff-document-generate:${user.uid}`, 20, 60000);
      let { productId, templateId, customization, requestId, staffJob } =
        req.body || {};
      if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/.test(requestId))
        throw new OperationsError("Identificador da geração inválido.");
      const config = (
          await services().db.collection("config").doc("main").get()
        ).data();
      let t: any, text: any, expectedPageCount = 2, canonicalJob: any;
      if (staffJob !== undefined) {
        try { canonicalJob = normalizeStaffPdfJob(staffJob, normalizePersonalizationFonts(config?.fontes_personalizacao)); }
        catch (error) { throw new OperationsError((error as Error).message); }
        const base = await resolveStaffPdfBase(services(), canonicalJob.baseId);
        const mold = (await services().db.collection('_staffPdfLayouts').doc(canonicalJob.layoutId).get()).data();
        if (base.revision !== canonicalJob.baseRevision || !mold?.enabled || mold.revision !== canonicalJob.layoutRevision) throw new OperationsError('A base ou o molde mudou. Abra a edição novamente.',409);
        if (canonicalJob.lines[0].kind === "main") {
          const main = canonicalJob.lines[0];
          const fixed = fixedStaffPdfMain(mold.layout, main);
          if (main.effects || main.color !== fixed.color || main.align !== fixed.align ||
              main.rotation !== fixed.rotation || JSON.stringify(main.portrait) !== JSON.stringify(fixed.portrait) ||
              JSON.stringify(main.landscape) !== JSON.stringify(fixed.landscape))
            throw new OperationsError("A área principal deve seguir a configuração do molde.");
        }
        const file = services().bucket.file(base.path,base.generation?{generation:base.generation}:undefined), [meta] = await file.getMetadata();
        if (meta.contentType !== 'application/pdf' || Number(meta.size) > STAFF_DOCUMENT_MAX_BYTES) throw new OperationsError('Base inválida.');
        const [bytes] = await file.download();
        const source = await PDFDocument.load(bytes,{updateMetadata:false});
        expectedPageCount = source.getPageCount();
        if (expectedPageCount < 1 || expectedPageCount > STAFF_PDF_MAX_PAGES) throw new OperationsError('Quantidade de páginas inválida.');
        t = {name:base.name,path:base.path};productId=base.productId || '';templateId=base.templateId || base.id;text=canonicalJob;
      } else {
        t = await template(productId, templateId);
        text = normalizeTextCustomization(
          customization,
          activePersonalizationFonts(config?.fontes_personalizacao),
        );
      }
      if (!text)
        throw new OperationsError(
          "Revise o texto, as fontes, as cores e as posições.",
        );
      const id = hash(`${user.uid}:${requestId}`).slice(0, 32),
        ref = services().db.collection("_staffDocuments").doc(id),
        who = await activityActor(services().db, user),
        at = new Date(now()).toISOString(),
        value = {
          ownerId: user.uid,
          ownerName: who.actorName,
          ownerRole: who.actorRole,
          productId,
          templateId,
          templateName: t.name,
          ...(canonicalJob?.outputName ? { outputName: canonicalJob.outputName } : {}),
          templatePath: t.path,
          customization: text,
          expectedPageCount,
          ...(canonicalJob ? {staffJob:true,layoutId:canonicalJob.layoutId} : {}),
          requestId,
          status: "uploading",
          createdAt: at,
          expiresAt: new Date(now() + 86400000).toISOString(),
          reference: `PDF-${id.slice(0, 10).toUpperCase()}`,
          shareEpoch: 0,
          ...(/^[a-f0-9]{32}$/.test(req.get("x-work-task") || "")
            ? { taskId: req.get("x-work-task") }
            : {}),
        };
      await services().db.runTransaction(async (tx) => {
        const old = (await tx.get(ref)).data();
        if (old) {
          if (
            old.ownerId !== user.uid ||
            old.productId !== productId ||
            old.templateId !== templateId ||
            JSON.stringify(old.customization) !== JSON.stringify(text)
          )
            throw new OperationsError(
              "Esta geração já foi usada para outro documento.",
              409,
            );
          return;
        }
        tx.create(ref, value);
      });
      const saved = (await ref.get()).data();
      const [uploadExists] = await services()
        .bucket.file(staffDocumentPath(user.uid, id, true))
        .exists();
      res.status(201).json({
        uploadExists,
        document: staffDocumentView(id, saved),
        path: staffDocumentPath(user.uid, id, true),
      });
    }),
  );
  admin.post(
    "/:id/finalize",
    action(async (req, res) => {
      const user = res.locals.user as WorkActor,
        { ref, data } = await access(req.params.id, user, false),
        id = req.params.id;
      if (data.status === "ready") {
        res.json({ document: staffDocumentView(id, data) });
        return;
      }
      const lease = randomUUID(),
        db = services().db;
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data();
        if (current?.status === "ready")
          throw new OperationsError(
            "O documento já foi finalizado. Atualize a lista.",
            409,
          );
        if (current?.leaseUntil > now())
          throw new OperationsError(
            "Esta geração ainda está sendo processada.",
            409,
          );
        tx.set(
          ref,
          { status: "processing", lease, leaseUntil: now() + 120000 },
          { merge: true },
        );
      });
      try {
        const raw = services().bucket.file(
            staffDocumentPath(data.ownerId, id, true),
          ),
          [meta] = await raw.getMetadata();
        if (
          meta.contentType !== "application/pdf" ||
          Number(meta.size) <= 0 ||
          Number(meta.size) > STAFF_DOCUMENT_MAX_BYTES ||
          meta.metadata?.ownerId !== data.ownerId ||
          meta.metadata?.documentId !== id ||
          !/^[1-9][0-9]*$/.test(String(meta.generation))
        )
          throw new OperationsError("Arquivo gerado inválido.");
        const source = services().bucket.file(raw.name, {
            generation: String(meta.generation),
          }),
          [bytes] = await source.download();
        const output = await sanitizeStaffPdf(
            bytes,
            data.templateName,
            data.createdAt,
            data.expectedPageCount || 2,
          ),
          digest = createHash("sha256").update(output).digest("hex"),
          file = services().bucket.file(staffDocumentPath(data.ownerId, id));
        try {
          await file.save(Buffer.from(output), {
            resumable: false,
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: {
              contentType: "application/pdf",
              cacheControl: "private,no-store",
              metadata: {
                ownerId: data.ownerId,
                documentId: id,
                sourceGeneration: String(meta.generation),
                sha256: digest,
              },
            },
          });
        } catch (error) {
          if (Number((error as any)?.code) !== 412) throw error;
          const [old] = await file.getMetadata();
          if (
            old.metadata?.sourceGeneration !== String(meta.generation) ||
            old.metadata?.documentId !== id
          )
            throw new OperationsError(
              "O arquivo final mudou. Gere outro documento.",
              409,
            );
        }
        const currentUser = await deps.authorize(req);
        if (
          !currentUser.admin &&
          !currentUser.permissions?.includes("documents.generate")
        )
          throw new OperationsError(
            "Sua permissão de geração foi revogada.",
            403,
          );
        const [stored] = await file.getMetadata(),
          at = new Date(now()).toISOString(),
          who = await activityActor(db, user),
          ready = {
            status: "ready",
            completedAt: at,
            expiresAt: new Date(now() + STAFF_DOCUMENT_TTL_MS).toISOString(),
            size: Number(stored.size),
            sha256: stored.metadata?.sha256 || digest,
            generation: String(stored.generation),
            leaseUntil: 0,
          };
        await db.runTransaction(async (tx) => {
          const current = (await tx.get(ref)).data();
          if (current?.lease !== lease || current.status !== "processing")
            throw new OperationsError(
              "A geração mudou. Atualize a lista.",
              409,
            );
          const audit = await prepareWorkActivity(
            db,
            who,
            "document.generated",
            id,
            tx,
            {
              taskId: data.taskId,
              reference: data.reference,
              now: now(),
              id: `document-${id}`,
            },
          );
          tx.set(ref, ready, { merge: true });
          audit.write(tx);
        });
        try {
          await source.delete({ ifGenerationMatch: String(meta.generation) });
        } catch {}
        res.json({ document: staffDocumentView(id, { ...data, ...ready }) });
      } catch (error) {
        await db
          .runTransaction(async (tx) => {
            const current = (await tx.get(ref)).data();
            if (current?.lease === lease && current.status === "processing")
              tx.set(
                ref,
                { status: "uploading", leaseUntil: 0 },
                { merge: true },
              );
          })
          .catch(() => undefined);
        throw error;
      }
    }),
  );
  admin.post(
    "/:id/cancel",
    action(async (req, res) => {
      const { ref, data } = await access(req.params.id, res.locals.user, false);
      if (data.status === "ready")
        throw new OperationsError("O documento já foi salvo.", 409);
      if (data.leaseUntil > now())
        throw new OperationsError("A geração está sendo processada.", 409);
      try {
        await services()
          .bucket.file(staffDocumentPath(data.ownerId, req.params.id, true))
          .delete();
      } catch (error) {
        if (Number((error as any)?.code) !== 404) throw error;
      }
      await ref.set(
        {
          status: "expired",
          expiresAt: new Date(now()).toISOString(),
          customization: FieldValue.delete(),
        },
        { merge: true },
      );
      res.json({ saved: true });
    }),
  );
  admin.get(
    "/:id/file",
    action(async (req, res) => {
      const user = res.locals.user as WorkActor,
        { data } = await access(req.params.id, user),
        mode =
          req.query.mode === "print"
            ? "print"
            : req.query.mode === "view"
              ? "view"
              : "download";
      const filename = `${data.outputName || data.reference}.pdf`;
      const [url] = await services()
        .bucket.file(staffDocumentPath(data.ownerId, req.params.id))
        .getSignedUrl({
          action: "read",
          expires: Math.min(now() + 300000, Date.parse(data.expiresAt)),
          responseDisposition: mode === "download"
            ? `attachment; filename="${data.reference}.pdf"; filename*=UTF-8''${encodeURIComponent(filename).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}`
            : "inline",
        });
      await recordStaffActivity(
        services().db,
        user,
        mode === "print"
          ? "document.printed"
          : mode === "view"
            ? "document.viewed"
            : "document.downloaded",
        req.params.id,
      );
      res.json({ url, filename });
    }),
  );
  admin.post(
    "/:id/share",
    action(async (req, res) => {
      deps.limit?.(`document-share:${res.locals.user.uid}`, 30, 60000);
      const url = await link(req.params.id, res.locals.user, req);
      await recordStaffActivity(
        services().db,
        res.locals.user,
        "document.shared",
        req.params.id,
      );
      res.json({ url });
    }),
  );
  admin.post(
    "/:id/revoke-sharing",
    action(async (req, res) => {
      const { ref } = await access(req.params.id, res.locals.user);
      await services().db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data();
        tx.set(
          ref,
          { shareEpoch: Number(current?.shareEpoch || 0) + 1 },
          { merge: true },
        );
      });
      res.json({ saved: true });
    }),
  );
  admin.post(
    "/:id/email",
    action(async (req, res) => {
      const user = res.locals.user as WorkActor,
        { data } = await access(req.params.id, user),
        to = emailAddress(req.body?.to),
        requestId = req.body?.requestId;
      if (
        !to ||
        typeof requestId !== "string" ||
        !/^[a-f0-9-]{36}$/.test(requestId)
      )
        throw new OperationsError("Informe um e-mail e uma tentativa válida.");
      deps.limit?.(`document-email:${user.uid}`, 5, 60000);
      const config = emailConfiguration();
      if (!config.configured) {
        res.status(503).json({
          error:
            "Configure o serviço de e-mail da loja para enviar documentos.",
          status: "not_configured",
        });
        return;
      }
      const key = hash(`${user.uid}:${requestId}`),
        jobRef = services().db.collection("_staffDocumentMails").doc(key),
        existing = (await jobRef.get()).data();
      if (
        existing &&
        (existing.ownerId !== user.uid ||
          existing.to !== to ||
          existing.documentId !== req.params.id)
      )
        throw new OperationsError(
          "A tentativa já foi usada para outro envio.",
          409,
        );
      if (!existing) {
        const url = await link(req.params.id, user, req);
        try {
          await jobRef.create({
            ownerId: user.uid,
            to,
            from: config.from,
            replyTo: config.replyTo,
            documentId: req.params.id,
            url,
            status: "pending",
            createdAt: new Date(now()).toISOString(),
            expiresAt: data.expiresAt,
            attempts: 0,
          });
        } catch (error) {
          if (Number((error as any)?.code) !== 6) throw error;
        }
      }
      const nonce = randomUUID();
      let job: any;
      await services().db.runTransaction(async (tx) => {
        job = (await tx.get(jobRef)).data();
        if (
          !job ||
          job.ownerId !== user.uid ||
          job.to !== to ||
          job.documentId !== req.params.id
        )
          throw new OperationsError(
            "A tentativa já foi usada para outro envio.",
            409,
          );
        if (job.status === "accepted") return;
        if (job.lockUntil > now())
          throw new OperationsError(
            "Este envio ainda está em processamento.",
            409,
          );
        if (
          job.attempts > 0 &&
          now() - Date.parse(job.createdAt) > 23 * 3600000
        ) {
          tx.set(jobRef, { status: "needs_review" }, { merge: true });
          job.status = "needs_review";
          return;
        }
        const emailContent = job.emailContent ?? {
          subject: `GB Gráfica · ${data.reference}`,
          ...resendEmailContent("staff-document", {
            text: `O PDF gerado pela GB Gráfica está disponível até ${new Date(data.expiresAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.\n\n${job.url}\n\n${data.size <= 8 * 1024 * 1024 ? "O documento também está anexado." : "Use o link para baixar o documento em qualidade integral."}`,
          }, !job.attempts),
        };
        tx.set(
          jobRef,
          {
            lockNonce: nonce,
            lockUntil: now() + 60000,
            attempts: Number(job.attempts || 0) + 1,
            emailContent,
          },
          { merge: true },
        );
        job = { ...job, emailContent };
      });
      if (["accepted", "needs_review"].includes(job.status)) {
        res.json({ status: job.status });
        return;
      }
      const [file] = [
        services().bucket.file(staffDocumentPath(data.ownerId, req.params.id)),
      ];
      let attachment: any[] = [];
      if (data.size <= 8 * 1024 * 1024) {
        const [bytes] = await file.download();
        attachment = [
          {
            filename: `${data.reference}.pdf`,
            content: Buffer.from(bytes).toString("base64"),
          },
        ];
      }
      let accepted = false;
      try {
        const response = await (deps.fetcher || fetch)(
          "https://api.resend.com/emails",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
              "Content-Type": "application/json",
              "Idempotency-Key": `staff-document-${key}`,
            },
            body: JSON.stringify({
              from: job.from,
              ...(job.replyTo ? { reply_to: job.replyTo } : {}),
              to: [to],
              ...job.emailContent,
              attachments: attachment,
            }),
            redirect: "error",
            signal: AbortSignal.timeout(10000),
          },
        );
        const result = await response.json().catch(() => ({}));
        accepted = response.ok && typeof result.id === "string";
      } catch {}
      const who = accepted ? await activityActor(services().db, user) : null;
      await services().db.runTransaction(async (tx) => {
        const current = (await tx.get(jobRef)).data();
        if (current?.lockNonce === nonce) {
          const audit =
            accepted && who
              ? await prepareWorkActivity(
                  services().db,
                  who,
                  "document.emailed",
                  req.params.id,
                  tx,
                  { id: `document-mail-${key}`, now: now() },
                )
              : null;
          tx.set(
            jobRef,
            {
              status: accepted ? "accepted" : "pending",
              lockUntil: 0,
              updatedAt: new Date(now()).toISOString(),
            },
            { merge: true },
          );
          audit?.write(tx);
        }
      });
      res
        .status(accepted ? 200 : 202)
        .json({ status: accepted ? "accepted" : "pending" });
    }),
  );
  shared.get(
    "/:id",
    action(async (req, res) => {
      const { id } = req.params,
        token = typeof req.query.token === "string" ? req.query.token : "";
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      if (!validDocumentId(id) || !/^[a-f0-9]{64}$/.test(token))
        throw new OperationsError("Link inválido.", 404);
      deps.limit?.(`shared-document:${req.ip}`, 60, 60000);
      const db = services().db,
        [record, share] = await Promise.all([
          db.collection("_staffDocuments").doc(id).get(),
          db
            .collection("_staffDocumentShares")
            .doc(`${id}-${hash(token)}`)
            .get(),
        ]),
        data = record.data(),
        grant = share.data();
      if (
        !data ||
        data.status !== "ready" ||
        !grant ||
        grant.documentId !== id ||
        grant.epoch !== Number(data.shareEpoch || 0) ||
        Date.parse(data.expiresAt) <= now() ||
        Date.parse(grant.expiresAt) <= now()
      )
        throw new OperationsError("Este link expirou ou foi revogado.", 410);
      const [url] = await services()
        .bucket.file(staffDocumentPath(data.ownerId, id))
        .getSignedUrl({
          action: "read",
          expires: Math.min(now() + 60000, Date.parse(data.expiresAt)),
          responseDisposition: "inline",
        });
      res.redirect(302, url);
    }),
  );
  const errors: express.ErrorRequestHandler = (error, _req, res, _next) => {
    const status =
      error instanceof OperationsError
        ? error.status
        : typeof error?.status === "number"
          ? error.status
          : 500;
    res.status(status).json({
      error:
        status < 500 ? error.message : "Não foi possível concluir o documento.",
    });
  };
  admin.use(errors);
  shared.use(errors);
  return { admin, shared };
}
