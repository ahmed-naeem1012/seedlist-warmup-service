-- Run this once in the Supabase SQL editor.
-- Tracks per-org sending domains added for DKIM verification (dashboard's
-- "Domains & DKIM" tab on the Amazon SES integration sidebar). Each row is
-- one domain plus the 3 DKIM CNAME records generated for it, so the
-- records the user was shown to copy into their DNS provider are durable
-- and reappear exactly as given when they reopen the panel.
--
-- cname_records is a jsonb array of { name, value } objects rather than a
-- child table — same denormalized-jsonb convention already used for
-- ses_campaigns.template_data (migrations/005_ses_campaigns_recurring.sql).
-- Tokens come from a real SESv2 CreateEmailIdentity call against the org's
-- stored ses_integrations credentials, so status starts 'pending' and moves
-- to 'verified'/'failed' once GetEmailIdentity polling is wired up.

create table ses_domains (
  id            uuid primary key default gen_random_uuid(),

  -- Tenant this domain belongs to (maxify-proj org id). No FK — same
  -- convention as ses_integrations.org_id.
  org_id        uuid not null,

  domain        text not null,
  cname_records jsonb not null,

  -- SES identities are region-scoped — the region the CreateEmailIdentity
  -- call was made in (sourced from the ses_integrations row used to create
  -- it), needed again for any later GetEmailIdentity status check.
  aws_region    text not null,

  status        text not null default 'pending'
                  check (status in ('pending', 'verified', 'failed')),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (org_id, domain)
);

-- Domains tab: "list my org's domains, most recently added first."
create index idx_ses_domains_org_id_created_at
  on ses_domains (org_id, created_at desc);

-- Keep updated_at accurate without relying on application code to set it.
create or replace function set_ses_domains_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_ses_domains_updated_at
  before update on ses_domains
  for each row
  execute function set_ses_domains_updated_at();
