import { createHash, randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { getAdminServices } from "./firebaseAdmin.js";
import { OperationsError } from "../lib/operations.js";
import {
  CATALOG_RETENTION_MS,
  RETAINED_COLLECTIONS,
  isRetainedAssetPath,
  isRetainedSourcePath,
  retainedAssetPaths,
} from "../lib/catalogRetention.js";
type Services = ReturnType<typeof getAdminServices>;
type Data = Record<string, any>;
export const retentionId = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const controlRef = (db: Firestore) =>
  db.collection("_catalogCleanupControl").doc("main");
const assetRef = (db: Firestore, path: string) =>
  db.collection("_catalogAssetCleanup").doc(retentionId(path));
const sourceRef = (db: Firestore, path: string) =>
  db.collection("_catalogDocumentCleanup").doc(retentionId(path));
const sourceDoc = (db: Firestore, path: string) => {
  const [collection, id] = path.split("/");
  return db.collection(collection).doc(id);
};
const blocked = () => {
  throw new OperationsError(
    "Este arquivo ou cadastro está sendo limpo. Atualize a página e tente novamente.",
    409,
  );
};

/** All reads precede writes so the caller can commit retention and the business mutation together. */
export async function prepareCatalogRetention(
  db: Firestore,
  tx: Transaction,
  source: string,
  old: Data | undefined,
  next: Data | null,
  bucket: string,
  now = Date.now(),
) {
  if (!isRetainedSourcePath(source))
    throw new Error("Invalid retention source");
  const oldPaths = retainedAssetPaths(old, bucket),
    nextPaths = retainedAssetPaths(next, bucket);
  const [collection, id] = source.split("/");
  if (collection === "_staffPdfBases") {
    if (old?.status === "uploading")
      oldPaths.add(`staff-pdf-bases/${id}/upload.pdf`);
    if (next?.status === "uploading")
      nextPaths.add(`staff-pdf-bases/${id}/upload.pdf`);
  }
  const all = [...new Set([...oldPaths, ...nextPaths])];
  const [control, documentJob, ...jobs] = await Promise.all([
    tx.get(controlRef(db)),
    tx.get(sourceRef(db, source)),
    ...all.map((path) => tx.get(assetRef(db, path))),
  ]);
  if (documentJob.data()?.state === "purging") blocked();
  for (const job of jobs) if (job.data()?.state === "purging") blocked();
  const archive = old
    ? db.collection("_catalogTrash").doc(randomUUID().replaceAll("-", ""))
    : undefined;
  return () => {
    tx.set(controlRef(db), { revision: randomUUID() });
    if (archive)
      tx.create(archive, {
        source,
        data: old!,
        removedAt: now,
        cleanupAt: now + CATALOG_RETENTION_MS,
      });
    if (next) {
      if (documentJob.exists) tx.delete(sourceRef(db, source));
    } else if (old)
      tx.set(sourceRef(db, source), {
        source,
        removedAt: now,
        cleanupAt: now + CATALOG_RETENTION_MS,
        state: "pending",
      });
    all.forEach((path, i) => {
      const ref = assetRef(db, path);
      if (nextPaths.has(path)) {
        if (jobs[i].exists) tx.delete(ref);
      } else if (oldPaths.has(path))
        tx.set(ref, {
          path,
          removedAt: now,
          cleanupAt: now + CATALOG_RETENTION_MS,
          state: "pending",
        });
    });
  };
}

export async function scheduleCatalogAssetRemoval(
  db: Firestore,
  path: string,
  now = Date.now(),
) {
  if (!isRetainedAssetPath(path))
    throw new OperationsError("Caminho de arquivo inválido.");
  const ref = assetRef(db, path);
  await db.runTransaction(async (tx) => {
    const old = (await tx.get(ref)).data();
    // Duplicate browser cleanup requests do not extend the original deadline.
    if (!old)
      tx.create(ref, {
        path,
        removedAt: now,
        cleanupAt: now + CATALOG_RETENTION_MS,
        state: "pending",
      });
  });
}

export async function scheduleRetiredCatalogDocument(
  db: Firestore,
  source: string,
  field: "status" | "enabled",
  value: string | false,
  removedAt = Date.now(),
) {
  if (
    !isRetainedSourcePath(source) ||
    !(
      (source.startsWith("_staffPdfBases/") &&
        field === "status" &&
        ["deleted", "applied"].includes(String(value))) ||
      (source.startsWith("_staffPdfLayouts/") &&
        field === "enabled" &&
        value === false)
    )
  )
    throw new Error("Invalid retired document");
  const ref = sourceRef(db, source);
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(ref)).exists)
      tx.create(ref, {
        source,
        field,
        value,
        removedAt,
        cleanupAt: removedAt + CATALOG_RETENTION_MS,
        state: "pending",
      });
  });
}

