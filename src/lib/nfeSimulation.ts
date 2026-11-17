export const NFE_SIMULATION_SCENARIOS = [
  ['success', 'Autorização'],
  ['rejection', 'Rejeição'],
  ['timeout', 'Timeout após aceitar o envio'],
] as const;

export type NfeSimulationScenario = typeof NFE_SIMULATION_SCENARIOS[number][0];
export type NfeSimulationPhase = 'draft' | 'reviewed' | 'processing' | 'uncertain' | 'authorized' | 'rejected' | 'canceled';

export interface NfeSimulationStatus {
  phase: NfeSimulationPhase;
  revision: string | null;
  attemptId?: string;
  scenario?: NfeSimulationScenario;
}

export interface NfeSimulationView {
  enabled: boolean;
  status: NfeSimulationStatus;
  sample: { product: string; quantity: number; totalCents: number };
}

export type NfeSimulationRequest =
  | { action: 'review' | 'consult' | 'cancel' | 'reset'; revision: string | null }
  | { action: 'emit'; revision: string | null; scenario: NfeSimulationScenario };
