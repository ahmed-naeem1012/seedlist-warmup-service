-- 012: Allow 'oauth' as a campaign pool / transport.
--
-- A warmup mailbox connected via Google or Outlook OAuth on the dashboard
-- (organization_warmup_emails, provider 'google' | 'outlook') can now be
-- assigned to a template and run campaigns. Sends go through the
-- provider's own API (Gmail users.messages.send / Microsoft Graph sendMail)
-- with the row's access token - see services/oauthEmailSender.js. For this
-- pool the POOL and the TRANSPORT are the same value, like 'ses' and 'smtp'.
--
-- Idempotent: drop + re-add both check constraints with the widened set.

alter table public.ses_campaigns
  drop constraint if exists ses_campaigns_send_provider_check;

alter table public.ses_campaigns
  add constraint ses_campaigns_send_provider_check
  check (send_provider in ('ses', 'resend', 'custom_dns', 'platform_ses', 'smtp', 'oauth'));

alter table public.ses_campaign_sends
  drop constraint if exists ses_campaign_sends_send_provider_check;

alter table public.ses_campaign_sends
  add constraint ses_campaign_sends_send_provider_check
  check (send_provider in ('ses', 'resend', 'custom_dns', 'platform_ses', 'smtp', 'oauth'));

-- Verify
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conname in ('ses_campaigns_send_provider_check', 'ses_campaign_sends_send_provider_check');
