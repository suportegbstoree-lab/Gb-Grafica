export interface ApiErrorPayload {
  error?: unknown;
  code?: unknown;
  request_id?: unknown;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function apiErrorMessage(payload: ApiErrorPayload, fallback: string): string {
  const message = typeof payload.error === 'string' && payload.error.trim()
    ? payload.error.trim()
    : fallback;
  const requestId = typeof payload.request_id === 'string' && REQUEST_ID_PATTERN.test(payload.request_id)
    ? payload.request_id
    : '';

  return requestId ? `${message} Referência: ${requestId}` : message;
}
