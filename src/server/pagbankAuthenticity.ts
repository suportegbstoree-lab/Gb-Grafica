import { createHash, timingSafeEqual } from 'node:crypto';

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
