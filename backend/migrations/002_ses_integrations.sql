-- Run this once in the Supabase SQL editor.
-- Adds per-org SES integrations (tenant-owned AWS keys + sender identity)
-- so orgs can run their own SES campaigns against the shared
-- `auto_responder_mailboxes` seedlist instead of the platform's own keys.
--
-- AWS credentials are stored encrypted (AES-256-CBC via the app's existing
-- ENCRYPTION_KEY convention, same one used to encrypt
-- auto_responder_mailboxes.app_password) — never store them in plaintext.

create table ses_integrations (
  id                        uuid primary key default gen_random_uuid(),

  -- Tenant this integration belongs to (maxify-proj org id). No FK — this
  -- project doesn't own the orgs table, same convention as
  -- auto_responder_mailboxes not FK-ing to a users table.
  org_id                    uuid not null,

  -- Verified SES sender identity for this integration. An org can register
  -- more than one (multiple sending domains), one row each.
  from_email                text not null,
  aws_region                text not null default 'us-east-1',

  -- Encrypted at rest — decrypt with utils/crypto.js before use, never
  -- returned to the frontend.
  aws_access_key_id_enc     text not null,
  aws_secret_access_key_enc text not null,

  is_active                 boolean not null default true,
  last_error                text,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  unique (org_id, from_email)
);

-- Lookups by org (Integrations tab: "list my org's senders").
create index idx_ses_integrations_org_id
  on ses_integrations (org_id);

-- Lookup the engagement cron needs: which from_emails are currently live,
-- across all orgs, so it can recognize and engage tenant campaigns.
create index idx_ses_integrations_active_from_email
  on ses_integrations (from_email)
  where is_active;

-- Keep updated_at accurate without relying on application code to set it.
create or replace function set_ses_integrations_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_ses_integrations_updated_at
  before update on ses_integrations
  for each row
  execute function set_ses_integrations_updated_at();
