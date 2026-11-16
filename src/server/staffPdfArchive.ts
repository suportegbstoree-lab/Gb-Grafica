import { createHash } from "node:crypto";
import { staffPdfOutputName } from "../lib/staffPdf.js";
import type { StaffPdfArchiveFormat, StaffPdfArchiveProgress } from "../lib/staffPdfBatch.js";
import type { StaffDocumentDeps } from "./staffDocuments.js";
import { finishStaffPdfMerge, writeStaffPdfMergePart, type StaffPdfMergePart } from "./staffPdfConsolidated.js";

type StorageBucket = ReturnType<StaffDocumentDeps["services"]>["bucket"];
type StorageFile = ReturnType<StorageBucket["file"]>;

export interface StaffPdfArchiveEntry {
  name: string;
  bytes: number;
  crc32: number;
  generation: string;
}
type StoredPdf = StaffPdfArchiveEntry & { id: string };

export const STAFF_PDF_ARCHIVE_VERSION = 2;
const CONSOLIDATED_NAME = "Lote completo";
const MERGE_PART_FILES = 12;
const MERGE_PART_BYTES = 64 * 1024 * 1024;
const MERGE_PARTS_PER_REQUEST = 4;
const MERGE_REQUEST_MS = 20_000;

const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;
const WINDOWS_DATE = 33; // 1980-01-01 in ZIP's DOS date format.
const STORE_UTF8 = 0x0800;
const FILES_PER_PART = 15; // Cloud Storage composes up to 32 sources per operation.
const COMPOSE_SOURCES = 32;

function zip64Extra(values: number[]) {
  if (values.length === 0) return Buffer.alloc(0);
  const extra = Buffer.alloc(4 + 8 * values.length);
  extra.writeUInt16LE(1, 0);
  extra.writeUInt16LE(extra.length - 4, 2);
  values.forEach((value, i) => extra.writeBigUInt64LE(BigInt(value), 4 + i * 8));
  return extra;
}

