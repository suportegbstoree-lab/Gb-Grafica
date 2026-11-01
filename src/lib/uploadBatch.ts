export const CATALOG_UPLOAD_CONCURRENCY = 3;
/** Stop scheduling after a failure, settle in-flight work, then roll back every successful object. */
export async function uploadBatch<T, U>(
  items: readonly T[],
  upload: (item: T, index: number) => Promise<U>,
  options: {
    concurrency?: number;
    rollback: (value: U) => Promise<unknown>;
    progress?: (completed: number, total: number) => void;
    active?: () => boolean;
  },
): Promise<U[]> {
  const concurrency = options.concurrency ?? CATALOG_UPLOAD_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6)
    throw new Error("Concorrência de envio inválida.");
  const results = new Array<U>(items.length),
    succeeded: U[] = [];
  let next = 0,
    failure: unknown,
    failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      if (options.active && !options.active()) {
        failed = true;
        failure = new Error("Edição encerrada.");
        break;
      }
      const index = next++;
      try {
        const result = await upload(items[index], index);
        results[index] = result;
        succeeded.push(result);
        options.progress?.(succeeded.length, items.length);
        if (options.active && !options.active())
          throw new Error("Edição encerrada.");
      } catch (error) {
        failed = true;
        failure ||= error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  if (failed) {
    const cleanup = await Promise.allSettled(succeeded.map(options.rollback));
    const message =
      failure instanceof Error
        ? failure.message
        : "Não foi possível concluir o envio.";
    if (cleanup.some((result) => result.status === "rejected"))
      throw new Error(
        `${message} Alguns arquivos temporários não puderam ser removidos; avise a administração.`,
      );
    throw failure instanceof Error ? failure : new Error(message);
  }
  return results;
}
