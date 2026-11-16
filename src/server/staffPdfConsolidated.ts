import { crc32 } from "node:zlib";
import { PDFContext, PDFDocument, PDFHeader, PDFObjectCopier, PDFRef, type PDFObject } from "pdf-lib";

const catalog = PDFRef.of(1);
const pageTree = PDFRef.of(2);
type ObjectOffset = [objectNumber: number, offset: number];
export interface StaffPdfMergePart {
  objectNumber: number;
  tree: number;
  pages: number;
  offsets: ObjectOffset[];
  bytes: number;
  crc32: number;
}

function serializeObjects(objects: [PDFRef, PDFObject][], position: number, prefix = Buffer.alloc(0)) {
  const records = objects.map(([ref, object]) => ({
    ref, object, start: Buffer.from(`${ref.objectNumber} 0 obj\n`), size: object.sizeInBytes(),
  }));
  const end = Buffer.from("\nendobj\n");
  const bytes = Buffer.allocUnsafe(records.reduce((size, entry) => size + entry.start.length + entry.size + end.length, prefix.length));
  let cursor = prefix.copy(bytes);
  const offsets: ObjectOffset[] = [];
  for (const { ref, object, start } of records) {
    offsets.push([ref.objectNumber, position + cursor]);
    cursor += start.copy(bytes, cursor);
    cursor += object.copyBytesInto(bytes, cursor);
    cursor += end.copy(bytes, cursor);
  }
  return { bytes: bytes.subarray(0, cursor), offsets };
}

export async function writeStaffPdfMergePart(
  pdfs: AsyncIterable<Uint8Array>,
  previous?: StaffPdfMergePart,
) {
  const context = PDFContext.create();
  context.largestObjectNumber = previous?.objectNumber ?? 2;
  const tree = context.nextRef();
  const kids: PDFRef[] = [];
  for await (const bytes of pdfs) {
    const source = await PDFDocument.load(bytes, { updateMetadata: false });
    const copy = PDFObjectCopier.for(source.context, context);
    for (const { node } of source.getPages()) {
      const leaf = copy.copy(node);
      leaf.setParent(tree);
      kids.push(context.register(leaf));
    }
  }
  if (!kids.length) throw new Error("PDF sem páginas no lote.");
  context.assign(tree, context.obj({ Type: "Pages", Parent: pageTree, Kids: kids, Count: kids.length }));
  const header = PDFHeader.forVersion(1, 7);
  const prefix = previous ? Buffer.alloc(0) : Buffer.alloc(header.sizeInBytes() + 1, 0x0a);
  if (!previous) header.copyBytesInto(prefix, 0);
  const { bytes, offsets } = serializeObjects(context.enumerateIndirectObjects(), previous?.bytes ?? 0, prefix);
  const part: StaffPdfMergePart = {
    objectNumber: context.largestObjectNumber,
    tree: tree.objectNumber,
    pages: kids.length,
    offsets,
    bytes: (previous?.bytes ?? 0) + bytes.length,
    crc32: crc32(bytes, previous?.crc32),
  };
  return { bytes, part };
}

export function finishStaffPdfMerge(parts: StaffPdfMergePart[]) {
  const last = parts[parts.length - 1];
  const context = PDFContext.create();
  context.assign(catalog, context.obj({ Type: "Catalog", Pages: pageTree }));
  context.assign(pageTree, context.obj({
    Type: "Pages",
    Kids: parts.map(({ tree }) => PDFRef.of(tree)),
    Count: parts.reduce((sum, part) => sum + part.pages, 0),
  }));
  const roots = serializeObjects(context.enumerateIndirectObjects(), last.bytes);
  const xrefOffset = last.bytes + roots.bytes.length;
  const xrefNumber = last.objectNumber + 1;
  // An xref stream stores 64-bit byte offsets and works for large consolidated PDFs.
  const table = Buffer.alloc((xrefNumber + 1) * 11);
  table.writeUInt16BE(65535, 9);
  const record = (object: number, offset: number) => {
    const index = object * 11;
    table[index] = 1;
    table.writeBigUInt64BE(BigInt(offset), index + 1);
  };
  for (const part of parts) for (const [object, offset] of part.offsets) record(object, offset);
  for (const [object, offset] of roots.offsets) record(object, offset);
  record(xrefNumber, xrefOffset);
  const xref = context.flateStream(table, { Type: "XRef", Size: xrefNumber + 1, Root: catalog, W: [1, 8, 2] });
  const bytes = Buffer.concat([
    roots.bytes,
    serializeObjects([[PDFRef.of(xrefNumber), xref]], xrefOffset).bytes,
    Buffer.from(`startxref\n${xrefOffset}\n%%EOF\n`),
  ]);
  return { bytes, totalBytes: last.bytes + bytes.length, crc32: crc32(bytes, last.crc32) };
}
