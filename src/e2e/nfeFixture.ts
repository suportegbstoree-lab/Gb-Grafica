import { EMPTY_NFE_DEFAULTS, EMPTY_NFE_ISSUER, missingNfeIssuerFields, nfeDraftIssues, parseNfeIssuer, type NfeDefaultsConfig, type NfeDraft, type NfeReview } from '../lib/nfe';
import type { NfeSimulationView } from '../lib/nfeSimulation';
import type { NfeAdminApi } from '../services/nfeService';

const address = {
  cep: '01001000', estado: 'SP', cidade: 'São Paulo', cityCode: '3550308',
  rua: 'Praça da Sé', bairro: 'Sé',
};

export function fixtureNfeAdminApi(): NfeAdminApi {
  let settings: NfeDefaultsConfig = { defaults: EMPTY_NFE_DEFAULTS, issuer: EMPTY_NFE_ISSUER, revision: null };
  let savedDraft: NfeDraft = {
    recipientName: 'Cliente E2E', recipientDocument: '52998224725', stateRegistration: '', operation: 'Venda',
    address: { ...address, numero: '10', complemento: '' },
    items: [{ origin: '0', unit: 'UN', cfop: '5102', icmsCode: '102', couponCents: 0 }],
  };
  let reviewedAt: string | undefined;
  let revision: string | null = null;
  const lines = [{ name: 'Carimbo', sku: 'CAR01', quantity: 1, unitCents: 840, bundle: false }];
  function review(): NfeReview {
    const issuerMissing = missingNfeIssuerFields(settings.issuer);
    return {
      environment: 'disabled', revision, reviewedAt, editable: true, paymentEnvironment: 'sandbox',
      draft: structuredClone(savedDraft), lines, issuerMissing,
      issues: nfeDraftIssues(savedDraft, lines, 0, issuerMissing), couponFromCheckout: true,
      totals: { itemsCents: 840, itemCouponCents: 0, shippingCents: 0, shippingCouponCents: 0, totalCents: 840 },
    };
  }

  const simulation: NfeSimulationView = {
    enabled: true, status: { phase: 'draft', revision: null },
    sample: { product: 'Caderno de demonstração', quantity: 1, totalCents: 3500 },
  };
  return {
    async simulation(change) {
      if (change?.action === 'review') simulation.status = { phase: 'reviewed', revision: 'review-1' };
      if (change?.action === 'emit') {
        simulation.status = { phase: 'uncertain', revision: 'attempt-1', attemptId: 'SIM-DEMO' };
        throw new Error('Timeout simulado. Consulte a tentativa antes de continuar.');
      }
      if (change?.action === 'consult') simulation.status = { ...simulation.status, phase: 'authorized', revision: 'result-1' };
      return structuredClone(simulation);
    },
    async defaults(change) {
      if (change) {
        const issuer = parseNfeIssuer(change.issuer);
        if (!issuer) throw new Error('Dados do emitente inválidos.');
        settings = { ...change, issuer, revision: crypto.randomUUID() };
        reviewedAt = undefined;
      }
      return structuredClone(settings);
    },
    async address() { return { ...address }; },
    async draft(_id, change) {
      if (change) {
        savedDraft = structuredClone(change.draft);
        revision = crypto.randomUUID();
        reviewedAt = change.confirm ? new Date().toISOString() : undefined;
      }
      return review();
    },
    async summaries(ids) {
      const { issues } = review();
      return Object.fromEntries(ids.map(id => [id, {
        status: issues.length ? 'pending' : reviewedAt ? 'reviewed' : 'ready',
        issues, issueCount: issues.length,
      }]));
    },
  };
}
