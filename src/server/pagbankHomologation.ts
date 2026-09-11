import type { Firestore } from 'firebase-admin/firestore';

type PlainRecord = Record<string, unknown>;

const COLLECTION = '_pagbankHomologation';
const MAX_WEBHOOKS_PER_CHECKOUT = 25;
const RETENTION_MS = 14 * 24 * 60 * 60 * 1_000;
const SECRET_KEY_PATTERN = /(?:authorization|authenticity[_-]?token|token|secret|password|private[_-]?key)/i;

export const PAGBANK_HOMOLOGATION_COLLECTION = COLLECTION;

export interface CheckoutEvidenceInput {
  orderId: string;
  checkoutId?: string;
  requestId: string;
  requestUrl: string;
  requestBody: unknown;
  requestSentAt: string;
  responseStatus: number | null;
  responseBody: unknown;
  responseReceivedAt: string;
}

export interface WebhookEvidenceInput {
  orderId: string;
  eventHash: string;
  requestUrl: string;
  contentType: string;
  requestBody: unknown;
  requestReceivedAt: string;
  responseStatus: number;
  responseBody: unknown;
  responseSentAt: string;
}

export function isPagBankHomologationCaptureEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const pagbankEnvironment = environment.PAGBANK_ENV?.trim().toLowerCase() === 'production'
    ? 'production'
    : 'sandbox';
  return pagbankEnvironment === 'sandbox' &&
    environment.PAGBANK_HOMOLOGATION_CAPTURE?.trim().toLowerCase() === 'true';
}

export function buildPagBankCheckoutEvidence(input: CheckoutEvidenceInput): PlainRecord {
  assertOrderId(input.orderId);
  assertIsoDate(input.requestSentAt, 'data de envio do checkout');
  assertIsoDate(input.responseReceivedAt, 'data de resposta do checkout');
  assertSandboxCheckoutUrl(input.requestUrl);

  return {
    schema_version: 1,
    environment: 'sandbox',
    order_id: input.orderId,
    ...(input.checkoutId ? { checkout_id: input.checkoutId } : {}),
    updated_at: input.responseReceivedAt,
    expiresAt: new Date(Date.now() + RETENTION_MS),
    checkout: {
      request: {
        captured_at: input.requestSentAt,
        method: 'POST',
        url: input.requestUrl,
        headers: {
          Authorization: 'Bearer [REDACTED]',
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-idempotency-key': input.requestId,
        },
        body: sanitizeEvidenceValue(input.requestBody),
      },
      response: {
        captured_at: input.responseReceivedAt,
        status: normalizeStatus(input.responseStatus),
        body: sanitizeEvidenceValue(input.responseBody),
      },
    },
  };
}

export function buildPagBankWebhookEvidence(input: WebhookEvidenceInput): PlainRecord {
  assertOrderId(input.orderId);
  if (!/^[a-f0-9]{64}$/i.test(input.eventHash)) {
    throw new Error('Hash do webhook inválido para a evidência de homologação.');
  }
  assertIsoDate(input.requestReceivedAt, 'data de recebimento do webhook');
  assertIsoDate(input.responseSentAt, 'data de resposta do webhook');

  return {
    captured_at: input.requestReceivedAt,
    event_hash: input.eventHash,
    request: {
      method: 'POST',
      url: input.requestUrl,
      headers: {
        'Content-Type': input.contentType || 'application/json',
        'x-authenticity-token': '[REDACTED]',
      },
      body: sanitizeEvidenceValue(input.requestBody),
    },
    response: {
      captured_at: input.responseSentAt,
      status: normalizeStatus(input.responseStatus),
      body: sanitizeEvidenceValue(input.responseBody),
    },
  };
}

export async function savePagBankCheckoutEvidence(
  db: Firestore,
  input: CheckoutEvidenceInput,
): Promise<boolean> {
  if (!isPagBankHomologationCaptureEnabled()) return false;
  const evidence = buildPagBankCheckoutEvidence(input);
  await db.collection(COLLECTION).doc(input.orderId).set(evidence, { merge: true });
  return true;
}

export async function savePagBankWebhookEvidence(
  db: Firestore,
  input: WebhookEvidenceInput,
): Promise<boolean> {
  if (!isPagBankHomologationCaptureEnabled()) return false;
  const evidence = buildPagBankWebhookEvidence(input);
  const reference = db.collection(COLLECTION).doc(input.orderId);
  let stored = false;

  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data() as PlainRecord | undefined;
    const webhooks = isPlainRecord(data?.webhooks) ? data.webhooks : {};
    if (Object.prototype.hasOwnProperty.call(webhooks, input.eventHash)) return;
    if (Object.keys(webhooks).length >= MAX_WEBHOOKS_PER_CHECKOUT) {
      throw new Error('Limite de webhooks da evidência de homologação atingido.');
    }

    const metadata = {
      schema_version: 1,
      environment: 'sandbox',
      order_id: input.orderId,
      updated_at: input.responseSentAt,
      expiresAt: new Date(Date.now() + RETENTION_MS),
    };

    if (snapshot.exists) {
      transaction.update(reference, {
        ...metadata,
        [`webhooks.${input.eventHash}`]: evidence,
      });
    } else {
      transaction.set(reference, {
        ...metadata,
        webhooks: { [input.eventHash]: evidence },
      });
    }
    stored = true;
  });

  return stored;
}

