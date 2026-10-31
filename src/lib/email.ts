export const EMAIL_CONSENT_VERSION = '2026-10-31';
export type EmailChannel = 'promotions' | 'news';
export interface EmailPreferences { promotions: boolean; news: boolean; revision: string | null; emailVerified: boolean; }
export interface EmailCampaign { id: string; channel: EmailChannel; subject: string; text: string; status: string; queuedCount: number; processedCount: number; acceptedCount: number; skippedCount: number; reviewCount: number; createdAt: string; }
export interface EmailOverview { configured: boolean; marketingConfigured: boolean; campaigns: EmailCampaign[]; }
