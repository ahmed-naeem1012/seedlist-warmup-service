-- Run this once in the Supabase SQL editor.
-- Widens send_provider (009_ses_campaigns_send_provider.sql) to support the
-- Custom DNS pool's SES-first-then-Resend priority rule:
--   - ses_campaigns.send_provider is the POOL the frontend picked:
--       'ses'        - legacy ses_integrations pool (customer's own AWS keys)
--       'custom_dns' - a Custom DNS domain with its own SES + Resend identities
--   - ses_campaign_sends.send_provider is the concrete TRANSPORT that
--     specific run actually used: 'ses' | 'platform_ses' | 'resend'.
--     campaignRunner.js's resolveCustomDnsTransport() re-resolves this on
--     every run (first send and every cron resend) - SES wins whenever the
--     domain's SES identity is verified, Resend is only ever the fallback.
-- Both columns share one constraint accepting the full set of four values
-- rather than two different constraints, since either column can
-- legitimately hold any of them depending on which table it's on.

alter table ses_campaigns
  drop constraint if exists ses_campaigns_send_provider_check;

alter table ses_campaigns
  add constraint ses_campaigns_send_provider_check
  check (send_provider in ('ses', 'resend', 'custom_dns', 'platform_ses'));

alter table ses_campaign_sends
  drop constraint if exists ses_campaign_sends_send_provider_check;

alter table ses_campaign_sends
  add constraint ses_campaign_sends_send_provider_check
  check (send_provider in ('ses', 'resend', 'custom_dns', 'platform_ses'));

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conname in ('ses_campaigns_send_provider_check', 'ses_campaign_sends_send_provider_check');
