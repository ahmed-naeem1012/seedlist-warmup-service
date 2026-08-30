-- Run this once in the Supabase SQL editor.
-- Adds a second real send transport (Resend) alongside the existing
-- customer-supplied-AWS-keys SES one. send_provider decides which
-- prepare*Campaign/execute*Send pair campaignRunner.js's runCampaignSend()
-- dispatches to for a given ses_campaigns row - defaults to 'ses' so every
-- row that existed before this migration keeps behaving exactly as before.
--
-- Named send_provider, not provider, to avoid any confusion with the
-- existing provider_distribution/selected_providers columns added in
-- 007_ses_campaigns_provider_filter.sql - those filter which *recipients*
-- (gmail.com vs custom-domain) a campaign reaches; this is about which
-- outbound API actually sends it. Also unrelated to speed_mode_index
-- (008_ses_campaigns_speed_mode.sql), which only affects resend cadence.
--
-- Added to both tables: ses_campaigns (the campaign definition) and
-- ses_campaign_sends (each individual run's log), so a run's provider is
-- recorded even if the parent campaign's provider were ever changed later.
--
-- NOTE: already applied directly via the Supabase SQL editor on 2026-08-30 -
-- this file exists for repo history/reproducibility. Re-running is safe
-- (every statement is idempotent: IF NOT EXISTS / guarded constraint checks).

alter table ses_campaigns
  add column if not exists send_provider text not null default 'ses';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ses_campaigns_send_provider_check'
  ) then
    alter table ses_campaigns
      add constraint ses_campaigns_send_provider_check
      check (send_provider in ('ses', 'resend'));
  end if;
end $$;

alter table ses_campaign_sends
  add column if not exists send_provider text not null default 'ses';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ses_campaign_sends_send_provider_check'
  ) then
    alter table ses_campaign_sends
      add constraint ses_campaign_sends_send_provider_check
      check (send_provider in ('ses', 'resend'));
  end if;
end $$;

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================

select table_name, column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('ses_campaigns', 'ses_campaign_sends')
  and column_name = 'send_provider';
