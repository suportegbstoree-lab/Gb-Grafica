import {
  identifyProduct,
  LABEL_PARSER_VERSION,
  labelDigest,
  parseLabelPage,
  type LabelImport,
  type ImportedLabel,
} from "../lib/staffLabelImport";

async function readLabelPages(bytes: Uint8Array<ArrayBuffer>): Promise<ImportedLabel[]> {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  const task = getDocument({ data: bytes, enableXfa: false });
  try {
    const document = await task.promise;
    const pages: ImportedLabel[] = [];
    const cache = new Map<string, string>();
    for (let n = 1; n <= document.numPages; n++) {
      try {
        const page = await document.getPage(n);
        try {
          const text = await page.getTextContent();
          const { products, issue, warning } = parseLabelPage(text.items.filter((item) => "str" in item));
          const result: ImportedLabel = { products: [], parserVersion: LABEL_PARSER_VERSION };
          for (const product of products) result.products.push(await identifyProduct(product, cache));
          if (issue) result.issue = issue;
          if (warning) result.warning = warning;
          pages.push(result);
        } finally {
          page.cleanup();
        }
      } catch {
        pages.push({
          products: [],
          issue: "Não foi possível extrair os produtos desta página.",
          parserVersion: LABEL_PARSER_VERSION,
        });
      }
    }
    if (!pages.length) throw new Error("O PDF está vazio.");
    return pages;
  } finally {
    await task.destroy();
  }
}

export async function readLabelImport(file: File): Promise<LabelImport> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = await labelDigest(bytes);
  return { id, name: file.name, importedAt: Date.now(), pages: await readLabelPages(bytes) };
}
export async function readSavedLabelPage(blob: Blob): Promise<ImportedLabel> {
  const pages = await readLabelPages(new Uint8Array(await blob.arrayBuffer()));
  if (pages.length !== 1) throw new Error("O PDF salvo deve conter uma etiqueta por página.");
  return pages[0];
}

// Store only the import metadata on this device. Each file is independently
// updated in a transaction so overlapping imports and retries remain safe.
let database: Promise<IDBDatabase> | undefined;
async function openDatabase() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("gb-label-imports", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("imports");
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        database = undefined;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  }).catch((error) => {
    database = undefined;
    throw error;
  }));
}

export async function listLabelImports(owner: string): Promise<LabelImport[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("imports")
      .objectStore("imports")
      .getAll(IDBKeyRange.bound([owner, ""], [owner, []]));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function forgetLocalLabelImport(owner: string, id: string) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("imports", "readwrite");
    tx.objectStore("imports").delete([owner,id]);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
