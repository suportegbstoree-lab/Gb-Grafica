export interface OrderTracking {
  provider: 'correios'; code: string; status: string; updatedAt: string;
  eventAt?: string; eventCode?: string; eventType?: string; deliveredAt?: string;
}
export function validTrackingCode(value: unknown): value is string { return typeof value === 'string' && /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(value); }
