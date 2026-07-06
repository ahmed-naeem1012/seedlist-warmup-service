-- Run this once in the Supabase SQL editor.
-- Makes every SES campaign recur automatically every 24h until explicitly
-- paused. ses_campaigns becomes the persistent campaign *definition*
-- (previously a one-shot record); ses_campaign_sends — created in
-- 003_ses_campaign_sends.sql for exactly this purpose but never wired up —
-- becomes the per-run history log referencing that definition.

alter table ses_campaigns
  -- Lets a template-based campaign be re-rendered identically on day 2, 3, etc.
  add column if not exists template_data jsonb,

  -- Raw html/text campaigns (no templateId) previously had their content
  -- vanish after the first send — nothing persisted it. Recurring resends
  -- need it saved.
  add column if not exists html text,
  add column if not exists text text,

  -- The only stop switch now that every campaign recurs forever automatically.
  -- Defaults false, not true: a true default would retroactively flip every
  -- pre-existing historical campaign row to recurring the moment this
  -- column is added, causing a mass resend of old campaigns on the first
  -- cron tick after the flag is enabled. New campaigns still start active —
  -- the insert in index.js sets is_active: true explicitly.
  add column if not exists is_active boolean not null default false,

  -- Gates the "has 24h passed" check in the recurring cron job.
  add column if not exists last_run_at timestamptz;

-- Recurring-cron lookup: "which active campaigns are due for their next run."
create index if not exists idx_ses_campaigns_active_last_run_at
  on ses_campaigns (is_active, last_run_at);

alter table ses_campaign_sends
  -- Links each day's run back to its campaign definition.
  add column if not exists campaign_id uuid references ses_campaigns(id),

  add column if not exists status text
    check (status in ('sending', 'completed', 'failed')),

  add column if not exists error text;

-- A run is now inserted as status='sending' before these numbers are known,
-- then updated on completion — same two-step pattern ses_campaigns already
-- uses.
alter table ses_campaign_sends alter column sent drop not null;
alter table ses_campaign_sends alter column failed drop not null;
alter table ses_campaign_sends alter column total drop not null;
alter table ses_campaign_sends alter column duration drop not null;

-- "List this campaign definition's run history, most recent first."
create index if not exists idx_ses_campaign_sends_campaign_id
  on ses_campaign_sends (campaign_id, sent_at desc);
