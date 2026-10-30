/** Physical dimensions describe the finished trim; the source image includes bleed. */
export interface PrintProfile {
  widthMm: number;
  heightMm: number;
  bleedMm: number;
  safeMarginMm: number;
  targetDpi: number;
}

export interface ArtworkApproval {
  version: 1;
  acceptedAt: string;
  userId: string;
  modelGeneration: number;
  backGeneration?: number;
  designFingerprint: string;
}

export function parsePrintProfile(value: unknown): PrintProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const limits: Array<[keyof PrintProfile, number, number]> = [
    ['widthMm', 10, 2000], ['heightMm', 10, 2000], ['bleedMm', 0, 20],
    ['safeMarginMm', 0, 50], ['targetDpi', 72, 1200],
  ];
  if (limits.some(([key, min, max]) => typeof record[key] !== 'number' || !Number.isFinite(record[key]) || (record[key] as number) < min || (record[key] as number) > max)) return null;
  const profile = Object.fromEntries(limits.map(([key]) => [key, Math.round((record[key] as number) * 100) / 100])) as unknown as PrintProfile;
  if (2 * profile.safeMarginMm >= Math.min(profile.widthMm, profile.heightMm)) return null;
  return profile;
}

export function printProfileKey(value?: PrintProfile | null): string {
  return value ? JSON.stringify([value.widthMm, value.heightMm, value.bleedMm, value.safeMarginMm, value.targetDpi]) : '';
}

export function printGeometry(profile: PrintProfile) {
  const widthMm = profile.widthMm + 2 * profile.bleedMm;
  const heightMm = profile.heightMm + 2 * profile.bleedMm;
  return {
    widthMm, heightMm,
    trim: { x: profile.bleedMm / widthMm * 100, y: profile.bleedMm / heightMm * 100, width: profile.widthMm / widthMm * 100, height: profile.heightMm / heightMm * 100 },
    safe: { x: (profile.bleedMm + profile.safeMarginMm) / widthMm * 100, y: (profile.bleedMm + profile.safeMarginMm) / heightMm * 100, width: (profile.widthMm - 2 * profile.safeMarginMm) / widthMm * 100, height: (profile.heightMm - 2 * profile.safeMarginMm) / heightMm * 100 },
  };
}

export function printImageQuality(profile: PrintProfile, width: number, height: number) {
  const geometry = printGeometry(profile);
  const validDimensions = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  const ratioMatches = validDimensions && Math.abs((width / height) / (geometry.widthMm / geometry.heightMm) - 1) <= 0.01;
  const dpi = validDimensions ? Math.min(width / (geometry.widthMm / 25.4), height / (geometry.heightMm / 25.4)) : 0;
  return {
    ratioMatches, dpi,
    belowTarget: dpi + 0.5 < profile.targetDpi,
    recommendedWidth: Math.ceil(geometry.widthMm / 25.4 * profile.targetDpi),
    recommendedHeight: Math.ceil(geometry.heightMm / 25.4 * profile.targetDpi),
  };
}

export function isInsideSafeArea(profile: PrintProfile, box: { x: number; y: number; width: number; height: number }): boolean {
  const { safe } = printGeometry(profile);
  return box.x >= safe.x && box.y >= safe.y && box.x + box.width <= safe.x + safe.width && box.y + box.height <= safe.y + safe.height;
}

export function printProfileLabel(profile: PrintProfile): string {
  return `${profile.widthMm} × ${profile.heightMm} mm · sangria ${profile.bleedMm} mm · margem segura ${profile.safeMarginMm} mm`;
}
