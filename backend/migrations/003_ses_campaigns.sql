-- Run this once in the Supabase SQL editor.
-- Tracks org campaign sends as background jobs. Added because
-- POST /api/ses/send-campaign used to await the full send loop (every
-- active auto_responder_mailboxes recipient, one SES call each) before
-- responding — with a large seedlist that routinely exceeded the
-- dashboard's nginx proxy_read_timeout and surfaced as a 504, even though
-- the send kept running server-side. The endpoint now returns as soon as
-- the job is queued and updates this row as the background send progresses.

create table ses_campaigns (
  id            uuid primary key default gen_random_uuid(),

  -- Tenant this campaign belongs to (maxify-proj org id). No FK — same
  -- convention as ses_integrations.org_id.
  org_id        uuid not null,

  from_email    text not null,
  template_id   uuid,
  template_name text,
  subject       text,

  status        text not null default 'sending'
                  check (status in ('sending', 'completed', 'failed')),

  total         integer not null default 0,
  sent          integer not null default 0,
  failed        integer not null default 0,
  duration      numeric,
  error         text,

  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

-- History tab: "list my org's campaigns, most recent first."
create index idx_ses_campaigns_org_id_created_at
  on ses_campaigns (org_id, created_at desc);
