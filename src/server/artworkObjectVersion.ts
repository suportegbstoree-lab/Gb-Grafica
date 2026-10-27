import type { getAdminServices } from './firebaseAdmin.js';

export type ArtworkBucket = ReturnType<typeof getAdminServices>['bucket'];

/** Dados validados no servidor; nunca aceitar a geração informada pelo navegador. */
export interface ArtworkObjectVersion {
  path: string;
  generation: number;
  contentType: string;
  kind: 'source-artwork' | 'personalization-model';
  originalName: string;
}

export function parseArtworkObjectGeneration(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) return null;
  const generation = Number(value);
  return Number.isSafeInteger(generation) && generation > 0 ? generation : null;
}

/** Lê o mesmo objeto cuja geração foi obtida nos metadados validados. */
export async function readArtworkPrefix(bucket: ArtworkBucket, path: string, generation: number): Promise<Buffer> {
  const [prefix] = await bucket.file(path, { generation }).download({ start: 0, end: 15, validation: false });
  return prefix;
}

/** Cópia imutável com somente os metadados necessários ao pedido. */
export async function copyArtworkVersion(
  bucket: ArtworkBucket,
  source: ArtworkObjectVersion,
  destinationPath: string,
  userId: string,
): Promise<void> {
  await bucket.file(source.path, { generation: source.generation }).copy(bucket.file(destinationPath), {
    contentType: source.contentType,
    cacheControl: 'private, no-store',
    metadata: { ownerId: userId, kind: source.kind, originalName: source.originalName },
  });
}

/** Não apaga uma versão substituta criada com o mesmo nome após a validação. */
export async function deleteArtworkVersion(bucket: ArtworkBucket, source: ArtworkObjectVersion): Promise<void> {
  await bucket.file(source.path, { preconditionOpts: { ifGenerationMatch: source.generation } }).delete();
}
