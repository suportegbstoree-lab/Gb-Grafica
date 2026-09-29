import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

type LogLevel = 'info' | 'warn' | 'error';
type LogFields = Record<string, unknown>;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|token|secret|password|private[_-]?key|cpf|tax[_-]?id|document|email|phone|telefone|celular|customer|cliente|address|endere[cç]o|street|neighborhood|bairro|complement|postal|cep|card|holder)/i;
const MAX_STRING_LENGTH = 1_000;
const MAX_ARRAY_LENGTH = 25;
const MAX_OBJECT_KEYS = 50;
const MAX_DEPTH = 5;

function redactSensitiveText(value: string): string {
  return value
    .replace(/-----BEGIN[\s\S]*?PRIVATE KEY-----/gi, '[PRIVATE_KEY_REDACTED]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:token|access_token|secret|password|authorization)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_REDACTED]')
    .replace(/(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g, '[DOCUMENT_REDACTED]')
    .replace(/(?<!\d)(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}(?!\d)/g, '[PHONE_REDACTED]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, MAX_STRING_LENGTH);
}

export function sanitizeLogValue(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet<object>(),
): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactSensitiveText(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return undefined;
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]';

  if (value instanceof Error) {
    const errorRecord: LogFields = {
      error_name: value.name,
      error_message: redactSensitiveText(value.message),
    };
    const errorWithCode = value as Error & { code?: unknown; status?: unknown };
    if (typeof errorWithCode.code === 'string') errorRecord.error_code = redactSensitiveText(errorWithCode.code);
    if (typeof errorWithCode.status === 'number') errorRecord.error_status = errorWithCode.status;
    if (process.env.LOG_INCLUDE_STACK === 'true' && value.stack) {
      errorRecord.error_stack = redactSensitiveText(value.stack);
    }
    return errorRecord;
  }

  if (typeof value !== 'object') return redactSensitiveText(String(value));
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, MAX_ARRAY_LENGTH)
      .map(item => sanitizeLogValue(item, depth + 1, seen));
    if (value.length > MAX_ARRAY_LENGTH) sanitized.push(`[${value.length - MAX_ARRAY_LENGTH} MORE]`);
    return sanitized;
  }

  const sanitized: LogFields = {};
  const entries = Object.entries(value as LogFields).slice(0, MAX_OBJECT_KEYS);
  for (const [key, item] of entries) {
    const safeKey = redactSensitiveText(key).slice(0, 100);
    sanitized[safeKey] = SENSITIVE_KEY_PATTERN.test(key)
      ? '[REDACTED]'
      : sanitizeLogValue(item, depth + 1, seen);
  }
  if (Object.keys(value).length > MAX_OBJECT_KEYS) sanitized._truncated = true;
  return sanitized;
}

function configuredLogLevel(): LogLevel | 'silent' {
  const value = process.env.LOG_LEVEL?.trim().toLowerCase();
  return value === 'warn' || value === 'error' || value === 'silent' ? value : 'info';
}

function shouldLog(level: LogLevel): boolean {
  const configured = configuredLogLevel();
  if (configured === 'silent') return false;
  const priority: Record<LogLevel, number> = { info: 1, warn: 2, error: 3 };
  return priority[level] >= priority[configured];
}

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (!shouldLog(level)) return;
  const sanitizedFields = sanitizeLogValue(fields) as LogFields;
  const record = {
    ...sanitizedFields,
    timestamp: new Date().toISOString(),
    level,
    event: redactSensitiveText(event).replace(/\s+/g, '_').slice(0, 100),
  };
  const line = JSON.stringify(record);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function resolveRequestId(headerValue: unknown): string {
  if (typeof headerValue === 'string' && REQUEST_ID_PATTERN.test(headerValue)) return headerValue;
  return randomUUID();
}

export function responseRequestId(response: Response): string {
  const value = response.locals.requestId;
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value) ? value : randomUUID();
}

export function requestRequestId(request: Request): string {
  const value = (request as Request & { requestId?: unknown }).requestId;
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value) ? value : randomUUID();
}

function requestLogPath(request: Request): string {
  const route = request.route as { path?: unknown } | undefined;
  if (typeof route?.path === 'string') return `${request.baseUrl || ''}${route.path}`;
  return request.path;
}

export function requestObservability(request: Request, response: Response, next: NextFunction): void {
  const requestId = resolveRequestId(request.get('x-request-id'));
  const startedAt = process.hrtime.bigint();
  const shouldObserve = request.path === '/health' || request.path === '/api' || request.path.startsWith('/api/');

  response.locals.requestId = requestId;
  (request as Request & { requestId?: string }).requestId = requestId;
  response.setHeader('X-Request-Id', requestId);

  if (shouldObserve) {
    response.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const fields = {
        request_id: requestId,
        method: request.method,
        path: requestLogPath(request),
        status_code: response.statusCode,
        duration_ms: Number(durationMs.toFixed(2)),
      };
      if (response.statusCode >= 500) logEvent('error', 'http_request_completed', fields);
      else if (response.statusCode >= 400) logEvent('warn', 'http_request_completed', fields);
      else logEvent('info', 'http_request_completed', fields);
    });

    response.once('close', () => {
      if (response.writableEnded) return;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logEvent('warn', 'http_request_aborted', {
        request_id: requestId,
        method: request.method,
        path: request.path,
        duration_ms: Number(durationMs.toFixed(2)),
      });
    });
  }

  next();
}
