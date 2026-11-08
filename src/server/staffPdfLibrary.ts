import {
  prepareCatalogRetention,
  scheduleCatalogAssetRemoval,
  scheduleRetiredCatalogDocument,
} from "./catalogRetention.js";
import express from "express";
import {
  normalizePdfCategory,
  pdfBaseIdentity,
  UNCATEGORIZED_PDFS,
} from "../lib/staffPdfCategory.js";
import { createStaffPdfBatchRouter } from "./staffPdfBatches.js";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument, degrees } from "pdf-lib";
import type { StaffDocumentDeps } from "./staffDocuments.js";
import type { WorkActor } from "./workRouter.js";
import { OperationsError } from "../lib/operations.js";
import {
  STAFF_DOCUMENT_MAX_BYTES,
  validDocumentId,
} from "../lib/staffDocument.js";
import {
  STAFF_PDF_LAYOUT_PERMISSION,
  STAFF_PDF_MAX_PAGES,
  normalizePdfLayout,
  parsePdfLayoutMap,
  staffPdfName,
  staffPdfStoragePath,
  type StaffPdfBase,
} from "../lib/staffPdf.js";
import { isTemplatePath } from "../lib/pdfTemplate.js";
import {
  firstInitial,
  matchingAlphabetName,
} from "../lib/decorativeInitial.js";

export const pdfLibraryId = (name: string) =>
  createHash("sha256").update(name).digest("hex").slice(0, 32);
const revision = () => randomUUID().replaceAll("-", "");
const input = <T>(parse: () => T): T => {
  try {
    return parse();
  } catch (e) {
    throw new OperationsError((e as Error).message);
  }
};
export function catalogPdfBase(productId: string, t: any): StaffPdfBase {
  return {
    id: `catalog_${productId}_${t.id}`,
    name: t.name,
    pageCount: t.pages.length,
    pages: [],
    source: "catalog",
    category: "Produtos",
    productId,
    templateId: t.id,
    revision: pdfLibraryId(
      JSON.stringify([t.path, t.name, t.pages, t.alphabet || null]),
    ),
  };
}
export async function resolveStaffPdfBase(
  services: ReturnType<StaffDocumentDeps["services"]>,
  id: unknown,
): Promise<
  StaffPdfBase & { path: string; generation?: string; alphabet?: any }
