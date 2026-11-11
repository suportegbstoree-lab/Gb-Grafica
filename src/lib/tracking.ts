export interface OrderTracking {
  provider: 'correios' | 'melhor_envio'; code: string; status: string; updatedAt: string;
  eventAt?: string; eventCode?: string; eventType?: string; deliveredAt?: string;
}
export function validTrackingCode(value: unknown): value is string { return typeof value === 'string' && /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(value); }
export function validMelhorEnvioTrackingCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(value);
}
