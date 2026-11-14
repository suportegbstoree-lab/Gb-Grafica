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
    async listCollections() { return [...new Set([...docs.keys()].filter(key => key.startsWith(path + '/')).map(key => key.slice(path.length + 1).split('/')[0]))].map(name => collection(`${path}/${name}`)); },
    async create(data: Record<string, unknown>) { if (docs.has(path)) throw Object.assign(new Error('exists'),{code:6}); put(docs, path, data); },
    async set(data: Record<string, unknown>, options?: { merge: boolean }) { put(docs, path, data, options?.merge); },
    async delete() { docs.delete(path); },
  });
  type Ref = ReturnType<typeof reference>;
  function collection(path: string) {
    let limit = Infinity, sort: string | undefined, descending = false, cursor: unknown;
    const filters: Array<(data: Record<string, unknown>) => boolean> = [];
    const query = { id: path.split('/').at(-1)!, path, doc: (id: string) => reference(`${path}/${id}`),
      async listDocuments() { return [...new Set([...docs.keys()].filter(key => key.startsWith(path + '/')).map(key => key.slice(path.length + 1).split('/')[0]))].map(id => reference(`${path}/${id}`)); },
      select(..._fields: string[]) { return query; }, limit(count: number) { limit = count; return query; },
      where(field: string, op: string, value: unknown) { filters.push(data => op === 'in' ? (value as unknown[]).includes(data[field]) : op === '==' ? data[field] === value : op === '>=' ? data[field]! >= value! : op === '>' ? data[field]! > value! : op === '<' ? data[field]! < value! : data[field]! <= value!); return query; },
      startAfter(value: unknown) { cursor = value; return query; },
      orderBy(field: string, direction?: string) { sort = field; descending = direction === 'desc'; return query; },
      async get() { const entries = [...docs].filter(([key, value]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1 && filters.every(filter => filter(value)) && (cursor === undefined || (sort === '__name__' ? key > String((cursor as any)?.ref?.path || cursor) : sort && value[sort]! > cursor!)))
        .sort((a, b) => sort === '__name__' ? a[0].localeCompare(b[0]) : sort ? (a[1][sort]! < b[1][sort]! ? -1 : a[1][sort]! > b[1][sort]! ? 1 : a[0].localeCompare(b[0])) * (descending ? -1 : 1) : 0).slice(0, limit);
        return { size: entries.length, docs: entries.map(([key, data]) => ({ id: key.split('/').at(-1)!, ref: reference(key), data: () => data, get: (field: string) => data[field] })) }; },
    }; return query;
  }
  const db = { collection,
    collectionGroup(name: string) {
      const query = { select() { return query; }, async get() {
        return { docs: [...docs.keys()].filter(path => path.split('/').at(-2) === name).map(path => ({ ref: reference(path) })) };
      } };
      return query;
    },
    async recursiveDelete(ref: { path: string }) {
      for (const path of docs.keys()) if (path === ref.path || path.startsWith(ref.path + '/')) docs.delete(path);
    },
    runTransaction(fn: (transaction: unknown) => Promise<unknown>) {
    const pending = tail.then(async () => {
      const staged = new Map(docs);
      const result = await fn({ get: async (ref: Ref | ReturnType<typeof collection>) => 'listDocuments' in ref ? ref.get() : ({ exists: staged.has(ref.path), data: () => staged.get(ref.path), get: (field: string) => staged.get(ref.path)?.[field] }),
        set: (ref: Ref, data: Record<string, unknown>, options?: { merge: boolean }) => put(staged, ref.path, data, options?.merge),
        update: (ref: Ref, data: Record<string, unknown>) => { if (!staged.has(ref.path)) throw new Error('missing'); put(staged, ref.path, data, true); },
        create: (ref: Ref, data: Record<string, unknown>) => { if (staged.has(ref.path)) throw Object.assign(new Error('exists'),{code:6}); put(staged, ref.path, data); }, delete: (ref: Ref) => staged.delete(ref.path),
      });
      docs.clear(); for (const [key, data] of staged) docs.set(key, data); return result;
    }); tail = pending.catch(() => {}); return pending;
  } } as unknown as Firestore;
  return { db, docs };
}
