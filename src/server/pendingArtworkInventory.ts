const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_ARTWORK_PATH = /^artworks\/([^/]+)\/pending\/[^/]+$/;

export interface InventoryObject {
  name: string;
  metadata?: { size?: unknown; timeCreated?: unknown };
}

export interface InventoryPage {
  objects: InventoryObject[];
  nextPageToken?: string | null;
}

export type InventoryPageReader = (options: {
  prefix: string;
  maxResults: number;
  pageToken?: string;
}) => Promise<InventoryPage>;

export interface PendingArtworkInventory {
  complete: boolean;
  objectsScanned: number;
  pendingObjects: number;
  owners: number;
  knownBytes: number;
  unknownSizes: number;
  age: { underDay: number; underWeek: number; underMonth: number; older: number; unknown: number };
  objectsPerOwner: { p50: number; p90: number; p99: number; maximum: number };
  bytesPerOwner: { p50: number; p90: number; p99: number; maximum: number };
}

function integerSize(value: unknown): number | null {
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function distribution(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const percentile = (fraction: number) => ordered.length
    ? ordered[Math.ceil(ordered.length * fraction) - 1]
    : 0;
  return {
    p50: percentile(0.5),
    p90: percentile(0.9),
    p99: percentile(0.99),
    maximum: ordered.at(-1) ?? 0,
  };
}

/** Relatório agregado: identificadores de clientes e nomes de arquivo não são devolvidos. */
export async function collectPendingArtworkInventory(
  readPage: InventoryPageReader,
  options: { maxObjects: number; pageSize?: number; now?: number },
): Promise<PendingArtworkInventory> {
  const { maxObjects, pageSize = 1000, now = Date.now() } = options;
  if (!Number.isSafeInteger(maxObjects) || maxObjects < 1 || maxObjects > 200_000 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000 || !Number.isFinite(now)) {
    throw new Error('Parâmetros inválidos para o relatório de artes pendentes.');
  }

  const ownerTotals = new Map<string, { objects: number; bytes: number }>();
  const age = { underDay: 0, underWeek: 0, underMonth: 0, older: 0, unknown: 0 };
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  let objectsScanned = 0;
  let pendingObjects = 0;
  let knownBytes = 0;
  let unknownSizes = 0;
  let complete = false;
  let emptyPages = 0;

  while (objectsScanned < maxObjects) {
    const maxResults = Math.min(pageSize, maxObjects - objectsScanned);
    const page = await readPage({ prefix: 'artworks/', maxResults, ...(pageToken ? { pageToken } : {}) });
    if (!Array.isArray(page.objects) || page.objects.length > maxResults) {
      throw new Error('A listagem retornou uma página inválida.');
    }
    if (page.objects.length === 0) emptyPages += 1;
    else emptyPages = 0;
    if (emptyPages > 5) throw new Error('A listagem retornou páginas vazias em excesso.');
    objectsScanned += page.objects.length;

    for (const object of page.objects) {
      const match = typeof object.name === 'string' ? PENDING_ARTWORK_PATH.exec(object.name) : null;
      if (!match) continue;
      pendingObjects += 1;
      const owner = ownerTotals.get(match[1]) ?? { objects: 0, bytes: 0 };
      owner.objects += 1;
      const size = integerSize(object.metadata?.size);
      if (size === null) unknownSizes += 1;
      else {
        knownBytes += size;
        owner.bytes += size;
        if (!Number.isSafeInteger(knownBytes) || !Number.isSafeInteger(owner.bytes)) {
          throw new Error('A soma de tamanhos excedeu o limite seguro do relatório.');
        }
      }
      ownerTotals.set(match[1], owner);

      const createdAt = typeof object.metadata?.timeCreated === 'string'
        ? Date.parse(object.metadata.timeCreated)
        : NaN;
      const ageMs = now - createdAt;
      if (!Number.isFinite(ageMs) || ageMs < 0) age.unknown += 1;
      else if (ageMs < DAY_MS) age.underDay += 1;
      else if (ageMs < 7 * DAY_MS) age.underWeek += 1;
      else if (ageMs < 30 * DAY_MS) age.underMonth += 1;
      else age.older += 1;
    }

    if (page.nextPageToken == null) {
      complete = true;
      break;
    }
    if (typeof page.nextPageToken !== 'string' || !page.nextPageToken || seenTokens.has(page.nextPageToken)) {
      throw new Error('A listagem retornou uma paginação inválida.');
    }
    seenTokens.add(page.nextPageToken);
    pageToken = page.nextPageToken;
  }

  const totals = [...ownerTotals.values()];
  return {
    complete,
    objectsScanned,
    pendingObjects,
    owners: totals.length,
    knownBytes,
    unknownSizes,
    age,
    objectsPerOwner: distribution(totals.map(value => value.objects)),
    bytesPerOwner: distribution(totals.map(value => value.bytes)),
  };
}
