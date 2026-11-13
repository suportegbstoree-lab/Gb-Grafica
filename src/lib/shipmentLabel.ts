export type ShipmentLabelPhase = 'none' | 'preparing' | 'cart' | 'discarding' | 'buying' | 'paid' | 'generating' | 'issued';

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
