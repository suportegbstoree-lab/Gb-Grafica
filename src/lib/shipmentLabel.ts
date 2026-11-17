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
  authorizedNfeAvailable?: true;
}

export type ShipmentLabelFields = {
  recipientDocument: string;
  agency?: string;
} & (
  | { useAuthorizedNfe: true; invoiceKey?: undefined }
  | { useAuthorizedNfe?: false; invoiceKey: string }
);

export interface ShipmentLabelPrintLink {
  printUrl: string;
}
