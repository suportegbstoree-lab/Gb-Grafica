import { createHash } from "node:crypto";
import { staffPdfOutputName } from "../lib/staffPdf.js";
import type { StaffPdfArchiveProgress } from "../lib/staffPdfBatch.js";
import type { StaffDocumentDeps } from "./staffDocuments.js";

type StorageBucket = ReturnType<StaffDocumentDeps["services"]>["bucket"];
type StorageFile = ReturnType<StorageBucket["file"]>;

export interface StaffPdfArchiveEntry {
  name: string;
  bytes: number;
  crc32: number;
  generation: string;
}

const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;
const WINDOWS_DATE = 33; // 1980-01-01 in ZIP's DOS date format.
const STORE_UTF8 = 0x0800;
const FILES_PER_PART = 15; // Cloud Storage composes up to 32 sources per operation.
const COMPOSE_SOURCES = 32;

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
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(STORE_UTF8, 6);
    local.writeUInt16LE(WINDOWS_DATE, 12);
    local.writeUInt32LE(crc32, 14);
    local.writeUInt32LE(bytes, 18);
    local.writeUInt32LE(bytes, 22);
    local.writeUInt16LE(encoded.length, 26);

    const central = Buffer.alloc(46);
    const wideOffset = offset >= U32_MAX;
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(wideOffset ? 45 : 20, 4);
    central.writeUInt16LE(wideOffset ? 45 : 20, 6);
    central.writeUInt16LE(STORE_UTF8, 8);
    central.writeUInt16LE(WINDOWS_DATE, 14);
    central.writeUInt32LE(crc32, 16);
    central.writeUInt32LE(bytes, 20);
    central.writeUInt32LE(bytes, 24);
    central.writeUInt16LE(encoded.length, 28);
    central.writeUInt32LE(wideOffset ? U32_MAX : offset, 42);
    directory.push(central, encoded);
    if (wideOffset) {
      const extra = Buffer.alloc(12);
      central.writeUInt16LE(extra.length, 30);
      extra.writeUInt16LE(1, 0);
      extra.writeUInt16LE(8, 2);
      extra.writeBigUInt64LE(BigInt(offset), 4);
      directory.push(extra);
    }
    offset += local.length + encoded.length + bytes;
    return Buffer.concat([local, encoded]);
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

export function staffPdfBatchArchivePath(batchId: string, fingerprint: string) {
  return `staff-pdf-batches/${batchId}/archives/${fingerprint}.zip`;
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

export async function composeStaffPdfArchive(
  bucket: StorageBucket,
  batchId: string,
  entries: (StaffPdfArchiveEntry & { id: string })[],
  progress?: StaffPdfArchiveProgress,
) {
  const fingerprint = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  const archive = bucket.file(staffPdfBatchArchivePath(batchId, fingerprint));
  const prefix = archive.name.slice(0, -4);
  if ((await archive.exists())[0]) return { archive, fingerprint };
  const { localHeaders, directory } = staffPdfZipEntries(entries);
  const parts = Math.ceil(entries.length / FILES_PER_PART);
  const part = (index: number) => bucket.file(`${prefix}/part-${index}`);
  const write = (file: StorageFile, bytes: Buffer) => createOnce(() => file.save(bytes, {
    resumable: false,
    preconditionOpts: { ifGenerationMatch: 0 },
  }));
  const combine = (sources: StorageFile[], dest: StorageFile) =>
    createOnce(() => bucket.combine(sources, dest, { ifGenerationMatch: 0 }));

  // Keep each request short. Deterministic object names make retries safe.
  const start = progress?.fingerprint === fingerprint ? Math.min(progress.cursor, parts - 1) : 0;
  const end = Math.min(start + 12, parts);
  for (let index = start; index < end; index += 4) {
    await Promise.all(Array.from({ length: Math.min(4, end - index) }, async (_, j) => {
      const current = index + j;
      const dest = part(current);
      if ((await dest.exists())[0]) return;
      const offset = current * FILES_PER_PART;
      const rows = entries.slice(offset, offset + FILES_PER_PART);
      const headers = await Promise.all(rows.map(async (_, i) => {
        const header = bucket.file(`${prefix}/header-${offset + i}`);
        await write(header, localHeaders[offset + i]);
        return header;
      }));
      const sources = rows.flatMap((row, i) => [
        headers[i],
        bucket.file(staffPdfBatchFilePath(batchId, row.id), { generation: row.generation }),
      ]);
      if (current === parts - 1) {
        const footer = bucket.file(`${prefix}/directory`);
        await write(footer, directory);
        sources.push(footer);
      }
      await combine(sources, dest);
    }));
  }
  if (end < parts) return { cursor: end, fingerprint };
  let level = Array.from({ length: parts }, (_, index) => part(index));
  for (let depth = 0; level.length > COMPOSE_SOURCES; depth++) {
    const next: StorageFile[] = [];
    for (let offset = 0; offset < level.length; offset += COMPOSE_SOURCES) {
      const dest = bucket.file(`${prefix}/level-${depth}-${offset}`);
      await combine(level.slice(offset, offset + COMPOSE_SOURCES), dest);
      next.push(dest);
    }
    level = next;
  }
  await combine(level, archive);
  return { archive, fingerprint };
}