async function liveReferences(
  services: Services,
  now: number,
  deadline: number,
) {
  const paths = new Set<string>(),
    bucket = services.bucket.name;
  for (const collection of [
    ...RETAINED_COLLECTIONS,
    "orders",
    "_staffDocuments",
  ]) {
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined,
      count = 0;
    for (;;) {
      if (Date.now() > deadline)
        throw new Error("Reference scan time budget reached");
      let query = services.db
        .collection(collection)
        .orderBy("__name__")
        .limit(200);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      count += page.size;
      if (count > 20000) throw new Error("Reference scan limit reached");
      for (const doc of page.docs) {
        const data = doc.data();
        if (
          collection === "_staffPdfBases" &&
          ["deleted", "applied"].includes(data.status)
        )
          continue;
        if (
          collection === "_staffDocuments" &&
          (data.status !== "ready" || Date.parse(data.expiresAt) <= now)
        )
          continue;
        retainedAssetPaths(data, bucket).forEach((path) => paths.add(path));
        if (collection === "_staffPdfBases" && data.status === "uploading")
          paths.add(`staff-pdf-bases/${doc.id}/upload.pdf`);
      }
      if (page.size < 200) break;
      cursor = page.docs.at(-1);
    }
  }
  return paths;
}

/** Deletes only due, unreferenced app-owned objects. Failed jobs keep their original seven-day deadline. */
export async function cleanupCatalog(
  services: Services,
  now = Date.now(),
  budgetMs = 25000,
) {
  const { db, bucket } = services,
    deadline = Date.now() + budgetMs;
  const result = {
    assetsDeleted: 0,
    documentsDeleted: 0,
    backupsDeleted: 0,
    sharedKept: 0,
    failed: 0,
    scanDeferred: false,
  };
  const revision = (await controlRef(db).get()).data()?.revision ?? null;
  let live: Set<string>;
  try {
    live = await liveReferences(services, now, deadline);
  } catch {
    return { ...result, scanDeferred: true };
  }
  const due = await db
    .collection("_catalogAssetCleanup")
    .where("cleanupAt", "<=", now)
    .orderBy("cleanupAt")
    .limit(500)
    .get();
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (Date.now() < deadline) {
        const candidate = due.docs[next++];
        if (!candidate) return;
        const claim = randomUUID();
        try {
          const path = await db.runTransaction(async (tx) => {
            const [job, control] = await Promise.all([
              tx.get(candidate.ref),
              tx.get(controlRef(db)),
            ]);
            const data = job.data();
            if (
              !data ||
              data.cleanupAt > now ||
              data.leaseUntil > Date.now() ||
              (control.data()?.revision ?? null) !== revision
            )
              return null;
            if (
              !isRetainedAssetPath(data.path) ||
              retentionId(data.path) !== candidate.id
            )
              throw new Error("Invalid asset cleanup job");
            if (live.has(data.path)) {
              tx.delete(candidate.ref);
              result.sharedKept++;
              return null;
            }
            tx.update(candidate.ref, {
              state: "purging",
              claim,
              leaseUntil: Date.now() + 60000,
            });
            return data.path as string;
          });
          if (!path) continue;
          try {
            const file = bucket.file(path),
              [meta] = await file.getMetadata();
            if (!/^[1-9][0-9]*$/.test(String(meta.generation)))
              throw new Error("Invalid object generation");
            await file.delete({ ifGenerationMatch: String(meta.generation) });
          } catch (error) {
            if (Number((error as any)?.code) !== 404) throw error;
          }
          await db.runTransaction(async (tx) => {
            const current = (await tx.get(candidate.ref)).data();
            if (current?.claim === claim) tx.delete(candidate.ref);
          });
          result.assetsDeleted++;
        } catch {
          result.failed++;
          await db
            .runTransaction(async (tx) => {
              const current = (await tx.get(candidate.ref)).data();
              if (current?.claim === claim)
                tx.update(candidate.ref, { leaseUntil: 0 });
            })
            .catch(() => {});
        }
      }
    }),
  );
  const documents = await db
    .collection("_catalogDocumentCleanup")
    .where("cleanupAt", "<=", now)
    .orderBy("cleanupAt")
    .limit(25)
    .get();
  for (const row of documents.docs) {
    if (Date.now() >= deadline) break;
    const claim = randomUUID();
    try {
      const source = await db.runTransaction(async (tx) => {
        const job = (await tx.get(row.ref)).data();
        if (!job || job.cleanupAt > now || job.leaseUntil > Date.now())
          return null;
        if (
          !isRetainedSourcePath(job.source) ||
          retentionId(job.source) !== row.id
        )
          throw new Error("Invalid document cleanup job");
        const current = await tx.get(sourceDoc(db, job.source));
        const expectedRetired =
          (job.source.startsWith("_staffPdfBases/") &&
            job.field === "status" &&
            ["deleted", "applied"].includes(job.value)) ||
          (job.source.startsWith("_staffPdfLayouts/") &&
            job.field === "enabled" &&
            job.value === false);
        if (
          current.exists &&
          !(expectedRetired && current.data()?.[job.field] === job.value)
        ) {
          tx.delete(row.ref);
          return null;
        }
        tx.update(row.ref, {
          state: "purging",
          claim,
          leaseUntil: Date.now() + 60000,
        });
        return job.source as string;
      });
      if (!source) continue;
      await db.recursiveDelete(sourceDoc(db, source));
      if (source.startsWith("anuncios/")) {
        const id = source.split("/")[1];
        await db.collection("productRatings").doc(id).delete();
        for (;;) {
          if (Date.now() >= deadline)
            throw new Error("Review cleanup time budget reached");
          const owners = await db
            .collection("_reviewOwners")
            .where("productId", "==", id)
            .limit(100)
            .get();
          await Promise.all(owners.docs.map((doc) => doc.ref.delete()));
          if (owners.size < 100) break;
        }
      }
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(row.ref)).data();
        if (current?.claim === claim) tx.delete(row.ref);
      });
      result.documentsDeleted++;
    } catch {
      result.failed++;
    }
  }
  const backups = await db
    .collection("_catalogTrash")
    .where("cleanupAt", "<=", now)
    .orderBy("cleanupAt")
    .limit(100)
    .get();
  for (const backup of backups.docs) {
    if (Date.now() >= deadline) break;
    try {
      await backup.ref.delete();
      result.backupsDeleted++;
    } catch {
      result.failed++;
    }
  }
  if (Date.now() < deadline && typeof bucket.getFiles === "function") {
    try {
      await inventoryOrphans(services, live, now, deadline);
    } catch {
      result.failed++;
    }
  }
  return result;
}

