import type { EmailCampaignPreview } from "../lib/email.js";
import { emailCampaignInput } from "./emailCampaigns.js";
import { campaignEmailMessage } from "./emailMessages.js";
import { emailConfiguration } from "./emailPreferences.js";
import { emailBranding, renderEmailPreview } from "./resendEmailTemplates.js";

/** The same canonical HTML as sending; no provider calls, tokens or consent changes. */
export function previewEmailCampaign(input: unknown): EmailCampaignPreview {
  const fields = emailCampaignInput(input, true),
    config = emailConfiguration();
  const unsubscribeUrl = `${emailBranding().storeUrl}/api/email/unsubscribe?token=PREVIA_LINK_INDIVIDUAL`;
  return {
    subject: fields.subject,
    from: config.marketingFrom,
    replyTo: config.replyTo,
    html: renderEmailPreview(
      "campaign",
      campaignEmailMessage(fields.text, fields.channel, unsubscribeUrl),
    ),
  };
}
