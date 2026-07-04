-- Run this once in the Supabase SQL editor.
-- Persists every SES campaign send result so the dashboard can show history.

create table ses_campaign_sends (
  id          uuid        primary key default gen_random_uuid(),
  org_id      uuid        not null,
  from_email  text        not null,
  template_id uuid,                      -- null when content was passed directly
  sent        integer     not null,
  failed      integer     not null,
  total       integer     not null,
  duration    numeric     not null,      -- seconds, e.g. 114.2
  sent_at     timestamptz not null default now()
);

-- Supports the campaign-history query: org filtered, newest first.
create index idx_ses_campaign_sends_org_sent_at
  on ses_campaign_sends (org_id, sent_at desc);