/** Existing orphans get seven days from first observation, never from the object's creation date. */
async function inventoryOrphans(
  services: Services,
  live: Set<string>,
  now: number,
  deadline: number,
) {
  const ref = services.db.collection("_catalogCleanupControl").doc("inventory");
  const old = (await ref.get()).data() || {};
  const prefixes = ["catalog/", "staff-pdf-bases/"];
  const index = old.prefixIndex === 1 ? 1 : 0,
    prefix = prefixes[index];
  const lastName =
    typeof old.lastName === "string" && old.lastName.startsWith(prefix)
      ? old.lastName
      : "";
  const [files] = await services.bucket.getFiles({
    prefix,
    startOffset: lastName || prefix,
    maxResults: 100,
    autoPaginate: false,
  });
  let processed = lastName,
    completed = true;
  for (const file of files) {
    if (file.name <= lastName) continue;
    if (Date.now() >= deadline) {
      completed = false;
      break;
    }
    if (isRetainedAssetPath(file.name) && !live.has(file.name))
      await scheduleCatalogAssetRemoval(services.db, file.name, now);
    processed = file.name;
  }
  await ref.set(
    completed && files.length < 100
      ? { prefixIndex: (index + 1) % 2, lastName: "" }
      : { prefixIndex: index, lastName: processed },
  );
  for (const collection of ["_staffPdfBases", "_staffPdfLayouts"]) {
    if (Date.now() >= deadline) break;
    const rows =
      collection === "_staffPdfLayouts"
        ? await services.db
            .collection(collection)
            .where("enabled", "==", false)
            .limit(50)
            .get()
        : await services.db
            .collection(collection)
            .where("status", "in", ["deleted", "applied"])
            .limit(50)
            .get();
    for (const row of rows.docs) {
      if (Date.now() >= deadline) break;
      const data = row.data(),
        removed = Date.parse(data.deletedAt || "");
      await scheduleRetiredCatalogDocument(
        services.db,
        `${collection}/${row.id}`,
        collection === "_staffPdfLayouts" ? "enabled" : "status",
        collection === "_staffPdfLayouts" ? false : data.status,
        Number.isFinite(removed) && removed <= now ? removed : now,
      );
    }
  }
}
