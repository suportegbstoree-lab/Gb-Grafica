export type ShipmentLabelPhase = 'none' | 'preparing' | 'cart' | 'buying' | 'paid' | 'generating' | 'issued';

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