export function staffPdfZipEntries(entries: Pick<StaffPdfArchiveEntry, "name" | "bytes" | "crc32">[]) {
  const names = new Set<string>();
  const nextSuffix = new Map<string, number>();
  const directory: Buffer[] = [];
  let offset = 0;
  const localHeaders = entries.map(({ name, bytes, crc32 }) => {
    const base = staffPdfOutputName(name) || "Documento";
    let fileName = `${base}.pdf`;
    const nameKey = base.toLowerCase();
    let copy = nextSuffix.get(nameKey) ?? 2;
    while (names.has(fileName.toLowerCase())) fileName = `${base} (${copy++}).pdf`;
    nextSuffix.set(nameKey, copy);
    names.add(fileName.toLowerCase());
    const encoded = Buffer.from(fileName, "utf8");
    const size = Math.min(bytes, U32_MAX);
    const sizes = bytes >= U32_MAX ? [bytes, bytes] : [];
    const localExtra = zip64Extra(sizes);
    const wideOffset = offset >= U32_MAX;
    const centralExtra = zip64Extra(wideOffset ? [...sizes, offset] : sizes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(localExtra.length ? 45 : 20, 4);
    local.writeUInt16LE(STORE_UTF8, 6);
    local.writeUInt16LE(WINDOWS_DATE, 12);
    local.writeUInt32LE(crc32, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(encoded.length, 26);
    local.writeUInt16LE(localExtra.length, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(centralExtra.length ? 45 : 20, 4);
    central.writeUInt16LE(centralExtra.length ? 45 : 20, 6);
    central.writeUInt16LE(STORE_UTF8, 8);
    central.writeUInt16LE(WINDOWS_DATE, 14);
    central.writeUInt32LE(crc32, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(encoded.length, 28);
    central.writeUInt16LE(centralExtra.length, 30);
    central.writeUInt32LE(wideOffset ? U32_MAX : offset, 42);
    directory.push(central, encoded, centralExtra);
    offset += local.length + encoded.length + localExtra.length + bytes;
    return Buffer.concat([local, encoded, localExtra]);
  });
  const directorySize = directory.reduce((size, entry) => size + entry.length, 0);
  if (offset >= U32_MAX || directorySize >= U32_MAX || entries.length >= U16_MAX) {
    const zip64 = Buffer.alloc(56);
    zip64.writeUInt32LE(0x06064b50, 0);
    zip64.writeBigUInt64LE(44n, 4);
    zip64.writeUInt16LE(45, 12);
    zip64.writeUInt16LE(45, 14);
    zip64.writeBigUInt64LE(BigInt(entries.length), 24);
    zip64.writeBigUInt64LE(BigInt(entries.length), 32);
    zip64.writeBigUInt64LE(BigInt(directorySize), 40);
    zip64.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + directorySize), 8);
    locator.writeUInt32LE(1, 16);
    directory.push(zip64, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Math.min(entries.length, U16_MAX), 8);
  end.writeUInt16LE(Math.min(entries.length, U16_MAX), 10);
  end.writeUInt32LE(Math.min(directorySize, U32_MAX), 12);
  end.writeUInt32LE(Math.min(offset, U32_MAX), 16);
  directory.push(end);
  return { localHeaders, directory: Buffer.concat(directory) };
}

export function staffPdfBatchArchivePath(batchId: string, fingerprint: string, format: StaffPdfArchiveFormat = "zip") {
  const prefix = `staff-pdf-batches/${batchId}/archives/${fingerprint}`;
  return format === "pdf" ? `${prefix}/consolidated.pdf` : `${prefix}.zip`;
}

export function staffPdfBatchFilePath(batchId: string, itemId: string) {
  return `staff-pdf-batches/${batchId}/files/${itemId}.pdf`;
}

export function staffPdfAttachment(name: string, extension: "pdf" | "zip") {
  const filename = `${staffPdfOutputName(name) || "Documento"}.${extension}`;
  const encoded = encodeURIComponent(Buffer.from(filename).toString("utf8")).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
  return `attachment; filename="arquivo.${extension}"; filename*=UTF-8''${encoded}`;
}

async function createOnce(write: () => Promise<unknown>) {
  try {
    await write();
  } catch (error) {
    if (Number((error as { code?: number })?.code) !== 412) throw error;
  }
}

function write(file: StorageFile, bytes: Buffer) {
  return createOnce(() => file.save(bytes, {
    resumable: false,
    preconditionOpts: { ifGenerationMatch: 0 },
  }));
}

async function readJson<T>(file: StorageFile): Promise<T | undefined> {
  try {
    const [bytes] = await file.download();
    return JSON.parse(bytes.toString());
  } catch (error) {
    if (Number((error as { code?: number })?.code) !== 404) throw error;
  }
}

function combine(bucket: StorageBucket, sources: StorageFile[], dest: StorageFile) {
  return createOnce(() => bucket.combine(sources, dest, { ifGenerationMatch: 0 }));
}

async function combineParts(bucket: StorageBucket, parts: StorageFile[], dest: StorageFile) {
  let level = parts;
  for (let depth = 0; level.length > COMPOSE_SOURCES; depth++) {
    const next: StorageFile[] = [];
    for (let offset = 0; offset < level.length; offset += COMPOSE_SOURCES) {
      const intermediate = bucket.file(`${dest.name}.parts/level-${depth}-${offset}`);
      await combine(bucket, level.slice(offset, offset + COMPOSE_SOURCES), intermediate);
      next.push(intermediate);
    }
    level = next;
  }
  await combine(bucket, level, dest);
}

function mergeGroups(entries: StoredPdf[]) {
  const groups: StoredPdf[][] = [];
  let group: StoredPdf[] = [];
  let bytes = 0;
  for (const entry of entries) {
    if (group.length === MERGE_PART_FILES || (group.length && bytes + entry.bytes > MERGE_PART_BYTES)) {
      groups.push(group);
      group = [];
      bytes = 0;
    }
    group.push(entry);
    bytes += entry.bytes;
  }
  if (group.length) groups.push(group);
  return groups;
}

type ConsolidatedPdf = Pick<StaffPdfArchiveEntry, "bytes" | "crc32">;

async function prepareConsolidatedPdf(
  bucket: StorageBucket,
  prefix: string,
  entries: StoredPdf[],
  source: (row: StoredPdf) => StorageFile,
  cursor: number,
): Promise<{ file: StorageFile; metadata: ConsolidatedPdf } | { cursor: number }> {
  const file = bucket.file(`${prefix}/consolidated.pdf`);
  const metadataFile = bucket.file(`${prefix}/consolidated.json`);
  const cached = await readJson<ConsolidatedPdf>(metadataFile);
  if (cached) return { file, metadata: cached };

  const groups = mergeGroups(entries);
  const dataFile = (i: number) => bucket.file(`${prefix}/merge/part-${i}`);
  const manifest = (i: number) => bucket.file(`${prefix}/merge/part-${i}.json`);
  let index = Math.min(cursor, groups.length);
  let previous = index > 0 ? await readJson<StaffPdfMergePart>(manifest(index - 1)) : undefined;
  if (!previous) index = 0;
  const end = Math.min(index + MERGE_PARTS_PER_REQUEST, groups.length);
  const deadline = Date.now() + MERGE_REQUEST_MS;
  for (; index < end; index++) {
    const saved = await readJson<StaffPdfMergePart>(manifest(index));
    if (saved) {
      previous = saved;
    } else {
      const rows = groups[index];
      async function* readPdfs() {
        for (let offset = 0; offset < rows.length; offset += 4) {
          const files = await Promise.all(rows.slice(offset, offset + 4).map((row) => source(row).download()));
          for (const [bytes] of files) yield bytes;
        }
      }
      const part = await writeStaffPdfMergePart(readPdfs(), previous);
      await write(dataFile(index), part.bytes);
      await write(manifest(index), Buffer.from(JSON.stringify(part.part)));
      previous = part.part;
    }
    if (Date.now() >= deadline && index + 1 < groups.length) return { cursor: index + 1 };
  }
  if (index < groups.length) return { cursor: index };

  const parts: StaffPdfMergePart[] = [];
  for (let offset = 0; offset < groups.length; offset += 16) {
    const group = await Promise.all(groups.slice(offset, offset + 16).map((_, i) =>
      readJson<StaffPdfMergePart>(manifest(offset + i)),
    ));
    for (const part of group) {
      if (!part) throw new Error("Parte do PDF consolidado não encontrada.");
      parts.push(part);
    }
  }
  const result = finishStaffPdfMerge(parts);
  const footer = bucket.file(`${prefix}/merge/footer`);
  await write(footer, result.bytes);
  await combineParts(bucket, [...parts.map((_, i) => dataFile(i)), footer], file);
  const metadata = { bytes: result.totalBytes, crc32: result.crc32 };
  await write(metadataFile, Buffer.from(JSON.stringify(metadata)));
  return { file, metadata };
}

export async function composeStaffPdfArchive(
  bucket: StorageBucket,
  batchId: string,
  entries: StoredPdf[],
  format: StaffPdfArchiveFormat,
  progress?: StaffPdfArchiveProgress,
): Promise<{ file: StorageFile; fingerprint: string } | { progress: StaffPdfArchiveProgress }> {
  const fingerprint = createHash("sha256").update(JSON.stringify([STAFF_PDF_ARCHIVE_VERSION, entries])).digest("hex");
  const archive = bucket.file(staffPdfBatchArchivePath(batchId, fingerprint));
  const prefix = archive.name.slice(0, -4);
  if (format === "zip" && (await archive.exists())[0]) return { file: archive, fingerprint };
  const resume = progress?.fingerprint === fingerprint ? progress : undefined;
  const source = (row: StoredPdf) => bucket.file(staffPdfBatchFilePath(batchId, row.id), { generation: row.generation });
  const consolidated = await prepareConsolidatedPdf(bucket, prefix, entries, source, resume?.stage === "merge" ? resume.cursor : 0);
  if ("cursor" in consolidated) return { progress: { stage: "merge", cursor: consolidated.cursor, fingerprint } };
  if (format === "pdf") return { file: consolidated.file, fingerprint };
  const zipEntries = [{ name: CONSOLIDATED_NAME, ...consolidated.metadata, file: consolidated.file },
    ...entries.map((entry) => ({ ...entry, file: source(entry) }))];
  const { localHeaders, directory } = staffPdfZipEntries(zipEntries);
  const parts = Math.ceil(zipEntries.length / FILES_PER_PART);
  const part = (index: number) => bucket.file(`${prefix}/part-${index}`);

  // Keep each request short. Deterministic object names make retries safe.
  const start = resume?.stage === "zip" ? Math.min(resume.cursor, parts - 1) : 0;
  const end = Math.min(start + 12, parts);
  for (let index = start; index < end; index += 4) {
    await Promise.all(Array.from({ length: Math.min(4, end - index) }, async (_, j) => {
      const current = index + j;
      const dest = part(current);
      if ((await dest.exists())[0]) return;
      const offset = current * FILES_PER_PART;
      const rows = zipEntries.slice(offset, offset + FILES_PER_PART);
      const headers = await Promise.all(rows.map(async (_, i) => {
        const header = bucket.file(`${prefix}/header-${offset + i}`);
        await write(header, localHeaders[offset + i]);
        return header;
      }));
      const sources = rows.flatMap((row, i) => [headers[i], row.file]);
      if (current === parts - 1) {
        const footer = bucket.file(`${prefix}/directory`);
        await write(footer, directory);
        sources.push(footer);
      }
      await combine(bucket, sources, dest);
    }));
  }
  if (end < parts) return { progress: { stage: "zip", cursor: end, fingerprint } };
  await combineParts(bucket, Array.from({ length: parts }, (_, index) => part(index)), archive);
  return { file: archive, fingerprint };
}
