import test from "node:test";
import assert from "node:assert/strict";
import { uploadStaffPdfBase } from "./staffPdfBaseUpload";

const id = "a".repeat(32);
const pending = {
  id, path: `staff-pdf-bases/${id}/upload.pdf`, ready: false,
  url: "https://storage.googleapis.com/test/base.pdf",
  headers: { "Content-Type": "application/pdf", "x-goog-if-generation-match": "0" },
};
const file = new File(["%PDF-1.7\n"], "Base.PDF", { type: "application/octet-stream" });

test("invalid local files and invalid upload targets never send PDF bytes", async () => {
  let requests = 0;
  const request = async () => { requests++; return pending; };
  const fetcher: typeof fetch = async () => { throw new Error("Unexpected upload"); };
  for (const invalid of [new File(["%PDF-1.7"], "file.txt"), new File(["invalid contents"], "file.pdf"), new File(["%PDF-"], "small.pdf")])
    await assert.rejects(uploadStaffPdfBase(invalid, "request", undefined, undefined, request, fetcher), /PDF válido/);
  assert.equal(requests, 0);
  await assert.rejects(uploadStaffPdfBase(file, "request", undefined, undefined, async () => ({ ...pending, path: "another/path.pdf" }), fetcher), /Destino inválido/);
  await assert.rejects(uploadStaffPdfBase(file, "request", undefined, undefined, async () => ({ ...pending, headers: {} }), fetcher), /autorizar/);
});

test("a failed PUT preserves the upload so another attempt can finish it", async () => {
  const calls: string[] = [];
  const request = async (path: string) => {
    calls.push(path);
    return path === "/bases" ? pending : { id };
  };
  await assert.rejects(uploadStaffPdfBase(file, "request", undefined, undefined, request, async () => new Response(null, { status: 503 })), /armazenar/);
  assert.deepEqual(calls, ["/bases"]);
  assert.equal(await uploadStaffPdfBase(file, "request", undefined, undefined, request, async () => new Response(null, { status: 412 })), id);
  assert.deepEqual(calls, ["/bases", "/bases", `/bases/${id}/finalize`]);
});
