import { FieldValue, type Firestore } from 'firebase-admin/firestore';

/** Atomic in-memory transactions for provider/state race tests. No network or credentials. */
export function memoryFirestore(initial: Array<[string, Record<string, unknown>]> = []) {
  const docs = new Map(initial);
  let tail = Promise.resolve<unknown>(undefined);
  const put = (map: typeof docs, path: string, data: Record<string, unknown>, merge = false) => {
    const value = merge ? { ...map.get(path), ...data } : { ...data };
    for (const [key, entry] of Object.entries(value)) if (entry instanceof FieldValue && entry.isEqual(FieldValue.delete())) delete value[key];
    map.set(path, value);
  };
  const reference = (path: string) => ({
    path, id: path.split('/').at(-1)!, collection: (name: string) => collection(`${path}/${name}`),
    async get() { const data = docs.get(path); return { exists: Boolean(data), data: () => data }; },
    async create(data: Record<string, unknown>) { if (docs.has(path)) throw new Error('exists'); put(docs, path, data); },
    async set(data: Record<string, unknown>, options?: { merge: boolean }) { put(docs, path, data, options?.merge); },
    async delete() { docs.delete(path); },
  });
  type Ref = ReturnType<typeof reference>;
  function collection(path: string) {
    let limit = Infinity, sort: string | undefined;
    const filters: Array<(data: Record<string, unknown>) => boolean> = [];
    const query = { doc: (id: string) => reference(`${path}/${id}`), limit(count: number) { limit = count; return query; },
      where(field: string, op: string, value: unknown) { filters.push(data => op === '==' ? data[field] === value : typeof data[field] === 'number' && Number(data[field]) <= Number(value)); return query; },
      orderBy(field: string) { sort = field; return query; },
      async get() { const entries = [...docs].filter(([key, value]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1 && filters.every(filter => filter(value)))
        .sort((a, b) => sort ? Number(a[1][sort]) - Number(b[1][sort]) : 0).slice(0, limit);
        return { size: entries.length, docs: entries.map(([key, data]) => ({ id: key.split('/').at(-1)!, ref: reference(key), data: () => data })) }; },
    }; return query;
  }
  const db = { collection, runTransaction(fn: (transaction: unknown) => Promise<unknown>) {
    const pending = tail.then(async () => {
      const staged = new Map(docs);
      const result = await fn({ get: async (ref: Ref) => ({ exists: staged.has(ref.path), data: () => staged.get(ref.path) }),
        set: (ref: Ref, data: Record<string, unknown>, options?: { merge: boolean }) => put(staged, ref.path, data, options?.merge),
        update: (ref: Ref, data: Record<string, unknown>) => { if (!staged.has(ref.path)) throw new Error('missing'); put(staged, ref.path, data, true); },
        create: (ref: Ref, data: Record<string, unknown>) => { if (staged.has(ref.path)) throw new Error('exists'); put(staged, ref.path, data); }, delete: (ref: Ref) => staged.delete(ref.path),
      });
      docs.clear(); for (const [key, data] of staged) docs.set(key, data); return result;
    }); tail = pending.catch(() => {}); return pending;
  } } as unknown as Firestore;
  return { db, docs };
}
