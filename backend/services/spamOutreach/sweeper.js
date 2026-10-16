const { ImapFlow } = require('imapflow');
const { config, requireConfig } = require('./config');
const { readContactedAddresses, recordForcedDomains, recordForcedThreadIds } = require('./store');

/**
 * Keeps the trap mailbox's Inbox empty by moving everything in it to Spam, over IMAP.
 * Registered in cronJobs.js to run every 15 seconds (SPAM_OUTREACH_SWEEPER=true).
 *
 * Gmail has no setting that sends mail to Spam, so this does it directly.
 *
 *  - The WHOLE Inbox is swept each pass, not just mail that arrived since the last one, so
 *    anything that landed while the service was down is cleared on the next pass.
 *  - Replies from anyone already drafted to or emailed stay in the Inbox — moving them
 *    would hide a prospect's answer in Spam.
 *  - Every moved thread (and its sender's domain) is recorded BEFORE the move, so the
 *    outreach cycle can tell mail we moved from mail Gmail filtered itself. Recording
 *    first means a failed move leaves an extra record, never a missing one.
 */

// One connection kept open across runs; reconnected whenever it drops.
let client = null;
let spamFolder = null;
let lastKept = 0;

/** Gmail reports thread ids over IMAP in decimal; the web client (and our records) use hex. */
function toLegacyThreadId(threadId) {
  return BigInt(threadId).toString(16);
}

async function connect() {
  const next = new ImapFlow({
    host: config.imap.host,
    port: 993,
    secure: true,
    auth: { user: config.mailbox.email, pass: config.imap.appPassword },
    logger: false,
  });
  // A dropped socket (network blip, server restart) arrives as an 'error' event; unhandled
  // it would kill the whole service. `usable` goes false and the next run reconnects.
  next.on('error', (err) => console.error('[Spam Outreach Sweeper] connection error:', err.message));
  await next.connect();
  const folders = await next.list();
  const junk = folders.find((f) => f.specialUse === '\\Junk');
  spamFolder = junk ? junk.path : '[Gmail]/Spam';
  client = next;
}

async function sweepInboxToSpam() {
  requireConfig('mailbox', 'imap');
  if (!client || !client.usable) await connect();

  // Returns undefined when there was nothing to do, so the 15-second job stays quiet.
  const lock = await client.getMailboxLock('INBOX');
  try {
    if (!client.mailbox || client.mailbox.exists === 0) return undefined;

    // Read fresh every pass: the outreach cycle adds recipients while this runs.
    const contacted = await readContactedAddresses();

    const uids = [];
    const threadIds = [];
    const domains = [];
    let keptReplies = 0;

    for await (const msg of client.fetch('1:*', { uid: true, envelope: true, threadId: true })) {
      const sender = msg.envelope && msg.envelope.from && msg.envelope.from[0] && msg.envelope.from[0].address;
      const from = (sender || '').toLowerCase();
      if (from && contacted.has(from)) {
        keptReplies += 1;
        continue;
      }
      uids.push(msg.uid);
      if (from.includes('@')) domains.push(from.split('@')[1]);
      if (msg.threadId) threadIds.push(toLegacyThreadId(msg.threadId));
    }

    // Reported once per change, so a reply waiting for a human isn't logged every 15s.
    if (keptReplies !== lastKept && keptReplies > 0) {
      console.log(`[Spam Outreach Sweeper] left ${keptReplies} reply(ies) from contacted recipients in the Inbox`);
    }
    lastKept = keptReplies;

    if (uids.length === 0) return undefined;

    await recordForcedThreadIds(threadIds);
    await recordForcedDomains(domains);
    await client.messageMove(uids, spamFolder, { uid: true });
    return { moved: uids.length, keptReplies };
  } finally {
    lock.release();
  }
}

module.exports = { sweepInboxToSpam };
