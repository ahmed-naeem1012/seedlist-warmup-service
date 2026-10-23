const supabase = require('../supabaseClient');

/**
 * Spam outreach state, kept in Supabase (see migrations/013_spam_outreach.sql).
 *
 * The cycle works on an in-memory snapshot shaped exactly like the standalone project's
 * state.json — { mailboxes: { [mailboxId]: { [threadId]: entry } }, domainCache } — so the
 * pipeline logic ported over unchanged. upsertEntry / setDomainCache mark what changed,
 * and saveState writes only those rows.
 *
 * The sweeper runs alongside, so its records (swept threads and domains) and the
 * contacted-address list are always read fresh from the database rather than the snapshot.
 */

const PAGE = 1000;

async function selectAll(table, columns) {
  let rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`[spam outreach] ${table} query failed: ${error.message}`);
    rows = rows.concat(data || []);
    if (!data || data.length < PAGE) return rows;
  }
}

/** A fresh snapshot of every message record and cached lookup. */
async function loadState() {
  const [messages, cache] = await Promise.all([
    selectAll('spam_outreach_messages', 'mailbox_id, thread_id, data'),
    selectAll('spam_outreach_domain_cache', 'domain, data'),
  ]);
  const state = { mailboxes: {}, domainCache: {}, dirtyEntries: new Set(), dirtyDomains: new Set() };
  for (const row of messages) {
    state.mailboxes[row.mailbox_id] = state.mailboxes[row.mailbox_id] || {};
    state.mailboxes[row.mailbox_id][row.thread_id] = row.data;
  }
  for (const row of cache) state.domainCache[row.domain] = row.data;
  return state;
}

/** Writes every entry and cached lookup changed since the last save. */
async function saveState(state) {
  if (state.dirtyEntries.size) {
    const rows = [...state.dirtyEntries].map((key) => {
      const [mailboxId, threadId] = key.split('/');
      const entry = state.mailboxes[mailboxId][threadId];
      return {
        mailbox_id: mailboxId,
        thread_id: threadId,
        status: entry.status,
        drafted_to: entry.draftedTo || null,
        data: entry,
        updated_at: new Date().toISOString(),
      };
    });
    const { error } = await supabase.from('spam_outreach_messages').upsert(rows, { onConflict: 'mailbox_id,thread_id' });
    if (error) throw new Error(`[spam outreach] saving messages failed: ${error.message}`);
    state.dirtyEntries.clear();
  }
  if (state.dirtyDomains.size) {
    const rows = [...state.dirtyDomains].map((domain) => ({
      domain,
      data: state.domainCache[domain],
      cached_at: state.domainCache[domain].cachedAt || new Date().toISOString(),
    }));
    const { error } = await supabase.from('spam_outreach_domain_cache').upsert(rows, { onConflict: 'domain' });
    if (error) throw new Error(`[spam outreach] saving domain cache failed: ${error.message}`);
    state.dirtyDomains.clear();
  }
}

function getEntry(state, mailboxId, threadId) {
  return state.mailboxes[mailboxId] && state.mailboxes[mailboxId][threadId];
}

function upsertEntry(state, mailboxId, threadId, entry) {
  state.mailboxes[mailboxId] = state.mailboxes[mailboxId] || {};
  state.mailboxes[mailboxId][threadId] = entry;
  state.dirtyEntries.add(`${mailboxId}/${threadId}`);
}

function getDomainCache(state, domain) {
  return state.domainCache[domain];
}

function setDomainCache(state, domain, entry) {
  state.domainCache[domain] = entry;
  state.dirtyDomains.add(domain);
}

/**
 * How many times a failed step is retried on later cycles before it is left alone.
 * Without this the `*_retry` statuses are dead ends.
 */
const MAX_ATTEMPTS = 3;

function needsCapture(entry) {
  if (entry === undefined) return true;
  return entry.status === 'capture_failed_retry' && entry.attempts < MAX_ATTEMPTS;
}

function needsLookup(entry) {
  if (!entry) return false;
  if (entry.status === 'captured') return true;
  return entry.status === 'lookup_pending_retry' && entry.attempts < MAX_ATTEMPTS;
}

function needsDraft(entry) {
  if (!entry) return false;
  if (entry.status === 'ready_to_draft') return true;
  return entry.status === 'draft_failed_retry' && entry.attempts < MAX_ATTEMPTS;
}

// ── Sweeper records ─────────────────────────────────────────────────────────

/** Thread ids (hex, as Gmail's web client shows them) the sweeper moved into Spam. */
async function loadForcedThreadIds() {
  const rows = await selectAll('spam_outreach_swept_threads', 'thread_id');
  return new Set(rows.map((r) => r.thread_id));
}

async function recordForcedThreadIds(threadIds) {
  if (!threadIds.length) return;
  const rows = threadIds.map((thread_id) => ({ thread_id }));
  // ignoreDuplicates keeps the first moved_at for threads already on record.
  const { error } = await supabase.from('spam_outreach_swept_threads').upsert(rows, { onConflict: 'thread_id', ignoreDuplicates: true });
  if (error) throw new Error(`[spam outreach] recording swept threads failed: ${error.message}`);
}

/**
 * Sender domains the sweeper has ever moved into Spam. Moving mail to Spam reports the
 * sender to Gmail, and Gmail learns from it — so a company's later spam placement may be
 * partly our doing, and the whole domain is treated as swept.
 */
async function loadForcedDomains() {
  const rows = await selectAll('spam_outreach_swept_domains', 'domain');
  return new Set(rows.map((r) => r.domain));
}

async function recordForcedDomains(domains) {
  const wanted = [...new Set(domains.map((d) => d.toLowerCase()).filter(Boolean))];
  if (!wanted.length) return;
  const rows = wanted.map((domain) => ({ domain }));
  const { error } = await supabase.from('spam_outreach_swept_domains').upsert(rows, { onConflict: 'domain', ignoreDuplicates: true });
  if (error) throw new Error(`[spam outreach] recording swept domains failed: ${error.message}`);
}

/** Everyone drafted to or emailed so far (To and Cc), from any trap mailbox. */
async function readContactedAddresses() {
  const rows = await selectAll('spam_outreach_messages', 'data');
  const contacted = new Set();
  for (const { data } of rows) {
    if (data.draftedTo) contacted.add(data.draftedTo.toLowerCase());
    for (const cc of data.draftedCc || []) contacted.add(cc.toLowerCase());
  }
  return contacted;
}

module.exports = {
  loadState,
  saveState,
  getEntry,
  upsertEntry,
  getDomainCache,
  setDomainCache,
  MAX_ATTEMPTS,
  needsCapture,
  needsLookup,
  needsDraft,
  loadForcedThreadIds,
  recordForcedThreadIds,
  loadForcedDomains,
  recordForcedDomains,
  readContactedAddresses,
};
