import { createHash } from 'node:crypto';
import type { DocumentReference } from 'firebase-admin/firestore';

export const nfeAuthorizationRef = (order: DocumentReference) => order.collection('fiscal').doc('authorization');

// This contract is written by a trusted fiscal integration after confirming the result for this order.
export function readNfeLabelAuthorization(orderId: string, data?: Record<string, unknown>) {
  if (data?.orderId !== orderId || data.environment !== 'production' || data.source !== 'provider' ||
    (data.status !== 'authorized' && data.status !== 'canceled') ||
    typeof data.accessKey !== 'string' || !/^\d{44}$/.test(data.accessKey) ||
    typeof data.reference !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.reference) ||
    typeof data.protocol !== 'string' || !data.protocol.trim()) return null;
  const fingerprint = createHash('sha256').update(data.reference + ':' + data.accessKey).digest('hex');
  return { status: data.status, accessKey: data.accessKey, fingerprint };
}