> {
  if (typeof id !== "string") throw new OperationsError("Base inválida.");
  const catalog = /^catalog_([A-Za-z0-9_-]{1,100})_([a-f0-9]{32})$/.exec(id);
  if (catalog) {
    const p = (
        await services.db.collection("anuncios").doc(catalog[1]).get()
      ).data(),
      t = p?.modelosPdf?.find((t: any) => t.id === catalog[2]);
    if (!t || !isTemplatePath(t.path, catalog[1]))
      throw new OperationsError("Base não encontrada.", 404);
    return {
      ...catalogPdfBase(catalog[1], t),
      path: t.path,
      alphabet: t.alphabet,
    };
  }
  if (!validDocumentId(id)) throw new OperationsError("Base inválida.");
  const value = (
    await services.db.collection("_staffPdfBases").doc(id).get()
  ).data();
  if (
    !value ||
    value.status !== "ready" ||
    (value.path !== staffPdfStoragePath(id) &&
      !(
        typeof value.path === "string" &&
        new RegExp(`^staff-pdf-bases/${id}/versions/[a-f0-9]{32}[.]pdf$`).test(
          value.path,
        )
      ))
  )
    throw new OperationsError("Base não encontrada.", 404);
  return { ...value, id, source: "internal" as const } as StaffPdfBase & {
    path: string;
    generation?: string;
    alphabet?: any;
  };
}
/** Only static page streams survive. Normalize CropBox and Rotate without rasterizing the PDF. */
export async function sanitizeStaffPdfBase(bytes: Uint8Array) {
  if (
    bytes.length > STAFF_DOCUMENT_MAX_BYTES ||
    Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-"
  )
    throw new OperationsError("Envie um PDF válido de até 50 MB.");
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new OperationsError(
      "O PDF não pôde ser aberto. Confira se está protegido por senha.",
    );
  }
  if (source.getPageCount() < 1 || source.getPageCount() > STAFF_PDF_MAX_PAGES)
    throw new OperationsError(
      `Use um PDF de 1 a ${STAFF_PDF_MAX_PAGES} páginas.`,
    );
  const result = await PDFDocument.create(),
    pages: Array<{ width: number; height: number }> = [];
  for (const p of source.getPages()) {
    const crop = p.getCropBox(),
      angle = ((p.getRotation().angle % 360) + 360) % 360;
    if (
      ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
      crop.width < 1 ||
      crop.height < 1 ||
      Math.max(crop.width, crop.height) > 14400 ||
      ![0, 90, 180, 270].includes(angle)
    )
      throw new OperationsError("Dimensões ou rotação do PDF inválidas.");
    const rotated = angle === 90 || angle === 270,
      width = rotated ? crop.height : crop.width,
      height = rotated ? crop.width : crop.height;
    const sheet = result.addPage([width, height]);
    if (p.node.Contents()) {
      const embedded = await result.embedPage(p, {
        left: crop.x,
        bottom: crop.y,
        right: crop.x + crop.width,
        top: crop.y + crop.height,
      });
      sheet.drawPage(embedded, {
        x: angle === 180 || angle === 270 ? width : 0,
        y: angle === 90 || angle === 180 ? height : 0,
        width: crop.width,
        height: crop.height,
        rotate: degrees(-angle),
      });
    }
    pages.push({ width, height });
  }
  const output = Buffer.from(await result.save());
  if (output.length > STAFF_DOCUMENT_MAX_BYTES)
    throw new OperationsError("O PDF final excede 50 MB.");
  return { output, pages };
}
export function createStaffPdfLibraryRouter(deps: StaffDocumentDeps) {
  const router = express.Router(),
    now = () => deps.now?.() ?? Date.now(),
    services = deps.services;
  router.use((req, res, next) => {
    void deps
      .authorize(req)
      .then((actor) => {
        if (
          !actor.admin &&
          !actor.permissions?.some((p) =>
            ["documents.generate", STAFF_PDF_LAYOUT_PERMISSION].includes(p),
          )
        )
          throw new OperationsError(
            "Sua função não permite acessar PDFs internos.",
            403,
          );
        res.locals.user = actor;
        res.setHeader("Cache-Control", "private,no-store");
        deps.limit?.(`pdf-library:${actor.uid}`, 90, 60000);
        next();
      })
      .catch(next);
  });
  const action =
    (
      fn: (req: express.Request, res: express.Response) => Promise<void>,
    ): express.RequestHandler =>
    (req, res, next) => {
      void fn(req, res).catch(next);
    };
  const manage = (res: express.Response) => {
    const actor = res.locals.user as WorkActor;
    if (
      !actor.admin &&
      !actor.permissions?.includes(STAFF_PDF_LAYOUT_PERMISSION)
    )
      throw new OperationsError(
        "Sua função não permite gerenciar bases e moldes.",
        403,
      );
    return actor;
  };
  router.use("/batches", createStaffPdfBatchRouter(deps));
  router.get(
    "/",
    action(async (_req, res) => {
      const [bases, layouts, products] = await Promise.all([
        services()
          .db.collection("_staffPdfBases")
          .where("status", "==", "ready")
          .limit(501)
          .get(),
        services()
          .db.collection("_staffPdfLayouts")
          .where("enabled", "==", true)
          .limit(1001)
          .get(),
        services().db.collection("anuncios").limit(501).get(),
      ]);
      const internal = bases.docs.slice(0, 500).map((d) => {
        const b = d.data();
        return {
          id: d.id,
          name: b.name,
          category: b.category || UNCATEGORIZED_PDFS,
          pageCount: b.pageCount,
          pages: b.pages,
          revision: b.revision,
          source: "internal",
        };
      });
      const catalog = products.docs
        .slice(0, 500)
        .flatMap((d) =>
          (d.data().modelosPdf || [])
            .filter((t: any) => isTemplatePath(t.path, d.id))
            .map((t: any) => catalogPdfBase(d.id, t)),
        );
      const actor = res.locals.user as WorkActor,
        pending =
          actor.admin ||
          actor.permissions?.includes(STAFF_PDF_LAYOUT_PERMISSION)
            ? await services()
                .db.collection("_staffPdfBases")
                .where("status", "==", "uploading")
                .limit(100)
                .get()
            : undefined;
      res.json({
        bases: [...internal, ...catalog],
        pendingUploads:
          pending?.docs.map((d) => ({ id: d.id, name: d.data().name })) || [],
        layouts: layouts.docs.slice(0, 1000).map((d) => ({
          id: d.id,
          name: d.data().name,
          revision: d.data().revision,
          layout: d.data().layout,
        })),
        truncated:
          bases.size > 500 || layouts.size > 1000 || products.size > 500,
      });
    }),
  );
  router.get(
    "/bases/:id/file",
    action(async (req, res) => {
      const base = await resolveStaffPdfBase(services(), req.params.id),
        file = services().bucket.file(
          base.path,
          base.generation ? { generation: base.generation } : undefined,
        ),
        [meta] = await file.getMetadata();
      if (
        meta.contentType !== "application/pdf" ||
        Number(meta.size) > STAFF_DOCUMENT_MAX_BYTES
      )
        throw new OperationsError("Base PDF inválida.");
      const [url] = await file.getSignedUrl({
        action: "read",
        expires: now() + 300000,
        responseDisposition: "inline",
      });
      res.json({ url, base: { id: base.id, revision: base.revision } });
    }),
  );
  router.post(
    "/bases",
    action(async (req, res) => {
      const actor = manage(res),
        name = input(() => staffPdfName(req.body?.name)),
        category = input(() =>
          normalizePdfCategory(req.body?.category ?? UNCATEGORIZED_PDFS),
        );
      if (!/\.pdf$/i.test(name))
        throw new OperationsError("O nome da base deve terminar em .pdf.");
      const requestId = req.body?.requestId;
      if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/.test(requestId))
        throw new OperationsError("Envio inválido.");
      const id = pdfLibraryId(`${actor.uid}:${requestId}`),
        ref = services().db.collection("_staffPdfBases").doc(id),
        replacement = req.body?.replacement,
        nameRef = services()
          .db.collection("_staffPdfBaseNames")
          .doc(pdfLibraryId(pdfBaseIdentity(name, category)));
      if (
        replacement !== undefined &&
        (!validDocumentId(replacement?.id) ||
          !validDocumentId(replacement?.revision))
      )
        throw new OperationsError("Substituição inválida.");
      await services().db.runTransaction(async (tx) => {
        const old = (await tx.get(ref)).data(),
          named = (await tx.get(nameRef)).data();
        if (old) {
          if (
            old.name !== name ||
            (old.category || UNCATEGORIZED_PDFS) !== category ||
            old.ownerId !== actor.uid ||
            old.status === "deleted" ||
            old.replaceId !== replacement?.id ||
            old.replaceRevision !== replacement?.revision
          )
            throw new OperationsError("Este envio já foi utilizado.", 409);
          return;
        }
        if (replacement) {
          const target = (
            await tx.get(
              services().db.collection("_staffPdfBases").doc(replacement.id),
            )
          ).data();
          if (
            named?.baseId !== replacement.id ||
            target?.status !== "ready" ||
            target.name !== name ||
            (target.category || UNCATEGORIZED_PDFS) !== category ||
            target.revision !== replacement.revision
          )
            throw new OperationsError(
              "A base mudou. Atualize a biblioteca antes de substituir.",
              409,
            );
        } else if (named?.baseId && named.baseId !== id)
          throw new OperationsError(
            "Já existe uma base com este nome. Atualize a biblioteca para confirmar a substituição ou renomeie o arquivo.",
            409,
          );
        const retain = await prepareCatalogRetention(
          services().db,
          tx,
          ref.path,
          undefined,
          { name, category, status: "uploading" },
          services().bucket.name,
          now(),
        );
        retain();
        tx.create(ref, {
          name,
          category,
          status: "uploading",
          ownerId: actor.uid,
          createdAt: new Date(now()).toISOString(),
          revision: revision(),
          ...(replacement
            ? {
                replaceId: replacement.id,
                replaceRevision: replacement.revision,
              }
            : {}),
        });
        if (!replacement) tx.set(nameRef, { baseId: id });
      });
      const data = (await ref.get()).data();
      res.status(201).json({
        id,
        path: `staff-pdf-bases/${id}/upload.pdf`,
        ready: data?.status === "ready" || data?.status === "applied",
      });
    }),
  );
  router.get(
    "/bases/:id/initial",
    action(async (req, res) => {
      const base = await resolveStaffPdfBase(services(), req.params.id),
        letter = firstInitial(String(req.query.letter || "")),
        alphabet = base.alphabet;
      if (
        !letter ||
        !alphabet ||
        !matchingAlphabetName(base.name, alphabet.folderName) ||
        !Object.hasOwn(alphabet.letters || {}, letter)
      ) {
        res.json({ url: null });
        return;
      }
      const path = alphabet.letters[letter]?.path;
      const valid =
        base.source === "internal"
          ? typeof path === "string" &&
            new RegExp(
              `^staff-pdf-bases/${base.id}/letters/[a-f0-9]{32}\\.png$`,
            ).test(path)
          : typeof path === "string" &&
            new RegExp(
              `^catalog/products/${base.productId}/[a-f0-9]{32}\\.png$`,
            ).test(path);
      if (!valid) throw new OperationsError("Inicial inválida.");
      const file = services().bucket.file(path),
        [url] = await file.getSignedUrl({
          action: "read",
          expires: now() + 300000,
        });
      res.json({ url, sizePercent: alphabet.sizePercent || 60 });
    }),
  );
  router.post(
    "/bases/:id/alphabet",
    action(async (req, res) => {
      const actor = manage(res),
        base = await resolveStaffPdfBase(services(), req.params.id),
        { folderName, letters, sizePercent = 60 } = req.body || {};
      if (
        base.source !== "internal" ||
        typeof folderName !== "string" ||
        !matchingAlphabetName(base.name, folderName) ||
        !letters ||
        typeof letters !== "object" ||
        Array.isArray(letters) ||
        Object.keys(letters).length < 1 ||
        Object.keys(letters).length > 26 ||
        typeof sizePercent !== "number" ||
        !Number.isFinite(sizePercent) ||
        sizePercent < 5 ||
        sizePercent > 100
      )
        throw new OperationsError(
          "Use uma pasta com o mesmo nome do PDF e letras A.png até Z.png.",
        );
      const canonical: Record<string, { path: string }> = {};
      for (const [letter, entry] of Object.entries(letters)) {
        const path = (entry as any)?.path;
        if (
          !/^[A-Z]$/.test(letter) ||
          typeof path !== "string" ||
          !new RegExp(
            `^staff-pdf-bases/${base.id}/letters/[a-f0-9]{32}\\.png$`,
          ).test(path)
        )
          throw new OperationsError("Caminho da inicial inválido.");
        const file = services().bucket.file(path),
          [meta] = await file.getMetadata();
        if (
          meta.contentType !== "image/png" ||
          Number(meta.size) > STAFF_DOCUMENT_MAX_BYTES ||
          meta.metadata?.uploadedBy !== actor.uid ||
          !/^[1-9][0-9]*$/.test(String(meta.generation))
        )
          throw new OperationsError("Inicial não autorizada.");
        const [head] = await services()
          .bucket.file(path, { generation: String(meta.generation) })
          .download({ start: 0, end: 32 });
        if (
          head.length < 26 ||
          !head
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
          head.readUInt32BE(12) !== 0x49484452 ||
          head.readUInt32BE(16) * head.readUInt32BE(20) > 64000000 ||
          !head.readUInt32BE(16) ||
          !head.readUInt32BE(20) ||
          Math.max(head.readUInt32BE(16), head.readUInt32BE(20)) > 16384
        )
          throw new OperationsError("PNG da inicial inválido.");
        canonical[letter] = { path };
      }
      const ref = services().db.collection("_staffPdfBases").doc(base.id);
      await services().db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data();
        if (current?.status !== "ready" || current.revision !== base.revision)
          throw new OperationsError("A base mudou. Atualize a lista.", 409);
        const retain = await prepareCatalogRetention(
          services().db,
          tx,
          ref.path,
          current,
          {
            ...current,
            alphabet: { folderName, letters: canonical, sizePercent },
          },
          services().bucket.name,
          now(),
        );
        retain();
        tx.set(
          ref,
          {
            alphabet: { folderName, letters: canonical, sizePercent },
            revision: revision(),
          },
          { merge: true },
        );
      });
      res.json({ saved: true });
    }),
  );
  router.post(
    "/bases/:id/alphabet-upload/delete",
    action(async (req, res) => {
      const actor = manage(res),
        base = await resolveStaffPdfBase(services(), req.params.id),
        path = req.body?.path;
      if (
        base.source !== "internal" ||
        typeof path !== "string" ||
        !new RegExp(
          `^staff-pdf-bases/${base.id}/letters/[a-f0-9]{32}\\.png$`,
        ).test(path) ||
        Object.values(base.alphabet?.letters || {}).some(
          (e: any) => e.path === path,
        )
      )
        throw new OperationsError("Arquivo temporário inválido.");
      const file = services().bucket.file(path);
      try {
        const [meta] = await file.getMetadata();
        if (meta.metadata?.uploadedBy !== actor.uid)
          throw new OperationsError("Arquivo não autorizado.", 403);
        await scheduleCatalogAssetRemoval(services().db, path, now());
      } catch (e) {
        if (Number((e as any)?.code) !== 404) throw e;
      }
      res.json({ deleted: true });
    }),
  );
  router.post(
    "/bases/:id/finalize",
    action(async (req, res) => {
      const actor = manage(res),
        id = req.params.id;
      if (!validDocumentId(id)) throw new OperationsError("Base inválida.");
      const ref = services().db.collection("_staffPdfBases").doc(id),
        old = (await ref.get()).data();
      if (
        !old ||
        (!actor.admin && old.ownerId !== actor.uid) ||
        old.status === "deleted"
      )
        throw new OperationsError("Envio não encontrado.", 404);
      if (old.status === "ready" || old.status === "applied") {
        res.json({ id: old.replaceId || id });
        return;
      }
      const file = services().bucket.file(`staff-pdf-bases/${id}/upload.pdf`),
        [meta] = await file.getMetadata();
      if (
        meta.contentType !== "application/pdf" ||
        Number(meta.size) > STAFF_DOCUMENT_MAX_BYTES ||
        meta.metadata?.uploadedBy !== old.ownerId ||
        !/^\d+$/.test(String(meta.generation))
      )
        throw new OperationsError("Upload da base inválido.");
      const [bytes] = await services()
          .bucket.file(file.name, { generation: String(meta.generation) })
          .download(),
        { output, pages } = await sanitizeStaffPdfBase(bytes);
      // Permissions are checked again after potentially expensive PDF processing.
      const current = await deps.authorize(req);
      if (
        !current.admin &&
        !current.permissions?.includes(STAFF_PDF_LAYOUT_PERMISSION)
      )
        throw new OperationsError("Permissão revogada.", 403);
      const targetId = old.replaceId || id;
      const targetRef = services()
        .db.collection("_staffPdfBases")
        .doc(targetId);
      const path = staffPdfStoragePath(
        targetId,
        old.replaceId ? id : undefined,
      );
      const dest = services().bucket.file(path);
      try {
        await dest.save(output, {
          resumable: false,
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            contentType: "application/pdf",
            cacheControl: "private,no-store",
            metadata: { baseId: id, sourceGeneration: String(meta.generation) },
          },
        });
      } catch (e) {
        if (Number((e as any)?.code) !== 412) throw e;
        const [existing] = await dest.getMetadata();
        if (existing.metadata?.sourceGeneration !== String(meta.generation))
          throw new OperationsError("O envio mudou. Envie uma nova base.", 409);
      }
      const [stored] = await dest.getMetadata();
      const previous = await services()
        .db.runTransaction(async (tx) => {
          const value = (await tx.get(ref)).data();
          if (value?.status === "applied" || value?.status === "ready")
            return undefined;
          if (value?.status !== "uploading")
            throw new OperationsError("Base excluída durante o envio.", 409);
          const target = old.replaceId
            ? (await tx.get(targetRef)).data()
            : undefined;
          if (
            old.replaceId &&
            (target?.status !== "ready" ||
              target.revision !== old.replaceRevision)
          )
            throw new OperationsError(
              "A base mudou durante o envio. Atualize e tente novamente.",
              409,
            );
          const nextBase = {
            ...(target || value),
            status: "ready",
            path,
            generation: String(stored.generation),
            pages,
            pageCount: pages.length,
          };
          const retain = await prepareCatalogRetention(
            services().db,
            tx,
            targetRef.path,
            target || value,
            nextBase,
            services().bucket.name,
            now(),
          );
          retain();
          tx.set(
            targetRef,
            {
              status: "ready",
              path,
              generation: String(stored.generation),
              pages,
              pageCount: pages.length,
              updatedAt: new Date(now()).toISOString(),
              ...(old.replaceId ? { revision: revision() } : {}),
            },
            { merge: true },
          );
          if (old.replaceId)
            tx.set(ref, { status: "applied" }, { merge: true });
          return target && { path: target.path, generation: target.generation };
        })
        .catch(async (error) => {
          await scheduleCatalogAssetRemoval(services().db, path, now()).catch(
            () => undefined,
          );
          throw error;
        });
      await scheduleCatalogAssetRemoval(
        services().db,
        `staff-pdf-bases/${id}/upload.pdf`,
        now(),
      );
      if (old.replaceId)
        await scheduleRetiredCatalogDocument(
          services().db,
          ref.path,
          "status",
          "applied",
          now(),
        );
      if (previous?.path)
        await scheduleCatalogAssetRemoval(services().db, previous.path, now());
      res.json({ id: targetId });
    }),
  );
  router.post(
    "/bases/:id/delete",
    action(async (req, res) => {
      manage(res);
      const id = req.params.id;
      if (!validDocumentId(id)) throw new OperationsError("Base inválida.");
      const ref = services().db.collection("_staffPdfBases").doc(id);
      let letterPaths: string[] = [];
      let currentPath: string | undefined;
      let replacementPath: string | undefined;
      let completedReplacement = false;
      await services().db.runTransaction(async (tx) => {
        const value = (await tx.get(ref)).data();
        if (!value) throw new OperationsError("Base não encontrada.", 404);
        completedReplacement = value.status === "applied";
        if (completedReplacement) return;
        currentPath = value.path;
        replacementPath = value.replaceId
          ? staffPdfStoragePath(value.replaceId, id)
          : undefined;
        letterPaths = Object.values(value.alphabet?.letters || {})
          .map((e: any) => e?.path)
          .filter(
            (path) =>
              typeof path === "string" &&
              new RegExp(
                `^staff-pdf-bases/${id}/letters/[a-f0-9]{32}\\.png$`,
              ).test(path),
          );
        const nameRef = services()
            .db.collection("_staffPdfBaseNames")
            .doc(
              pdfLibraryId(
                pdfBaseIdentity(
                  value.name,
                  value.category || UNCATEGORIZED_PDFS,
                ),
              ),
            ),
          named = (await tx.get(nameRef)).data();
        const retain = await prepareCatalogRetention(
          services().db,
          tx,
          ref.path,
          value,
          null,
          services().bucket.name,
          now(),
        );
        retain();
        tx.delete(ref);
        if (named?.baseId === id) tx.delete(nameRef);
      });
      if (completedReplacement) {
        res.json({ deleted: false });
        return;
      }
      for (const path of new Set([
        currentPath ?? staffPdfStoragePath(id),
        `staff-pdf-bases/${id}/upload.pdf`,
        ...(replacementPath ? [replacementPath] : []),
        ...letterPaths,
      ]))
        await scheduleCatalogAssetRemoval(services().db, path, now());
      res.json({ deleted: true });
    }),
  );
  router.post(
    "/layouts",
    action(async (req, res) => {
      const actor = manage(res),
        name = input(() => staffPdfName(req.body?.name)),
        layout = input(() => normalizePdfLayout(req.body?.layout)),
        id = pdfLibraryId(name),
        ref = services().db.collection("_staffPdfLayouts").doc(id);
      await services().db.runTransaction(async (tx) => {
        const old = (await tx.get(ref)).data();
        if (old?.enabled && old.revision !== req.body?.revision)
          throw new OperationsError(
            "O molde foi alterado. Atualize antes de salvar.",
            409,
          );
        const retain = await prepareCatalogRetention(
          services().db,
          tx,
          ref.path,
          old,
          { name, layout, enabled: true },
          services().bucket.name,
          now(),
        );
        retain();
        tx.set(ref, {
          name,
          layout,
          enabled: true,
          revision: revision(),
          updatedAt: new Date(now()).toISOString(),
          updatedBy: actor.uid,
        });
      });
      res.json({ id });
    }),
  );
  router.post(
    "/layouts/import",
    action(async (req, res) => {
      const actor = manage(res),
        rows = input(() => parsePdfLayoutMap(req.body?.templates)),
        ids = rows.map((t) => pdfLibraryId(t.name));
      // A single transaction provides all-or-nothing imports. Existing molds are preserved by default.
      if (rows.length > 400)
        throw new OperationsError("Importe até 400 moldes por vez.");
      let created = 0,
        skipped = 0;
      await services().db.runTransaction(async (tx) => {
        const refs = ids.map((id) =>
            services().db.collection("_staffPdfLayouts").doc(id),
          ),
          old = await Promise.all(refs.map((ref) => tx.get(ref)));
        created = 0;
        skipped = 0;
        const retention = await Promise.all(
          rows.map((row, i) =>
            old[i].data()?.enabled
              ? undefined
              : prepareCatalogRetention(
                  services().db,
                  tx,
                  refs[i].path,
                  old[i].data(),
                  { ...row, enabled: true },
                  services().bucket.name,
                  now(),
                ),
          ),
        );
        rows.forEach((row, i) => {
          if (old[i].data()?.enabled) {
            skipped++;
            return;
          }
          created++;
          retention[i]?.();
          tx.set(refs[i], {
            ...row,
            enabled: true,
            revision: revision(),
            updatedAt: new Date(now()).toISOString(),
            updatedBy: actor.uid,
          });
        });
      });
      res.json({ created, skipped });
    }),
  );
  router.post(
    "/layouts/:id/delete",
    action(async (req, res) => {
      manage(res);
      if (!validDocumentId(req.params.id))
        throw new OperationsError("Molde inválido.");
      const ref = services()
        .db.collection("_staffPdfLayouts")
        .doc(req.params.id);
      await services().db.runTransaction(async (tx) => {
        const old = (await tx.get(ref)).data();
        if (!old) throw new OperationsError("Molde não encontrado.", 404);
        if (old.revision !== req.body?.revision)
          throw new OperationsError("O molde mudou. Atualize a lista.", 409);
        const retain = await prepareCatalogRetention(
          services().db,
          tx,
          ref.path,
          old,
          null,
          services().bucket.name,
          now(),
        );
        retain();
        tx.delete(ref);
      });
      res.json({ deleted: true });
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
        status < 500
          ? error.message
          : "Não foi possível concluir a operação com os PDFs internos.",
    });
  };
  router.use(errors);
  return router;
}
