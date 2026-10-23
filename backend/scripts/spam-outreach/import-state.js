/**
 * One-time import of the standalone spam-outreach project's state into Supabase, so the
 * migrated service knows everyone already contacted and every thread already handled —
 * otherwise it would email the same people again.
 *
 * Run once, after migrations/013_spam_outreach.sql and BEFORE enabling SPAM_OUTREACH_CYCLE:
 *   node scripts/spam-outreach/import-state.js /path/to/spam-outreach
 *
 * Reads, from that directory: state.json, forced-to-spam.json, forced-domains.json.
 * Safe to re-run: rows are upserted on their keys.
 *
 * Screenshot paths inside the records point at the old machine. Messages already sent or
 * skipped never need them again; any still queued (ready_to_draft) are reported below —
 * copy their screenshots across, or they will wait as "missing attachment".
 */
require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const supabase = require('../../services/supabaseClient');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function upsertInBatches(table, rows, onConflict, extra = {}) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + 500), { onConflict, ...extra });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('Usage: node scripts/spam-outreach/import-state.js /path/to/spam-outreach');

  const state = await readJson(path.join(dir, 'state.json'), null);
  if (!state) throw new Error(`No state.json in ${dir}`);
  const forcedThreads = await readJson(path.join(dir, 'forced-to-spam.json'), {});
  const forcedDomains = await readJson(path.join(dir, 'forced-domains.json'), {});

  const messages = [];
  const stillQueued = [];
  for (const [mailboxId, entries] of Object.entries(state.mailboxes || {})) {
    for (const [threadId, entry] of Object.entries(entries)) {
      messages.push({
        mailbox_id: mailboxId,
        thread_id: threadId,
        status: entry.status,
        drafted_to: entry.draftedTo || null,
        data: entry,
      });
      if (entry.status === 'ready_to_draft' || entry.status === 'draft_failed_retry') {
        stillQueued.push(`${mailboxId}/${threadId} ${entry.fromDomain} -> ${entry.screenshotPath || '(no screenshot)'}`);
      }
    }
  }

  const cache = Object.entries(state.domainCache || {}).map(([domain, data]) => ({
    domain,
    data,
    cached_at: data.cachedAt || new Date().toISOString(),
  }));

  // Threads moved by the old browser sweep were kept inside state.json; they count too.
  const threadRows = Object.entries({ ...(state.forcedToSpam || {}), ...forcedThreads }).map(([thread_id, moved_at]) => ({
    thread_id,
    moved_at,
  }));
  const domainRows = Object.entries(forcedDomains).map(([domain, first_moved_at]) => ({ domain, first_moved_at }));

  await upsertInBatches('spam_outreach_messages', messages, 'mailbox_id,thread_id');
  await upsertInBatches('spam_outreach_domain_cache', cache, 'domain');
  await upsertInBatches('spam_outreach_swept_threads', threadRows, 'thread_id', { ignoreDuplicates: true });
  await upsertInBatches('spam_outreach_swept_domains', domainRows, 'domain', { ignoreDuplicates: true });

  const contacted = messages.filter((m) => m.data.draftedTo).length;
  console.log(
    `Imported ${messages.length} messages (${contacted} already contacted), ${cache.length} cached lookups, ` +
      `${threadRows.length} swept threads, ${domainRows.length} swept domains.`
  );
  if (stillQueued.length) {
    console.log(`\n${stillQueued.length} message(s) still queued — copy these screenshots to the server at the same paths, or they will wait:`);
    for (const line of stillQueued) console.log(`  ${line}`);
  }
}

main().catch((err) => {
  console.error('Import failed:', err.message || err);
  process.exit(1);
});
