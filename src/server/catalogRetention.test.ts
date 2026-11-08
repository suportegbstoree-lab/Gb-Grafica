import test from "node:test";
import assert from "node:assert/strict";
import { memoryFirestore } from "../../test/helpers/memoryFirestore.js";
import {
  CATALOG_RETENTION_MS as WEEK,
  retainedAssetPaths,
  isRetainedAssetPath,
} from "../lib/catalogRetention.js";
import {
  cleanupCatalog,
  prepareCatalogRetention,
  retentionId,
  scheduleCatalogAssetRemoval,
  scheduleRetiredCatalogDocument,
} from "./catalogRetention.js";

const at = Date.parse("2026-11-08T12:00:00Z");
test('deleted email drafts keep a private copy for a full week and are purged by existing maintenance', async () => {
  const f = fixture(), source = '_emailCampaigns/12345678-1234-4234-8234-123456789abc';
  await f.mutate(source, { status: 'draft', subject: 'Oferta', text: 'Rascunho', revision: '12345678-1234-4234-8234-123456789abc' });
  await f.mutate(source, null);
  assert.equal(f.docs.has(source), false);
  assert.equal((await cleanupCatalog(f.services, at + WEEK - 1)).backupsDeleted, 0);
  const result = await cleanupCatalog(f.services, at + WEEK);
  assert.equal(result.backupsDeleted, 1); assert.equal(result.documentsDeleted, 1);
  assert.equal([...f.docs.keys()].filter(path => path.startsWith('_catalogTrash/')).length, 0);
});
const image = (id = "a") => `catalog/products/product/${id.repeat(32)}.png`;
function fixture() {
  const { db, docs } = memoryFirestore();
  const objects = new Map<string, { generation: string }>();
  const deleted: string[] = [];
  let rejectDelete = false;
  const bucket = {
    name: "test-bucket.appspot.com",
    file(path: string) {
      return {
        name: path,
        async getMetadata() {
          const data = objects.get(path);
          if (!data) throw { code: 404 };
          return [data];
        },
        async delete(options: any) {
          if (rejectDelete) throw { code: 500 };
          const data = objects.get(path);
          if (!data) throw { code: 404 };
          assert.equal(options.ifGenerationMatch, data.generation);
          objects.delete(path);
          deleted.push(path);
        },
      };
    },
    async getFiles({ prefix, startOffset, maxResults }: any) {
      return [
        [...objects.keys()]
          .filter((path) => path.startsWith(prefix) && path >= startOffset)
          .sort()
          .slice(0, maxResults)
          .map((name) => ({ name })),
      ];
    },
  };
  (db as any).recursiveDelete = async (ref: { path: string }) => {
    for (const path of docs.keys())
      if (path === ref.path || path.startsWith(ref.path + "/"))
        docs.delete(path);
  };
  const services = { db, bucket } as any;
  async function mutate(source: string, next: any, now = at) {
    await db.runTransaction(async (tx) => {
      const [collection, id] = source.split("/"),
        ref = db.collection(collection).doc(id),
        old = (await tx.get(ref)).data();
      const retain = await prepareCatalogRetention(
        db,
        tx,
        source,
        old,
        next,
        bucket.name,
        now,
      );
      retain();
      if (next) tx.set(ref, next);
      else tx.delete(ref);
    });
  }
  return {
    db,
    docs,
    objects,
    deleted,
    services,
    mutate,
    reject(value: boolean) {
      rejectDelete = value;
    },
  };
}

test("deletion leaves the shop immediately, retains a private snapshot and never deletes a file before 7 days", async () => {
  const f = fixture(),
    path = image();
  f.docs.set("anuncios/product", { nome: "Caderno", imagem: path });
  f.objects.set(path, { generation: "1" });
  await f.mutate("anuncios/product", null);
  assert.equal(f.docs.has("anuncios/product"), false);
  assert.equal(
    [...f.docs.keys()].filter((key) => key.startsWith("_catalogTrash/")).length,
    1,
  );
  assert.equal(
    f.docs.get(`_catalogAssetCleanup/${retentionId(path)}`)?.cleanupAt,
    at + WEEK,
  );
  await cleanupCatalog(f.services, at + WEEK - 1);
  assert.equal(f.objects.has(path), true);
  const result = await cleanupCatalog(f.services, at + WEEK);
  assert.equal(result.assetsDeleted, 1);
  assert.equal(result.backupsDeleted, 1);
  assert.equal(f.objects.has(path), false);
  assert.equal(
    [...f.docs.keys()].some((key) => key.startsWith("_catalogTrash/")),
    false,
  );
});

