-- Run this once in the Supabase SQL editor before enabling BREVO_TEST_WARMER.
-- Creates the two campaign-memory tables and two atomic counter RPC functions.

-- Atomic counter helpers (called via supabase.rpc())
create or replace function inc_campaign_opens(p_id uuid)
returns void language sql as $$
  update warmup_campaigns set actual_opens = actual_opens + 1 where id = p_id;
$$;

create or replace function inc_campaign_clicks(p_id uuid)
returns void language sql as $$
  update warmup_campaigns set actual_clicks = actual_clicks + 1 where id = p_id;
$$;

create table warmup_campaigns (
  id                uuid primary key default gen_random_uuid(),
  campaign_key      text unique not null,
  provider          text not null,
  sender_email      text not null,
  subject           text not null,
  campaign_date     date not null,
  total_mailboxes   integer not null,
  target_open_rate  numeric not null,
  target_click_rate numeric not null,
  target_opens      integer not null,
  target_clicks     integer not null,
  actual_opens      integer not null default 0,
  actual_clicks     integer not null default 0,
  created_at        timestamptz not null default now()
);

create table warmup_decisions (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references warmup_campaigns(id),
  mailbox_email text not null,
  decision      text not null,        -- 'open' | 'click' | 'skip'
  processed     boolean not null default false,
  open_done     boolean not null default false,
  click_done    boolean not null default false,
  cleanup_done  boolean not null default false,
  attempts      integer not null default 0,
  last_error    text,
  processed_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique(campaign_id, mailbox_email)
);
