import test from "node:test";
import assert from "node:assert/strict";
import { uploadBatch } from "./uploadBatch";
test("alphabet batches keep bytes and order while limiting simultaneous uploads to three", async () => {
  const input = Array.from(
    { length: 26 },
    (_, i) => new Uint8Array([137, 80, 78, 71, i]),
  );
  let active = 0,
    peak = 0;
  const progress: number[] = [];
  const result = await uploadBatch(
    input,
    async (bytes, index) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, ((index % 3) + 1) * 2));
      active--;
      return { bytes, index };
    },
    {
      rollback: async () => assert.fail("no cleanup on success"),
      progress: (count) => progress.push(count),
    },
  );
  assert.equal(peak, 3);
  assert.deepEqual(
    result.map((r) => r.index),
    input.map((_, i) => i),
  );
  for (let i = 0; i < 26; i++) assert.strictEqual(result[i].bytes, input[i]);
  assert.equal(progress.at(-1), 26);
});
test("batch failure waits for inflight uploads then removes every successful object and stops scheduling", async () => {
  const started: number[] = [],
    finished: number[] = [],
    removed: number[] = [];
  await assert.rejects(
    uploadBatch(
      [0, 1, 2, 3, 4, 5],
      async (i) => {
        started.push(i);
        if (i === 1) throw new Error("network failed");
        await new Promise((r) => setTimeout(r, 10));
        finished.push(i);
        return i;
      },
      {
        rollback: async (i) => {
          assert.deepEqual(finished.sort(), [0, 2]);
          removed.push(i);
        },
      },
    ),
    /network failed/,
  );
  assert.deepEqual(started, [0, 1, 2]);
  assert.deepEqual(removed.sort(), [0, 2]);
});
test("leaving an upload editor rolls back completed files and reports cleanup failures", async () => {
  let active = true;
  await assert.rejects(
    uploadBatch(
      [1, 2, 3],
      async (i) => {
        active = false;
        return i;
      },
      {
        concurrency: 1,
        active: () => active,
        rollback: async () => {
          throw new Error("cleanup");
        },
      },
    ),
    /temporários não puderam/,
  );
});
