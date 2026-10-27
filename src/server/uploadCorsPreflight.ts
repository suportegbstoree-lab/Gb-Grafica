// Cabeçalhos do protótipo de upload assinado. O teste é apenas preparatório:
// ele não garante que um upload real ou a política de cotas funcionem.
export const SIGNED_UPLOAD_HEADERS = [
  'content-type',
  'x-goog-content-length-range',
  'x-goog-if-generation-match',
  'x-goog-meta-kind',
  'x-goog-meta-ownerid',
] as const;

export function parsePreflightOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Origem inválida.'); }
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Informe uma origem HTTPS, sem caminho, usuário ou senha.');
  }
  return url.origin;
}

function headerTokens(value: string | null): string[] {
  return (value ?? '').split(',').map(token => token.trim().toLowerCase()).filter(Boolean);
}

export function evaluateUploadCors(response: Response, origin: string) {
  const allowedOrigin = response.headers.get('access-control-allow-origin');
  const methods = headerTokens(response.headers.get('access-control-allow-methods'));
  const headers = headerTokens(response.headers.get('access-control-allow-headers'));
  const originAllowed = allowedOrigin === origin || allowedOrigin === '*';
  const methodAllowed = methods.includes('put') || methods.includes('*');
  const missingHeaders = headers.includes('*')
    ? []
    : SIGNED_UPLOAD_HEADERS.filter(name => !headers.includes(name));
  return { httpOk: response.ok, originAllowed, methodAllowed, missingHeaders };
}

/** Envia somente uma solicitação OPTIONS, sem credenciais e sem criar objetos. */
export async function checkUploadCors(
  bucket: string,
  origin: string,
  fetchImpl: typeof fetch = fetch,
) {
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket)) {
    throw new Error('Nome de bucket inválido.');
  }
  const normalizedOrigin = parsePreflightOrigin(origin);
  const url = `https://storage.googleapis.com/${bucket}/__gb_grafica_cors_preflight__`;
  const response = await fetchImpl(url, {
    method: 'OPTIONS',
    headers: {
      Origin: normalizedOrigin,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': SIGNED_UPLOAD_HEADERS.join(','),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  return evaluateUploadCors(response, normalizedOrigin);
}
