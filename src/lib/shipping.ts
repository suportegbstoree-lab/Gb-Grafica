/** Dados físicos da unidade vendida e da embalagem pronta para postagem. */
export interface ProductShippingProfile {
  unitWeightGrams: number;
  packagingWeightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  unitsPerParcel: number;
}

export interface ShippingParcel {
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface ShippingOption {
  service_code: string;
  service_name: 'PAC' | 'SEDEX';
  amount_cents: number;
  delivery_days: number;
  home_delivery: boolean;
  saturday_delivery: boolean;
}

export interface ShippingQuoteResponse {
  cep: string;
  address: string;
  state: string;
  street: string;
  neighborhood: string;
  city: string;
  amount_cents: number;
  options: ShippingOption[];
  parcel_count: number;
  quoted_at: string;
  expires_at: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validShippingParcel(value: ShippingParcel): boolean {
  return Number.isSafeInteger(value.weightGrams) && value.weightGrams >= 1 && value.weightGrams <= 30_000
    && [value.lengthCm, value.widthCm, value.heightCm].every(n => Number.isFinite(n) && n <= 100)
    && value.lengthCm >= 11 && value.widthCm >= 6 && value.heightCm >= 0.4
    && value.lengthCm + value.widthCm + value.heightCm <= 200;
}

export function parseShippingProfile(value: unknown): ProductShippingProfile | null {
  if (!isRecord(value)) return null;
  const { unitWeightGrams, packagingWeightGrams, lengthCm, widthCm, heightCm, unitsPerParcel } = value;
  if (![unitWeightGrams, packagingWeightGrams, lengthCm, widthCm, heightCm, unitsPerParcel]
    .every(n => typeof n === 'number' && Number.isFinite(n))) return null;
  const profile = { unitWeightGrams, packagingWeightGrams, lengthCm, widthCm, heightCm, unitsPerParcel } as ProductShippingProfile;
  if (!Number.isSafeInteger(profile.unitWeightGrams) || profile.unitWeightGrams < 1
    || !Number.isSafeInteger(profile.packagingWeightGrams) || profile.packagingWeightGrams < 0
    || !Number.isSafeInteger(profile.unitsPerParcel) || profile.unitsPerParcel < 1 || profile.unitsPerParcel > 999
    || !validShippingParcel({ ...profile, weightGrams: profile.unitWeightGrams * profile.unitsPerParcel + profile.packagingWeightGrams })) return null;
  return profile;
}

/** Capacidade informada pelo lojista: não presume encaixe por volume ou mistura produtos. */
export function parcelsForProfile(profile: ProductShippingProfile, quantity: number): ShippingParcel[] {
  const parcels: ShippingParcel[] = [];
  for (let remaining = quantity; remaining > 0; remaining -= profile.unitsPerParcel) {
    const units = Math.min(remaining, profile.unitsPerParcel);
    parcels.push({
      weightGrams: units * profile.unitWeightGrams + profile.packagingWeightGrams,
      lengthCm: profile.lengthCm, widthCm: profile.widthCm, heightCm: profile.heightCm,
    });
  }
  return parcels;
}
