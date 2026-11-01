let pending: Promise<string | null> = Promise.resolve(null);
let generation = 0;
export function setWorkTask(task: Promise<string | null>) {
  const version = ++generation;
  pending = task.catch(() => null);
  return () => {
    if (generation === version) {
      generation++;
      pending = Promise.resolve(null);
    }
  };
}
export async function currentWorkTask() {
  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 6000);
    void pending.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}