export function formatPagBankHomologationReport(
  captures: unknown[],
  generatedAt = new Date().toISOString(),
): string {
  if (!captures.length) throw new Error('Nenhuma evidência foi informada para exportação.');
  assertIsoDate(generatedAt, 'data de geração do relatório');

  const lines = [
    'INTEGRAÇÃO: Checkout PagBank',
    'AMBIENTE: Sandbox',
    `RELATÓRIO GERADO EM: ${generatedAt}`,
    'SEGURANÇA: tokens de autenticação foram substituídos por [REDACTED].',
    '',
  ];

  captures.forEach((capture, captureIndex) => {
    const record = isPlainRecord(capture) ? capture : {};
    const orderId = stringValue(record.order_id);
    const checkout = isPlainRecord(record.checkout) ? record.checkout : null;
    const request = checkout && isPlainRecord(checkout.request) ? checkout.request : null;
    const response = checkout && isPlainRecord(checkout.response) ? checkout.response : null;
    if (!orderId || !request || !response) {
      throw new Error(`Evidência ${captureIndex + 1} não contém um checkout completo.`);
    }

    const methods = paymentMethodsFromRequest(request.body);
    lines.push(
      '='.repeat(78),
      `PEDIDO: ${orderId}`,
      `CHECKOUT: ${stringValue(record.checkout_id) || 'não informado'}`,
      `MEIOS DISPONIBILIZADOS: ${methods.length ? methods.join(', ') : 'não identificados'}`,
      '',
      'REQUEST ENVIADO AO PAGBANK',
      `${stringValue(request.method) || 'POST'} ${stringValue(request.url)}`,
      `Captured-At: ${stringValue(request.captured_at)}`,
      formatHeaders(request.headers),
      '',
      formatJson(request.body),
      '',
      'RESPONSE REAL DO PAGBANK',
      `HTTP ${statusLabel(response.status)}`,
      `Captured-At: ${stringValue(response.captured_at)}`,
      '',
      formatJson(response.body),
      '',
    );

    const webhooks = isPlainRecord(record.webhooks)
      ? Object.values(record.webhooks).filter(isPlainRecord).sort(compareCapturedAt)
      : [];

    if (!webhooks.length) {
      lines.push('WEBHOOKS: nenhum webhook autenticado foi capturado para este pedido.', '');
      return;
    }

    webhooks.forEach((webhook, webhookIndex) => {
      const webhookRequest = isPlainRecord(webhook.request) ? webhook.request : {};
      const webhookResponse = isPlainRecord(webhook.response) ? webhook.response : {};
      lines.push(
        `WEBHOOK ${webhookIndex + 1} — REQUEST RECEBIDO DO PAGBANK`,
        `${stringValue(webhookRequest.method) || 'POST'} ${stringValue(webhookRequest.url)}`,
        `Captured-At: ${stringValue(webhook.captured_at)}`,
        formatHeaders(webhookRequest.headers),
        '',
        formatJson(webhookRequest.body),
        '',
        `WEBHOOK ${webhookIndex + 1} — RESPONSE DA APLICAÇÃO`,
        `HTTP ${statusLabel(webhookResponse.status)}`,
        `Captured-At: ${stringValue(webhookResponse.captured_at)}`,
        '',
        formatJson(webhookResponse.body),
        '',
      );
    });
  });

  return `${lines.join('\n').trim()}\n`;
}

function sanitizeEvidenceValue(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet<object>(),
): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    return value
      .replace(/-----BEGIN[\s\S]*?PRIVATE KEY-----/gi, '[PRIVATE_KEY_REDACTED]')
      .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return null;
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (value instanceof Date) return value.toISOString();
  if (depth >= 12) return '[MAX_DEPTH]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(item => sanitizeEvidenceValue(item, depth + 1, seen));
  }

  const result: PlainRecord = {};
  for (const [key, item] of Object.entries(value as PlainRecord)) {
    result[key] = SECRET_KEY_PATTERN.test(key)
      ? '[REDACTED]'
      : sanitizeEvidenceValue(item, depth + 1, seen);
  }
  return result;
}

function assertOrderId(value: string): void {
  if (!/^GB-[A-Z0-9]{8,64}$/.test(value)) {
    throw new Error('Identificador do pedido inválido para a evidência de homologação.');
  }
}

function assertIsoDate(value: string, label: string): void {
  if (!value || Number.isNaN(Date.parse(value))) throw new Error(`A ${label} é inválida.`);
}

function assertSandboxCheckoutUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('URL do checkout inválida para a evidência de homologação.');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'sandbox.api.pagseguro.com' ||
    parsed.pathname !== '/checkouts'
  ) {
    throw new Error('A evidência de homologação aceita somente o endpoint de Checkout Sandbox.');
  }
}

function normalizeStatus(value: number | null): number | null {
  return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599
    ? Number(value)
    : null;
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function statusLabel(value: unknown): string {
  return Number.isInteger(value) ? String(value) : 'SEM RESPOSTA HTTP';
}

function formatJson(value: unknown): string {
  return JSON.stringify(sanitizeEvidenceValue(value), null, 2);
}

function formatHeaders(value: unknown): string {
  if (!isPlainRecord(value)) return '';
  return Object.entries(value)
    .map(([key, item]) => `${key}: ${stringValue(sanitizeEvidenceValue(item))}`)
    .join('\n');
}

function paymentMethodsFromRequest(value: unknown): string[] {
  if (!isPlainRecord(value) || !Array.isArray(value.payment_methods)) return [];
  return value.payment_methods
    .filter(isPlainRecord)
    .map(method => stringValue(method.type))
    .filter(Boolean);
}

function compareCapturedAt(left: PlainRecord, right: PlainRecord): number {
  return stringValue(left.captured_at).localeCompare(stringValue(right.captured_at));
}
