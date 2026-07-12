-- Run this once in the Supabase SQL editor.
-- Lets a campaign's recipient pool (auto_responder_mailboxes) be filtered
-- by the org's warmup_preferences (gsuite="Gmail" -> @gmail.com only,
-- google -> custom domain only). Persisted here rather than only used at
-- request time because runCampaignSend() is shared by the initial send and
-- every daily recurring cron resend (see 005_ses_campaigns_recurring.sql) —
-- recurring resends only ever see this row, never the original request, so
-- the filter has to be saved here or it silently reverts to the full pool
-- on day 2.

alter table ses_campaigns
  add column if not exists provider_distribution jsonb,
  add column if not exists selected_providers jsonb;
