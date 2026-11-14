import dotenv from 'dotenv';
import type { CollectionReference, DocumentReference, Firestore } from 'firebase-admin/firestore';
import { pathToFileURL } from 'node:url';
import { getAdminServices } from '../src/server/firebaseAdmin.js';
import { uploadBatch } from '../src/lib/uploadBatch.js';

const orderCollections = [
  'orders', '_orderDocuments', '_orderEmails', '_checkoutRequests', '_trackingJobs',
  '_melhorEnvioLabels', '_pagbankHomologation', '_salesCouponHolds', '_salesFirstPurchases',
  '_reviewOwners', 'productRatings',
] as const;
const mixedCollections = ['_emailOutbox', '_operationsActivity', '_workTasks', '_productionEntries'] as const;
const orderId = /^GB-[A-Za-z0-9_-]+$/i;
const orderArtwork = /^artworks\/[^/]+\/orders\/.+/;
const usage = 'Uso: npm run orders:reset -- [--apply=PROJETO/BANCO/BUCKET]';

async function collectionCounts(collection: CollectionReference): Promise<{ direct: number; descendants: number; missing: number }> {
  let direct = 0;
  let descendants = 0;
  let missing = 0;
  for (const doc of await collection.listDocuments()) {
    const [snapshot, children] = await Promise.all([doc.get(), doc.listCollections()]);
    if (snapshot.exists) direct++;
    else missing++;
    for (const child of children) {
      const counts = await collectionCounts(child);
      descendants += counts.direct + counts.descendants;
    }
  }
  return { direct, descendants, missing };
}

async function deleteDocumentTree(doc: DocumentReference): Promise<void> {
  // Remove the parent first so payment callbacks no longer find the order.
  await doc.delete();
  for (const collection of await doc.listCollections()) {
    for (const child of await collection.listDocuments()) await deleteDocumentTree(child);
  }
}

async function verifyCollections(collections: CollectionReference[]) {
  const remaining: string[] = [];
  for (const collection of collections) {
    if (!(await collection.listDocuments()).length) continue;
    const { direct, descendants, missing } = await collectionCounts(collection);
    if (direct || descendants || missing) {
      remaining.push(`${collection.id} (${direct} documentos no nível principal, ${descendants} em subcoleções, ${missing} pais sem documento)`);
    }
  }
  if (remaining.length) throw new Error(`Ainda há registros no Firestore: ${remaining.join('; ')}.`);
}

async function mixedDocuments(db: Firestore, ids: Set<string>) {
  const matchesOrder = (value: unknown) =>
    typeof value === 'string' && (ids.has(value) || orderId.test(value));
  const result = new Map<string, DocumentReference[]>();
  for (const name of mixedCollections) {
    const rows = await db.collection(name).select('kind', 'action', 'reference').get();
    const matches = rows.docs.filter(doc => {
      const data = doc.data();
      switch (name) {
        case '_emailOutbox':
          return data.kind === 'order-status' || doc.id.startsWith('order-');
        case '_operationsActivity':
          return data.action === 'orders.consulted' || (typeof data.action === 'string' && data.action.startsWith('order.'));
        case '_workTasks':
          return data.kind === 'order';
        case '_productionEntries':
          return matchesOrder(data.reference);
      }
    });
    result.set(name, matches.map(doc => doc.ref));
  }
  const reviews = await db.collectionGroup('reviews').select().get();
  result.set('Avaliações de compra', reviews.docs
    .filter(doc => /^anuncios\/[^/]+\/reviews\/[^/]+$/.test(doc.ref.path))
    .map(doc => doc.ref));
  return result;
}

export async function resetOrderData(
  { db, bucket }: Pick<ReturnType<typeof getAdminServices>, 'db' | 'bucket'>,
  apply: boolean,
  log = console.log,
) {
  const collections = orderCollections.map(name => db.collection(name));
  const orderIdCollections = ['orders', '_orderDocuments', '_trackingJobs', '_melhorEnvioLabels', '_pagbankHomologation', '_salesCouponHolds'];
  const orderRefs = await Promise.all(orderIdCollections.map(name => db.collection(name).listDocuments()));
  const ids = new Set(orderRefs.flat().map(doc => doc.id));
  const mixed = await mixedDocuments(db, ids);
  const [files] = await bucket.getFiles({ prefix: 'artworks/', matchGlob: 'artworks/*/orders/**', versions: true });
  const objects = files.filter(file => orderArtwork.test(file.name));
  const coupons = (await db.collection('_salesCoupons').select('used').get()).docs.filter(doc => Number(doc.get('used')) > 0);
  for (const collection of collections) {
    const { direct, descendants, missing } = await collectionCounts(collection);
    log(`${collection.id}: ${direct} no nível principal, ${descendants} em subcoleções, ${missing} pais sem documento`);
  }
  for (const [name, rows] of mixed) log(`${name} vinculados a pedidos: ${rows.length}`);
  log(`Artes de pedidos no Storage: ${objects.length}\nCupons com uso a zerar: ${coupons.length}`);
  if (!apply) return;
  const deleteDocuments = async (refs: DocumentReference[]) => {
    await uploadBatch(refs, deleteDocumentTree, { concurrency: 4, rollback: async () => undefined });
  };
  const [orders, ...related] = collections;
  await deleteDocuments(await orders.listDocuments());
  await verifyCollections([orders]);
  for (const collection of related) await deleteDocuments(await collection.listDocuments());
  for (const refs of mixed.values()) await deleteDocuments(refs);
  await uploadBatch(objects, async file => {
    const generation = file.metadata.generation;
    if (!generation) throw new Error('O Storage retornou um objeto sem geração.');
    await bucket.file(file.name, { generation }).delete({ ignoreNotFound: true });
  }, { concurrency: 6, rollback: async () => undefined });
  await uploadBatch(coupons, async doc => {
    await db.runTransaction(async tx => {
      const current = await tx.get(doc.ref);
      if (current.exists && Number(current.get('used')) > 0) tx.update(doc.ref, { used: 0 });
    });
  }, { concurrency: 6, rollback: async () => undefined });
  const remainingMixed = await mixedDocuments(db, ids);
  await verifyCollections(collections);
  const [remainingFiles] = await bucket.getFiles({ prefix: 'artworks/', matchGlob: 'artworks/*/orders/**', versions: true });
  if ([...remainingMixed.values()].some(refs => refs.length) || remainingFiles.some(file => orderArtwork.test(file.name)))
    throw new Error('Ainda há registros ou artes de pedidos. Confira as escritas simultâneas e rode a prévia novamente.');
  if ((await db.collection('_salesCoupons').where('used', '>', 0).limit(1).get()).size)
    throw new Error('Ainda há cupons com usos registrados. Rode a prévia novamente.');
  log('Limpeza verificada no Firestore e no Storage.');
}

async function main(args: string[]) {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  if (args.length > 1 || (args.length === 1 && !/^--apply=[^/]+\/[^/]+\/[^/]+$/.test(args[0]))) {
    throw new Error(usage);
  }
  dotenv.config({ path: ['.env.local', '.env'], quiet: true });
  const services = getAdminServices();
  const target = [services.app.options.projectId, services.db.databaseId, services.bucket.name].join('/');
  const apply = args.length === 1;
  if (apply && args[0] !== `--apply=${target}`) throw new Error(`Destino divergente. Firebase configurado em ${target}.`);
  console.log(`Destino ${target}`);
  await resetOrderData(services, apply);
  if (!apply) console.log(`Para apagar os registros de pedidos deste destino: npm run orders:reset -- --apply=${target}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Falha na limpeza dos pedidos.');
    process.exitCode = 1;
  });
}
