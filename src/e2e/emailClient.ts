import type { EmailApi } from '../services/emailService';
import type { EmailCampaign, EmailPreferences } from '../lib/email';
let preferences: EmailPreferences = { promotions: false, news: false, revision: null, emailVerified: true };
let campaigns: EmailCampaign[] = [];
export const fixtureEmailApi: EmailApi = {
  async preferences() { return structuredClone(preferences); },
  async savePreferences(value) { preferences = { ...value, revision: crypto.randomUUID() }; return structuredClone(preferences); },
  async overview() { return { configured: true, marketingConfigured: true, campaigns: structuredClone(campaigns) }; },
  async createCampaign(value) { const row: EmailCampaign = { ...value, id: crypto.randomUUID(), status: 'draft', queuedCount: 0, processedCount: 0, acceptedCount: 0, skippedCount: 0, reviewCount: 0, createdAt: new Date().toISOString() }; campaigns = [row, ...campaigns]; return structuredClone(row); },
  async campaignAction(id, action) { campaigns = campaigns.map(row => row.id === id ? { ...row, status: action === 'queue' ? 'queued' : 'cancelled' } : row); },
  async dispatch() { campaigns = campaigns.map(row => row.status === 'queued' ? { ...row, queuedCount: 1, processedCount: 1, acceptedCount: 1, status: 'completed' } : row); return { busy: false, processed: 1, workRemaining: false }; },
};
