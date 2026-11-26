import {
  identifyProduct,
  labelDigest,
  parseLabelPage,
  type LabelImport,
  type ImportedLabel,
} from "../lib/staffLabelImport";

export async function readLabelImport(file: File): Promise<LabelImport> {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = await labelDigest(bytes);
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
          const { products, issue } = parseLabelPage(text.items.filter((item) => "str" in item));
          const result: ImportedLabel = { products: [] };
          for (const product of products) result.products.push(await identifyProduct(product, cache));
          if (issue) result.issue = issue;
          pages.push(result);
        } finally {
          page.cleanup();
        }
      } catch {
        pages.push({ products: [], issue: "Falha ao ler esta página." });
      }
    }
    if (!pages.length) throw new Error("O PDF está vazio.");
    return { id, name: file.name, pages, importedAt: Date.now() };
  } finally {
    await task.destroy();
  }
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
