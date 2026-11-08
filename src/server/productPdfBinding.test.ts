import test from "node:test";
import assert from "node:assert/strict";
import { verifyProductPdfBinding } from "./productPdfBinding";
import { defaultPdfLayout } from "../lib/staffPdf";
import { memoryFirestore } from "../../test/helpers/memoryFirestore";
const baseId = "a".repeat(32),
  layoutId = "b".repeat(32),
  revision = "c".repeat(32),
  pdfId = "d".repeat(32),
  bucket = "demo.example.app";
const image = (id: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent("catalog/products/product/" + id + ".png")}?alt=media`;
function setup() {
  const layout = defaultPdfLayout(),
    memory = memoryFirestore([
      [
        "_staffPdfBases/" + baseId,
        {
          status: "ready",
          path: `staff-pdf-bases/${baseId}/original.pdf`,
          name: "Base.pdf",
          pageCount: 2,
          revision,
          pages: [],
        },
      ],
      ["_staffPdfLayouts/" + layoutId, { enabled: true, revision, layout }],
      ["config/main", { fontes_personalizacao: [] }],
    ]);
  const metadata = new Map<string, any>([
    [
      `staff-pdf-bases/${baseId}/original.pdf`,
      { contentType: "application/pdf", md5Hash: "same-hash", size: "100" },
    ],
    [
      `catalog/templates/product/${pdfId}.pdf`,
      { contentType: "application/pdf", md5Hash: "same-hash", size: "100" },
    ],
  ]);
  const services = {
    db: memory.db,
    bucket: {
      name: bucket,
      file: (path: string) => ({
        getMetadata: async () => [metadata.get(path)],
      }),
    },
  } as any;
  const binding = {
    revision,
    baseId,
    baseRevision: revision,
    layoutId,
    layoutRevision: revision,
    layout: structuredClone(layout),
    fonts: [],
    pdf: {
      id: pdfId,
      path: `catalog/templates/product/${pdfId}.pdf`,
      name: "Base.pdf",
      pages: [image("e".repeat(32)), image("f".repeat(32))],
    },
  };
  const tx = { get: (ref: any) => ref.get() } as any;
  return { services, tx, binding, metadata, memory };
}
test("publication accepts the original PDF and canonical workshop layout without exposing the private base", async () => {
  const x = setup();
  await verifyProductPdfBinding(x.services, x.tx, "product", x.binding);
});
for (const [name, change] of [
  ["geometry", (x: ReturnType<typeof setup>) => x.binding.layout.pos_x++],
  [
    "revision",
    (x: ReturnType<typeof setup>) =>
      (x.binding.layoutRevision = "0".repeat(32)),
  ],
  [
    "foreign preview",
    (x: ReturnType<typeof setup>) =>
      (x.binding.pdf.pages[0] = "https://other.example/a.png"),
  ],
  [
    "different PDF",
    (x: ReturnType<typeof setup>) =>
      (x.metadata.get(x.binding.pdf.path).md5Hash = "other-hash"),
  ],
] as const)
  test(`publication refuses substituted ${name}`, async () => {
    const x = setup();
    change(x);
    await assert.rejects(
      verifyProductPdfBinding(x.services, x.tx, "product", x.binding),
    );
  });
