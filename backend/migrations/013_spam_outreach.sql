-- Spam outreach: run once in the Supabase SQL editor before enabling SPAM_OUTREACH_SWEEPER
-- or SPAM_OUTREACH_CYCLE. Replaces the state.json / forced-*.json files the standalone
-- spam-outreach project kept on disk. Then import that project's existing state with:
--   node scripts/spam-outreach/import-state.js /path/to/spam-outreach
--
-- Every table is prefixed spam_outreach_ — this database is shared with maxify-proj.

-- One row per spam thread seen in the mailbox's Spam folder. `data` holds the full
-- record (sender, screenshot path, recipients, error, …) exactly as the pipeline uses it;
-- status and drafted_to are lifted into columns for querying.
create table if not exists spam_outreach_messages (
  mailbox_id  text not null,
  thread_id   text not null,              -- Gmail thread id, hex (as the web UI shows it)
  status      text not null,
  drafted_to  text,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (mailbox_id, thread_id)
);
create index if not exists spam_outreach_messages_status_idx on spam_outreach_messages (status);

-- GetLeads results per sender domain, so a company is looked up (and billed) once.
create table if not exists spam_outreach_domain_cache (
  domain     text primary key,
  data       jsonb not null,
  cached_at  timestamptz not null default now()
);

-- Threads the sweeper moved from Inbox to Spam (recorded BEFORE the move).
create table if not exists spam_outreach_swept_threads (
  thread_id  text primary key,
  moved_at   timestamptz not null default now()
);

-- Sender domains the sweeper has ever moved.
create table if not exists spam_outreach_swept_domains (
  domain          text primary key,
  first_moved_at  timestamptz not null default now()
);
