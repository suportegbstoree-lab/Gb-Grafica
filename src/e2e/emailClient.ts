import type { EmailApi } from '../services/emailService';
import type { EmailCampaign, EmailPreferences } from '../lib/email';
let preferences: EmailPreferences = { promotions: false, news: false, revision: null, emailVerified: true };
let campaigns: EmailCampaign[] = [];
export const fixtureEmailApi: EmailApi = {
  async preferences() { return structuredClone(preferences); },
  async savePreferences(value) { preferences = { ...value, revision: crypto.randomUUID() }; return structuredClone(preferences); },
  async overview() { return { configured: true, marketingConfigured: true, campaigns: structuredClone(campaigns) }; },
  async createCampaign(value) { const row: EmailCampaign = { ...value, id: crypto.randomUUID(), revision: crypto.randomUUID(), status: 'draft', queuedCount: 0, processedCount: 0, acceptedCount: 0, skippedCount: 0, reviewCount: 0, createdAt: new Date().toISOString() }; campaigns = [row, ...campaigns]; return structuredClone(row); },
  async updateCampaign(id, value) {
    const old = campaigns.find(row => row.id === id); if (!old || old.status !== 'draft' || old.revision !== value.expectedRevision) throw new Error('O rascunho mudou. Atualize a lista.');
    const row = { ...old, subject: value.subject, text: value.text, channel: value.channel, revision: crypto.randomUUID() };
    campaigns = campaigns.map(item => item.id === id ? row : item); return structuredClone(row);
  },
  async deleteCampaign(id, expectedRevision) {
    const old = campaigns.find(row => row.id === id); if (!old || old.status !== 'draft' || old.revision !== expectedRevision) throw new Error('O rascunho mudou. Atualize a lista.');
    campaigns = campaigns.filter(row => row.id !== id);
  },
  async previewCampaign(value, signal) {
    const response = await fetch('/__e2e/email-preview', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
  },
  async campaignAction(id, action, expectedRevision) { const old = campaigns.find(row => row.id === id); if (expectedRevision !== undefined && old?.revision !== expectedRevision) throw new Error('A campanha mudou.'); campaigns = campaigns.map(row => row.id === id ? { ...row, status: action === 'queue' ? 'queued' : 'cancelled' } : row); },
  async dispatch() { campaigns = campaigns.map(row => row.status === 'queued' ? { ...row, queuedCount: 1, processedCount: 1, acceptedCount: 1, status: 'completed' } : row); return { busy: false, processed: 1, workRemaining: false }; },
};
