import { PDFDocument } from "pdf-lib";
import type { Firestore } from "firebase-admin/firestore";
import type { LabelBucket } from "./staffLabelArchive.js";
import { OperationsError } from "../lib/operations.js";

const stale = () =>
  new OperationsError(
    "As etiquetas deste arquivo mudaram. Atualize a importação e tente novamente.",
    409,
  );

/** Each request writes a bounded group of pages. Retries resume a cached export. */
export async function prepareLabelExport(
  db: Firestore,
  bucket: LabelBucket,
  body: {
    id: string;
    revision: string;
    kind: unknown;
    version?: number;
  },
) {
  if (body.kind !== "active" && body.kind !== "excluded")
    throw new OperationsError("Tipo de PDF inválido.");
  const parent = db.collection("_staffLabelImports").doc(body.id);
  const header = (await parent.get()).data();
  const version = header?.selectionVersion ?? 0;
  if (
    !header ||
    header.revision !== body.revision ||
    header.state !== "ready" ||
    (body.version !== undefined && body.version !== version)
  )
    throw stale();
  const path = `staff-label-imports/${body.id}/${body.revision}`;
  const root = parent.collection("versions").doc(body.revision);
  const manifest = root.collection("exports").doc(body.kind + "-" + version);
  async function current(tx: FirebaseFirestore.Transaction) {
    const h = (await tx.get(parent)).data();
    if (
      !h ||
      h.revision !== body.revision ||
      h.state !== "ready" ||
      (h.selectionVersion ?? 0) !== version
    )
      throw stale();
  }
  const saved = (await manifest.get()).data();
  if (saved?.ready) {
    const [url] = await bucket
      .file(saved.path)
      .getSignedUrl({ action: "read", version: "v4", expires: Date.now() + 5 * 60_000 });
    return { url, count: saved.count, version };
  }
  const pages = await root.collection("pages").orderBy("number").get();
  const numbers = pages.docs
    .filter(
      (doc) =>
        doc.get("state") === "ready" && Boolean(doc.get("excluded")) === (body.kind === "excluded"),
    )
    .map((doc) => doc.get("number") as number);
  if (!numbers.length)
    throw new OperationsError(
      body.kind === "excluded"
        ? "Este arquivo não possui etiquetas excluídas."
        : "Todas as etiquetas deste arquivo foram excluídas.",
      409,
    );
  const cursor = saved?.cursor ?? 0;
  const complete = cursor >= numbers.length;
  const key = complete ? "complete" : String(cursor);
  const destination = `${path}/exports/${body.kind}-${version}/${key}.pdf`;
  const record = manifest.collection("files").doc(key);
  // Reserve the object before writing so whole-file deletion can find in-flight work.
  await db.runTransaction(async (tx) => {
    await current(tx);
    const existing = await tx.get(manifest);
    const file = await tx.get(record);
    if (!existing.exists) tx.create(manifest, { count: numbers.length, cursor: 0, ready: false });
    if (!file.exists) tx.create(record, { path: destination, number: cursor, ready: false });
  });
  const result = await PDFDocument.create({ updateMetadata: false });
  result.setTitle((body.kind === "excluded" ? "Excluídos - " : "Completo - ") + header.name);
  const sources = complete
    ? (await manifest.collection("files").orderBy("number").get()).docs
        .filter((doc) => doc.id !== "complete" && doc.get("ready"))
        .map((doc) => doc.get("path") as string)
    : numbers.slice(cursor, cursor + 24).map((n) => `${path}/${n}.pdf`);
  for (let start = 0; start < sources.length; start += 4) {
    const buffers = await Promise.all(
      sources.slice(start, start + 4).map(async (source) => (await bucket.file(source).download())[0]),
    );
    for (const bytes of buffers) {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      const copied = await result.copyPages(pdf, pdf.getPageIndices());
      copied.forEach((page) => result.addPage(page));
    }
  }
  if (complete && result.getPageCount() !== numbers.length)
    throw new OperationsError("A preparação do PDF ficou incompleta. Tente novamente.", 409);
  const file = bucket.file(destination);
  try {
    await file.save(Buffer.from(await result.save()), {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: "application/pdf", cacheControl: "private,no-store" },
    });
  } catch (error) {
    if (Number((error as any).code) !== 412) throw error;
  }
  try {
    await db.runTransaction(async (tx) => {
      await current(tx);
      const old = await tx.get(manifest);
      if (!old.exists) throw stale();
      tx.update(record, { ready: true });
      if (complete) tx.update(manifest, { ready: true, path: destination });
      else tx.update(manifest, { cursor: Math.max(old.get("cursor") ?? 0, cursor + sources.length) });
    });
  } catch (error) {
    const snapshot = await parent.get().catch(() => undefined);
    const h = snapshot?.data();
    if (
      snapshot &&
      (!h ||
        h.revision !== body.revision ||
        h.state === "deleting" ||
        (h.selectionVersion ?? 0) !== version)
    )
      await file.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
  if (!complete) return { version };
  const [url] = await file.getSignedUrl({
    action: "read",
    version: "v4",
    expires: Date.now() + 5 * 60_000,
  });
  return { url, count: numbers.length, version };
}
