-- 011: Allow 'smtp' as a campaign pool / transport.
--
-- A warmup mailbox connected via app password (organization_warmup_emails,
-- provider = 'smtp') can now be assigned to a template and run campaigns.
-- Those sends go out over the mailbox's own SMTP server using its stored
-- (encrypted) credentials - see services/smtpEmailSender.js. For this pool
-- the POOL and the TRANSPORT are the same value, exactly like 'ses'.
--
-- Idempotent: drop + re-add both check constraints with the widened set.

alter table public.ses_campaigns
  drop constraint if exists ses_campaigns_send_provider_check;

alter table public.ses_campaigns
  add constraint ses_campaigns_send_provider_check
  check (send_provider in ('ses', 'resend', 'custom_dns', 'platform_ses', 'smtp'));

alter table public.ses_campaign_sends
  drop constraint if exists ses_campaign_sends_send_provider_check;

alter table public.ses_campaign_sends
  add constraint ses_campaign_sends_send_provider_check
  check (send_provider in ('ses', 'resend', 'custom_dns', 'platform_ses', 'smtp'));

-- Verify
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conname in ('ses_campaigns_send_provider_check', 'ses_campaign_sends_send_provider_check');
