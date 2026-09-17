export type PaymentStatus =
  | 'pago'
  | 'pendente'
  | 'em_analise'
  | 'recusado'
  | 'cancelado'
  | 'expirado'
  | 'erro';

export type FulfillmentStatus =
  | 'aguardando_pagamento'
  | 'pagamento_confirmado'
  | 'em_producao'
  | 'pronto_retirada'
  | 'enviado'
  | 'entregue'
  | 'cancelado';

export type DeliveryMethod = 'retirada' | 'entrega';

const LABELS: Record<FulfillmentStatus, string> = {
  aguardando_pagamento: 'Aguardando pagamento',
  pagamento_confirmado: 'Pagamento confirmado',
  em_producao: 'Em produção',
  pronto_retirada: 'Pronto para retirada',
  enviado: 'Enviado',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

export function fulfillmentStatusLabel(status: FulfillmentStatus): string {
  return LABELS[status];
}

export function legacyFulfillmentStatus(
  legacyStatus: unknown,
  paymentStatus?: PaymentStatus,
): FulfillmentStatus {
  switch (legacyStatus) {
    case 'Processando':
      return 'em_producao';
    case 'Enviado':
      return 'enviado';
    case 'Entregue':
      return 'entregue';
    case 'Pago':
      return 'pagamento_confirmado';
    default:
      return paymentStatus === 'pago' ? 'pagamento_confirmado' : 'aguardando_pagamento';
  }
}

export function allowedFulfillmentTransitions(
  current: FulfillmentStatus,
  paymentStatus: PaymentStatus | undefined,
  deliveryMethod: DeliveryMethod | undefined,
): FulfillmentStatus[] {
  if (paymentStatus !== 'pago') return [current];

  switch (current) {
    case 'aguardando_pagamento':
      return ['pagamento_confirmado'];
    case 'pagamento_confirmado':
      return ['pagamento_confirmado', 'em_producao'];
    case 'em_producao':
      return deliveryMethod === 'retirada'
        ? ['em_producao', 'pronto_retirada']
        : ['em_producao', 'enviado'];
    case 'pronto_retirada':
    case 'enviado':
      return [current, 'entregue'];
    case 'entregue':
    case 'cancelado':
      return [current];
  }
}

export function legacyStatusForFulfillment(status: FulfillmentStatus): string {
  switch (status) {
    case 'aguardando_pagamento':
      return 'Pendente';
    case 'pagamento_confirmado':
      return 'Pago';
    case 'em_producao':
    case 'pronto_retirada':
      return 'Processando';
    case 'enviado':
      return 'Enviado';
    case 'entregue':
      return 'Entregue';
    case 'cancelado':
      return 'Pendente';
  }
}

export function isFulfillmentStatus(value: unknown): value is FulfillmentStatus {
  return typeof value === 'string' && value in LABELS;
}
