-- Run this once in the Supabase SQL editor.
-- Mirrors 007_ses_campaigns_provider_filter.sql's reasoning: speed_mode_index
-- has to be persisted on the row itself (not only used at request time)
-- because runCampaignSend() / resendDueSesCampaigns() in cronJobs.js only
-- ever see this row, never the original dashboard request, for every
-- recurring resend after the first (see 005_ses_campaigns_recurring.sql).
-- Same 0-3 range as warmup_preferences.speed_mode_index in the main
-- backend (0=slow, 1=medium, 2=fast, 3=ultra); defaults to 1 (medium) to
-- match that table's default and this service's prior fixed 24h cadence.

alter table ses_campaigns
  add column if not exists speed_mode_index smallint not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ses_campaigns_speed_mode_index_check'
  ) then
    alter table ses_campaigns
      add constraint ses_campaigns_speed_mode_index_check
      check (speed_mode_index >= 0 and speed_mode_index <= 3);
  end if;
end $$;
