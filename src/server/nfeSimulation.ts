import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { fiscalRecord, missingNfeIssuerFields, nfeDraftIssues, type NfeDraft, type NfeIssuer } from '../lib/nfe.js';
import {
  NFE_SIMULATION_SCENARIOS, type NfeSimulationScenario, type NfeSimulationStatus, type NfeSimulationView,
} from '../lib/nfeSimulation.js';
import { NfeDraftError } from './nfeDraftError.js';

const sample = { product: 'Caderno de demonstração', quantity: 1, totalCents: 3500 };
const initialStatus: NfeSimulationStatus = { phase: 'draft', revision: null };
const fiscalAddress = {
  cep: '01001000', cidade: 'São Paulo', estado: 'SP', cityCode: '3550308',
  rua: 'Endereço de demonstração', bairro: 'Centro', numero: '1', complemento: '',
};
const issuer: NfeIssuer = {
  legalName: 'Emitente de demonstração', cnpj: '11222333000181', stateRegistration: '123456789012',
  taxRegime: '1', address: fiscalAddress,
};
const draft: NfeDraft = {
  recipientName: 'Destinatário de demonstração', recipientDocument: '52998224725', stateRegistration: '',
  address: fiscalAddress, operation: 'Venda',
  items: [{ ncm: '48201000', origin: '0', unit: 'UN', cfop: '5102', icmsCode: '102', couponCents: 0 }],
};
interface SavedSimulation extends NfeSimulationStatus {
  startRevision?: string;
  updatedAt: string;
}

function toView(status: NfeSimulationStatus, enabled = true): NfeSimulationView {
  const { phase, revision, attemptId, scenario } = status;
  return { enabled, sample, status: { phase, revision, attemptId, scenario } };
}

function alreadySent(phase: NfeSimulationStatus['phase']) {
  return phase === 'processing' || phase === 'uncertain';
}

export async function simulateNfe(db: Firestore, actor: string, change?: unknown): Promise<NfeSimulationView> {
  if (process.env.NFE_ENV?.trim() !== 'simulacao') {
    if (change !== undefined) throw new NfeDraftError(409, 'O ambiente de simulação está desativado.');
    return toView(initialStatus, false);
  }

  const ref = db.collection('_fiscalSimulations').doc(actor);
  if (change === undefined) {
    const saved = (await ref.get()).data() as SavedSimulation | undefined;
    return toView(saved ?? initialStatus);
  }
  const request = fiscalRecord(change);
  if (!request || (request.revision !== null && typeof request.revision !== 'string'))
    throw new NfeDraftError(422, 'Informe uma ação e a revisão da simulação.');

  const result = await db.runTransaction(async tx => {
    const saved = (await tx.get(ref)).data() as SavedSimulation | undefined;
    const current = saved ?? initialStatus;
    const { action, revision } = request;
    if (action === 'emit' && saved?.attemptId && saved.startRevision === revision && saved.scenario === request.scenario) {
      return { current };
    }
    if (current.revision !== revision) throw new NfeDraftError(409, 'A simulação mudou. Atualize a situação para continuar.');

    const nextRevision = randomUUID();
    const updatedAt = new Date().toISOString();
    let next: SavedSimulation;
    switch (action) {
      case 'review': {
        if (current.phase !== 'draft') throw new NfeDraftError(409, 'Abra uma nova simulação para conferir novamente.');
        const issues = nfeDraftIssues(draft, [{
          name: sample.product, sku: 'DEMO-01', unitCents: sample.totalCents, quantity: sample.quantity, bundle: false,
        }], 0, missingNfeIssuerFields(issuer));
        if (issues.length) throw new NfeDraftError(422, 'Revise os dados fiscais do exemplo.');
        next = { phase: 'reviewed', revision: nextRevision, updatedAt };
        break;
      }
      case 'emit': {
        if (current.phase !== 'reviewed' || typeof current.revision !== 'string')
          throw new NfeDraftError(409, 'Confira o exemplo ou consulte a tentativa em andamento.');
        const scenario: NfeSimulationScenario | undefined = NFE_SIMULATION_SCENARIOS.find(([code]) => code === request.scenario)?.[0];
        if (!scenario) throw new NfeDraftError(422, 'Escolha um cenário de simulação.');
        next = { phase: scenario === 'timeout' ? 'uncertain' : 'processing', revision: nextRevision,
          scenario, attemptId: 'SIM-' + randomUUID(), startRevision: current.revision, updatedAt };
        break;
      }
      case 'consult': {
        if (!saved || !saved.attemptId) throw new NfeDraftError(409, 'Inicie uma tentativa de emissão simulada.');
        if (!alreadySent(saved.phase)) return { current: saved };
        // A consulta recupera o resultado já aceito no simulador, pela mesma referência.
        next = { ...saved, phase: saved.scenario === 'rejection' ? 'rejected' : 'authorized', revision: nextRevision, updatedAt };
        break;
      }
      case 'cancel':
        if (saved?.phase !== 'authorized') throw new NfeDraftError(409, 'A tentativa precisa estar autorizada na simulação.');
        next = { ...saved, phase: 'canceled', revision: nextRevision, updatedAt };
        break;
      case 'reset':
        if (alreadySent(current.phase)) throw new NfeDraftError(409, 'Consulte a tentativa em andamento antes de reiniciar.');
        next = { phase: 'draft', revision: nextRevision, updatedAt };
        break;
      default:
        throw new NfeDraftError(422, 'Ação de simulação inválida.');
    }
    tx.set(ref, next);
    return { current: next, timeout: action === 'emit' && next.phase === 'uncertain' };
  });
  if (result.timeout) throw new NfeDraftError(504, 'Timeout simulado. Consulte a tentativa antes de continuar.');
  return toView(result.current);
}