test("reusing a path cancels its old cleanup and removal again starts a new full seven days", async () => {
  const f = fixture(),
    path = image();
  f.docs.set("anuncios/product", { imagem: path });
  f.objects.set(path, { generation: "1" });
  await f.mutate("anuncios/product", null);
  await f.mutate("promocoes/sale", { imagem: path }, at + 3 * 86400000);
  assert.equal(f.docs.has(`_catalogAssetCleanup/${retentionId(path)}`), false);
  await f.mutate("promocoes/sale", null, at + 6 * 86400000);
  await cleanupCatalog(f.services, at + WEEK);
  assert.equal(f.objects.has(path), true);
  await cleanupCatalog(f.services, at + 13 * 86400000);
  assert.equal(f.objects.has(path), false);
});

test("legacy active references in variants, PDF alphabets and orders prevent shared files from being deleted", async () => {
  const f = fixture(),
    path = image(),
    font = `catalog/fonts/letter/${"b".repeat(32)}.ttf`;
  f.docs.set("anuncios/other", { imagensPorCombinacao: { blue: path } });
  f.docs.set("orders/order", {
    itens: [
      {
        personalizacaoTexto: {
          fonteArquivoUrl: `https://firebasestorage.googleapis.com/v0/b/${f.services.bucket.name}/o/${encodeURIComponent(font)}?alt=media`,
        },
      },
    ],
  });
  for (const value of [path, font]) {
    f.objects.set(value, { generation: "3" });
    await scheduleCatalogAssetRemoval(f.db, value, at);
  }
  const result = await cleanupCatalog(f.services, at + WEEK);
  assert.equal(result.sharedKept, 2);
  assert.equal(f.deleted.length, 0);
});

test("a catalog change during reference scanning invalidates the scan and postpones deletions", async () => {
  const f = fixture(),
    path = image();
  f.objects.set(path, { generation: "1" });
  await scheduleCatalogAssetRemoval(f.db, path, at);
  const original = f.db.collection.bind(f.db);
  let changed = false;
  (f.db as any).collection = (name: string) => {
    const query = original(name);
    if (name === "orders" && !changed) {
      changed = true;
      f.docs.set("_catalogCleanupControl/main", {
        revision: "changed-during-scan",
      });
    }
    return query;
  };
  await cleanupCatalog(f.services, at + WEEK);
  assert.equal(f.objects.has(path), true);
});

test("an asset claimed for purge cannot be attached again while deletion is in flight", async () => {
  const f = fixture(),
    path = image();
  f.objects.set(path, { generation: "7" });
  await scheduleCatalogAssetRemoval(f.db, path, at);
  const original = f.services.bucket.file;
  let rejected = false;
  f.services.bucket.file = (key: string) => {
    const file = original(key);
    return {
      ...file,
      async getMetadata() {
        await assert.rejects(
          f.mutate("anuncios/reused", { imagem: path }, at + WEEK),
          /sendo limpo/,
        );
        rejected = true;
        return file.getMetadata();
      },
    };
  };
  await cleanupCatalog(f.services, at + WEEK);
  assert.equal(rejected, true);
  assert.equal(f.docs.has("anuncios/reused"), false);
});

test("failed deletes keep a retryable job and successful deletes use generation preconditions", async () => {
  const f = fixture(),
    path = image();
  f.objects.set(path, { generation: "12" });
  await scheduleCatalogAssetRemoval(f.db, path, at);
  f.reject(true);
  assert.equal((await cleanupCatalog(f.services, at + WEEK)).failed, 1);
  assert.equal(f.docs.has(`_catalogAssetCleanup/${retentionId(path)}`), true);
  f.reject(false);
  await cleanupCatalog(f.services, at + WEEK + 1000);
  assert.deepEqual(f.deleted, [path]);
});

