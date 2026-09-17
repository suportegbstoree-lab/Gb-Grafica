import { createHash, timingSafeEqual } from 'node:crypto';

export type PagBankAuthenticityFailureReason =
  | 'raw_body_missing'
  | 'header_missing'
  | 'header_format_invalid'
  | 'signature_mismatch';

export function verifyPagBankAuthenticity(
  token: string,
  rawBody: string,
  receivedToken: string,
): boolean {
  if (!token || !rawBody || !/^[a-f0-9]{64}$/i.test(receivedToken)) return false;
  const expected = createHash('sha256').update(`${token}-${rawBody}`, 'utf8').digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(receivedToken.toLowerCase(), 'utf8');
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function pagBankAuthenticityFailureReason(
  token: string,
  rawBody: unknown,
  receivedToken: unknown,
): PagBankAuthenticityFailureReason | null {
  if (typeof rawBody !== 'string' || !rawBody) return 'raw_body_missing';
  if (typeof receivedToken !== 'string' || !receivedToken.trim()) return 'header_missing';
  const normalizedToken = receivedToken.trim();
  if (!/^[a-f0-9]{64}$/i.test(normalizedToken)) return 'header_format_invalid';
  return verifyPagBankAuthenticity(token, rawBody, normalizedToken)
    ? null
    : 'signature_mismatch';
}
