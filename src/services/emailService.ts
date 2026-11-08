import { auth, type FirebaseUser } from '../firebase';
import { apiFetch } from './apiClient';
import { apiErrorMessage } from '../lib/apiError';
import { EMAIL_CONSENT_VERSION, type EmailPreferences, type EmailOverview, type EmailCampaign, type EmailCampaignInput, type EmailCampaignPreview } from '../lib/email';
export interface EmailApi {
  preferences(): Promise<EmailPreferences>;
  savePreferences(value: EmailPreferences): Promise<EmailPreferences>;
  overview(): Promise<EmailOverview>;
  createCampaign(value: EmailCampaignInput): Promise<EmailCampaign>;
  updateCampaign(id: string, value: EmailCampaignInput & { expectedRevision: string | null }): Promise<EmailCampaign>;
  deleteCampaign(id: string, expectedRevision: string | null): Promise<void>;
  previewCampaign(value: EmailCampaignInput, signal?: AbortSignal): Promise<EmailCampaignPreview>;
  campaignAction(id: string, action: 'queue' | 'cancel', expectedRevision?: string | null): Promise<void>;
  dispatch(): Promise<{ busy: boolean; processed: number; workRemaining: boolean }>;
}
async function call<T>(path: string, value?: unknown, user = auth.currentUser, signal?: AbortSignal): Promise<T> {
  if (!user) throw new Error('Entre com sua conta para continuar.');
  const response = await apiFetch(`/api/${path}`, { method: value === undefined ? 'GET' : 'POST', signal, headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(apiErrorMessage(data, 'Não foi possível atualizar os e-mails.')); return data as T;
}
export const prepareEmailSession = (user: FirebaseUser) => call('email/session', {}, user);
export const emailApi: EmailApi = {
  preferences: () => call('email/preferences'),
  savePreferences: value => call('email/preferences', { promotions: value.promotions, news: value.news, expectedRevision: value.revision, consentVersion: EMAIL_CONSENT_VERSION }),
  overview: () => call('admin/email'), createCampaign: value => call('admin/email/campaigns', value),
  updateCampaign: (id, value) => call(`admin/email/campaigns/${encodeURIComponent(id)}/update`, value),
  deleteCampaign: (id, expectedRevision) => call(`admin/email/campaigns/${encodeURIComponent(id)}/delete`, { expectedRevision }),
  previewCampaign: (value, signal) => call('admin/email/preview', value, auth.currentUser, signal),
  campaignAction: (id, action, expectedRevision) => call(`admin/email/campaigns/${encodeURIComponent(id)}/${action}`, { ...(expectedRevision !== undefined ? { expectedRevision } : {}) }), dispatch: () => call('admin/email/dispatch', {}),
};