test("product subcollections, rating aggregates and review ownership are cleaned without touching orders", async () => {
  const f = fixture();
  f.docs.set("anuncios/product", { nome: "Caderno" });
  f.docs.set("anuncios/product/reviews/r1", { comment: "Teste" });
  f.docs.set("productRatings/product", { count: 1 });
  f.docs.set("_reviewOwners/review", { productId: "product", uid: "customer" });
  f.docs.set("orders/order", { itens: [] });
  await f.mutate("anuncios/product", null);
  await cleanupCatalog(f.services, at + WEEK - 1);
  assert.equal(f.docs.has("anuncios/product/reviews/r1"), true);
  await cleanupCatalog(f.services, at + WEEK);
  for (const key of [
    "anuncios/product/reviews/r1",
    "productRatings/product",
    "_reviewOwners/review",
  ])
    assert.equal(f.docs.has(key), false);
  assert.equal(f.docs.has("orders/order"), true);
});

test("a recreated document cancels recursive deletion instead of deleting the new data", async () => {
  const f = fixture();
  f.docs.set("categories/books", { nome: "Old" });
  await f.mutate("categories/books", null);
  await f.mutate("categories/books", { nome: "New" }, at + 1);
  await cleanupCatalog(f.services, at + WEEK);
  assert.equal(f.docs.get("categories/books")?.nome, "New");
});

test("400 fonts removed in one change all get their own deadlines and can be cleaned", async () => {
  const f = fixture();
  const fonts = Array.from({ length: 400 }, (_, i) => ({
    id: `f${i}`,
    arquivoUrl: `catalog/fonts/f${i}/${i.toString(16).padStart(32, "0")}.ttf`,
  }));
  fonts.forEach((font) => f.objects.set(font.arquivoUrl, { generation: "1" }));
  f.docs.set("config/main", { fontes_personalizacao: fonts });
  await f.mutate("config/main", { fontes_personalizacao: [] });
  assert.equal(
    [...f.docs.keys()].filter((path) =>
      path.startsWith("_catalogAssetCleanup/"),
    ).length,
    400,
  );
  assert.equal(
    (await cleanupCatalog(f.services, at + WEEK)).assetsDeleted,
    400,
  );
});

test("unknown orphan files get a new grace period and retired legacy metadata is eventually removed", async () => {
  const f = fixture(),
    path = image();
  f.objects.set(path, { generation: "1" });
  const id = "c".repeat(32);
  f.docs.set(`_staffPdfBases/${id}`, {
    status: "deleted",
    deletedAt: new Date(at).toISOString(),
  });
  await cleanupCatalog(f.services, at + 2 * WEEK);
  assert.equal(f.objects.has(path), true);
  assert.equal(
    f.docs.get(`_catalogAssetCleanup/${retentionId(path)}`)?.cleanupAt,
    at + 3 * WEEK,
  );
  await cleanupCatalog(f.services, at + 3 * WEEK);
  assert.equal(f.objects.has(path), false);
  assert.equal(f.docs.has(`_staffPdfBases/${id}`), false);
});

test("foreign buckets, unowned paths and arbitrary text cannot enter the asset cleanup scope", async () => {
  assert.equal(
    isRetainedAssetPath("artworks/customer/orders/GB-order/a.pdf"),
    false,
  );
  assert.equal(isRetainedAssetPath("catalog/products/../../secret.png"), false);
  const foreign = `https://firebasestorage.googleapis.com/v0/b/foreign/o/${encodeURIComponent(image())}`;
  assert.equal(
    retainedAssetPaths(
      { imagem: foreign, desc: image() },
      "test-bucket.appspot.com",
    ).size,
    0,
  );
  const f = fixture();
  await assert.rejects(
    scheduleCatalogAssetRemoval(f.db, "anything/private-key.json"),
  );
});

test("reference scans include later pages before deciding that a file is orphaned", async () => {
  const f = fixture(),
    path = image();
  for (let i = 0; i < 250; i++)
    f.docs.set(
      `orders/order-${String(i).padStart(3, "0")}`,
      i === 249 ? { itens: [{ imagem: path }] } : { itens: [] },
    );
  f.objects.set(path, { generation: "1" });
  await scheduleCatalogAssetRemoval(f.db, path, at);
  assert.equal((await cleanupCatalog(f.services, at + WEEK)).sharedKept, 1);
  assert.equal(f.objects.has(path), true);
});
