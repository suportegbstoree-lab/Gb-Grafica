export type ShipmentLabelPhase = 'none' | 'preparing' | 'cart' | 'discarding' | 'buying' | 'paid' | 'generating' | 'issued' | 'canceling' | 'canceled';

export const shipmentLabelPhaseNames: Record<ShipmentLabelPhase, string> = {
  none: 'Sem etiqueta', preparing: 'Preparação pendente', cart: 'No carrinho', discarding: 'Remoção pendente',
  buying: 'Compra pendente', paid: 'Comprada', generating: 'Emitindo', issued: 'Emitida',
  canceling: 'Cancelamento pendente', canceled: 'Cancelada',
};

export interface ShipmentLabelView {
  phase: ShipmentLabelPhase;
  amountCents: number | null;
  providerId?: string;
  tracking?: string;
}

export interface ShipmentLabelFields {
  invoiceKey: string;
  recipientDocument: string;
  agency?: string;
}

export interface ShipmentLabelPrintLink {
  printUrl: string;
}
