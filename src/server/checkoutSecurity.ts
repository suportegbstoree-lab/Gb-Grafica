import { createHash } from 'node:crypto';

export type PagBankEnvironment = 'sandbox' | 'production';

export function normalizeCheckoutRequestId(value: unknown): string | null {
  const requestId = typeof value === 'string' ? value.replace(/-/g, '').toLowerCase() : '';
  return /^[a-f0-9]{32}$/.test(requestId) ? requestId : null;
}

export function checkoutRequestDocumentId(userId: string, requestId: string): string {
  return createHash('sha256').update(`${userId}:${requestId}`).digest('hex');
}

export function trustedPagBankPayLink(value: unknown, environment: PagBankEnvironment): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password) return null;

    const allowedHosts = environment === 'sandbox'
      ? new Set(['pagamento.sandbox.pagbank.com.br'])
      : new Set(['pagamento.pagseguro.uol.com.br', 'pagamento.pagbank.com.br']);
    return allowedHosts.has(parsed.hostname) ? parsed.toString() : null;
  } catch {
    return null;
  }
}
