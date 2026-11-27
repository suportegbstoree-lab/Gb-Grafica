import type { LabelBaseBinding, LabelBaseBindingsApi, ImportedProduct } from "../lib/staffLabelImport";

export function labelBaseBindingsClient(
  request: (path: string, body: unknown) => Promise<any>,
): LabelBaseBindingsApi {
  const path = "/label-categories/base-bindings";
  return {
    async lookup(products) {
      const result: Record<string, LabelBaseBinding> = {};
      let batch: ImportedProduct[] = [],
        size = 0;
      async function flush() {
        if (!batch.length) return;
        Object.assign(result, await request(path + "/lookup", { products: batch }));
        batch = [];
        size = 0;
      }
      for (const product of products) {
        const bytes = new TextEncoder().encode(JSON.stringify(product)).length;
        if (batch.length >= 20 || size + bytes > 180_000) await flush();
        batch.push(product);
        size += bytes;
      }
      await flush();
      return result;
    },
    save: (product, baseId, expectedVersion) =>
      request(path + "/save", { product, baseId, expectedVersion }),
  };
}
