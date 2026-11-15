import React from "react";

const storeName = "workspace";
let opening: Promise<IDBDatabase> | undefined;

function database() {
  return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("gb-staff-pdf", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    opening = undefined;
    throw error;
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, result: (value: T) => void) => void,
) {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode, { durability: "strict" });
    let value: T;
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(tx.error || new Error("A gravação local foi interrompida."));
    action(tx.objectStore(storeName), (next) => { value = next; });
  });
}

type Change<T> = (previous: T) => T;
type QueueRecord = { id: string; original?: Blob; status: string };

export function useStaffPdfDraft<T>(owner: string | undefined, slot: string, initial: T) {
  const current = React.useRef(initial);
  const [value, setValue] = React.useState(initial);
  const [ready, setReady] = React.useState(!owner);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (!owner) return;
    let active = true;
    void transaction<T | undefined>("readonly", (store, result) => {
      const read = store.get([owner, slot]);
      read.onsuccess = () => result(read.result);
    }).then((stored) => {
      if (!active) return;
      if (stored !== undefined) {
        current.current = stored;
        setValue(stored);
      }
      setReady(true);
    }).catch(() => {
      if (active) {
        setError("Não foi possível recuperar o rascunho neste navegador.");
        setReady(true);
      }
    });
    return () => { active = false; };
  }, [owner, slot]);

  async function save(change: Change<T>) {
    const next = change(current.current);
    if (next === current.current) return;
    current.current = next;
    setValue(next);
    if (!owner) return;
    try {
      await transaction<void>("readwrite", (store) => {
        if (next === null) store.delete([owner, slot]);
        else store.put(next, [owner, slot]);
      });
      setError("");
    } catch {
      setError("O navegador não conseguiu salvar o rascunho. Mantenha a página aberta.");
    }
  }
  return { value, ready, error, save };
}

export function useStaffPdfQueue<T extends QueueRecord>(owner?: string) {
  const [queue, setQueue] = React.useState<T[]>([]);
  const [ready, setReady] = React.useState(!owner);
  const [error, setError] = React.useState("");
  const current = React.useRef<T[]>([]);
  const version = React.useRef(0);
  const writes = React.useRef(Promise.resolve());
  React.useEffect(() => {
    if (!owner) return;
    let active = true;
    const range = IDBKeyRange.bound([owner, "queue", ""], [owner, "queue", []]);
    void transaction<{ version: number; rows: { position: number; item: T }[] }>(
      "readonly", (store, result) => {
        const meta = store.get([owner, "queueVersion"]);
        const rows = store.getAll(range);
        rows.onsuccess = () => result({ version: meta.result ?? 0, rows: rows.result });
      },
    ).then((stored) => {
      if (!active) return;
      version.current = stored.version;
      current.current = stored.rows.sort((a, b) => a.position - b.position).map(({ item }) =>
        item.status === "processing" ? { ...item, status: "queued" } : item,
      );
      setQueue(current.current);
      setReady(true);
    }).catch(() => {
      if (active) setError("Não foi possível recuperar a fila salva neste navegador.");
    });
    return () => { active = false; };
  }, [owner]);

  function update(change: Change<T[]>) {
    const operation = writes.current.then(async () => {
      const before = current.current;
      const next = change(before);
      if (next === before) return;
      if (owner) {
        let conflict = false;
        try {
          await transaction<void>("readwrite", (store) => {
            const check = store.get([owner, "queueVersion"]);
            check.onsuccess = () => {
              if ((check.result ?? 0) !== version.current) {
                conflict = true;
                return;
              }
              const old = new Map<string, { item: T; position: number }>(
                before.map((item, position) => [item.id, { item, position }]),
              );
              next.forEach((item, position) => {
                const previous = old.get(item.id);
                if (previous?.item !== item || previous.position !== position) {
                  const { original, ...saved } = item;
                  store.put({ position, item: saved }, [owner, "queue", item.id]);
                }
                old.delete(item.id);
              });
              for (const id of old.keys()) store.delete([owner, "queue", id]);
              store.put(version.current + 1, [owner, "queueVersion"]);
            };
          });
        } catch {
          throw new Error("O navegador não conseguiu salvar a fila. Tente novamente com a página aberta.");
        }
        if (conflict) throw new Error("A fila mudou em outra aba. Recarregue para continuar com a versão salva.");
        version.current++;
      }
      current.current = next;
      setQueue(next);
      setError("");
    });
    writes.current = operation.catch((failure) => { setError(failure.message); });
    return operation;
  }
  return { queue, current, ready, error, update, flush: () => writes.current };
}
