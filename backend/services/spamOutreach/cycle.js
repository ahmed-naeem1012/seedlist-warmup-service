const { config, requireConfig } = require('./config');
const { openGmailSession, listSpamMessages, openOlderSpamPage, returnToFirstPage } = require('./gmailBrowser');
const { captureSpamMessage } = require('./capture');
const { lookupCompanyContacts, GetLeadsTransientError } = require('./getleads');
const { forwardMessage } = require('./forward');
const { isSwept, planOutreach } = require('./plan');
const { isSkippedDomain, isSystemSender } = require('./spamFilters');
const store = require('./store');

/**
 * One outreach cycle, registered in cronJobs.js every 15 minutes (SPAM_OUTREACH_CYCLE=true):
 *
 *   1. capture — read the trap mailbox's Spam folder (paging back while the budget lasts),
 *      skip what is never outreach, and screenshot each new message;
 *   2. lookup  — find who to write to at the sending company (GetLeads);
 *   3. forward — forward each company's own email to those people, as a draft or sent.
 */

/** How far back a cycle pages through Spam: 5 pages, Gmail's 250 most recent. */
const MAX_SPAM_PAGES = 5;

const log = (...args) => console.log('[Spam Outreach]', ...args);
const logError = (...args) => console.error('[Spam Outreach]', ...args);

async function captureAndLookup(page) {
  const mailboxId = config.mailbox.id;
  const messages = await listSpamMessages(page, mailboxId);
  const state = await store.loadState();

  // Read AFTER listing, not before. The sweeper records each move before making it, so
  // every message already visible in Spam is on record by now; reading first would miss
  // anything moved in between and label it as Gmail's own filtering.
  const forced = await store.loadForcedThreadIds();
  const sweepRecord = { forcedThreads: forced, forcedDomains: await store.loadForcedDomains() };
  const spamSourceOf = (threadId) => (forced.has(threadId) ? 'forced_by_us' : 'gmail_filter');

  log(`Spam folder for ${config.mailbox.email}: ${messages.length} message(s).`);

  const limit = config.maxMessagesPerCycle;
  let processedNew = 0;
  let budgetSpent = false;

  // Page 1 first, then older pages while this cycle's budget lasts. Each page is fully
  // handled before moving on, so rowIndex stays valid for the page on screen.
  let pageMessages = messages;
  for (let pageNumber = 1; pageMessages; pageNumber++) {
    if (pageNumber > 1) log(`Spam page ${pageNumber}: ${pageMessages.length} message(s).`);

    for (const message of pageMessages) {
      let entry = store.getEntry(state, mailboxId, message.id);
      const swept = isSwept(message.id, message.fromDomain, sweepRecord);
      // With INCLUDE_SWEPT on, swept mail skipped while it was off gets a fresh pass.
      if (config.includeSwept && entry && entry.status === 'skipped_forced') entry = undefined;

      // Checked before capturing: there is no reason to screenshot a Google security alert,
      // and doing so would spend the per-cycle budget on messages that can never become
      // outreach.
      if (!entry && (isSkippedDomain(message.fromDomain) || isSystemSender(message.fromEmail))) {
        store.upsertEntry(state, mailboxId, message.id, {
          status: 'skipped_domain',
          fromEmail: message.fromEmail,
          fromDomain: message.fromDomain,
          subject: message.subject,
          firstSeenAt: new Date().toISOString(),
          spamSource: spamSourceOf(message.id),
          skippedReason: `${message.fromDomain} is not an outreach target.`,
          attempts: 0,
        });
        await store.saveState(state);
        log(`Skipped ${message.fromEmail} — ${message.fromDomain} is not an outreach target.`);
        continue;
      }

      // Moved here by our own sweeper (or from a company the sweeper has ever moved, whose
      // later spam placement may be Gmail learning from our reports). Skipped unless
      // INCLUDE_SWEPT is on, which lets them through to be contacted with the swept note.
      const movedThread = spamSourceOf(message.id) === 'forced_by_us';
      if (!entry && swept && !config.includeSwept) {
        store.upsertEntry(state, mailboxId, message.id, {
          status: 'skipped_forced',
          fromEmail: message.fromEmail,
          fromDomain: message.fromDomain,
          subject: message.subject,
          firstSeenAt: new Date().toISOString(),
          spamSource: movedThread ? 'forced_by_us' : 'gmail_filter',
          skippedReason: movedThread
            ? 'Moved to Spam by the sweeper, not by Gmail.'
            : 'The sweeper has reported this sender to Gmail before, so its spam placement may be our doing.',
          attempts: 0,
        });
        await store.saveState(state);
        continue;
      }

      if (limit !== undefined && store.needsCapture(entry) && processedNew >= limit) {
        log(`Reached SPAM_OUTREACH_MAX_MESSAGES_PER_CYCLE (${limit}) — leaving the rest for the next cycle.`);
        budgetSpent = true;
        break;
      }

      if (store.needsCapture(entry)) {
        processedNew += 1;
        // One message that will not screenshot must not stall the queue: it is recorded
        // for a retry on a later cycle (up to MAX_ATTEMPTS) and the cycle moves on.
        let captured;
        try {
          captured = await captureSpamMessage(page, message, config.screenshotsDir);
        } catch (err) {
          const reason = (err && err.message ? err.message : String(err)).split('\n')[0];
          const attempts = ((entry && entry.attempts) || 0) + 1;
          store.upsertEntry(state, mailboxId, message.id, {
            status: 'capture_failed_retry',
            fromEmail: message.fromEmail,
            fromDomain: message.fromDomain,
            subject: message.subject,
            firstSeenAt: (entry && entry.firstSeenAt) || new Date().toISOString(),
            spamSource: spamSourceOf(message.id),
            lastError: reason,
            attempts,
          });
          await store.saveState(state);
          logError(`Capture failed for ${message.fromEmail} (attempt ${attempts}): ${reason} — moving on.`);
          continue;
        }

        entry = {
          status: 'captured',
          fromEmail: message.fromEmail,
          fromDomain: message.fromDomain,
          subject: message.subject,
          firstSeenAt: new Date().toISOString(),
          screenshotPath: captured.screenshotPath,
          spamSource: spamSourceOf(message.id),
          spamEvidence: !swept,
          ...(swept ? { swept: true } : {}),
          attempts: 0,
        };
        log(`Captured ${message.fromEmail} -> ${captured.screenshotPath}`);
        store.upsertEntry(state, mailboxId, message.id, entry);
        await store.saveState(state);
      }

      if (entry && store.needsLookup(entry)) {
        await lookupContacts(state, mailboxId, message.id, entry);
        await store.saveState(state);
      }
    }

    if (budgetSpent || pageNumber >= MAX_SPAM_PAGES) break;
    pageMessages = await openOlderSpamPage(page, mailboxId);
  }

  await returnToFirstPage(page);
}

/** GetLeads resolves a domain to its people in one step; the result is cached per domain. */
async function lookupViaGetLeads(domain) {
  const { companyName, companySize, sizeRange, companyKnown, recipients } = await lookupCompanyContacts(domain);
  const status = recipients ? 'ok' : companyKnown ? 'no_contacts_found' : 'no_org_match';
  log(
    `GetLeads ${domain}: ${companySize}${sizeRange ? ` (${sizeRange})` : ''} — ` +
      (recipients
        ? `To ${recipients.to.title} <${recipients.to.email}>` + recipients.cc.map((c) => `, Cc ${c.title} <${c.email}>`).join('')
        : 'nobody suitable')
  );
  return {
    status,
    organization: companyKnown ? { id: domain, name: companyName || domain, domain } : null,
    headOfSales: null,
    cro: null,
    recipients,
    companySize: sizeRange ? `${companySize} (${sizeRange})` : companySize,
    cachedAt: new Date().toISOString(),
  };
}

/**
 * Recipients from a cached lookup. Lookups cached before the size-based rules only carry a
 * CRO and a Head of Sales, which map onto the old To-the-CRO, Cc-sales arrangement.
 */
function recipientsOf(cached) {
  if (cached.recipients !== undefined) {
    return cached.recipients && cached.recipients.to && cached.recipients.to.email ? cached.recipients : null;
  }
  const to = cached.cro && cached.cro.email ? cached.cro : cached.headOfSales && cached.headOfSales.email ? cached.headOfSales : null;
  if (!to) return null;
  const cc = to === cached.cro && cached.headOfSales && cached.headOfSales.email ? [cached.headOfSales] : [];
  return { to, cc };
}

async function lookupContacts(state, mailboxId, messageId, entry) {
  // Google's own notices and free-mail providers are never outreach targets.
  if (isSkippedDomain(entry.fromDomain)) {
    entry.status = 'skipped_domain';
    entry.skippedReason = `${entry.fromDomain} is not an outreach target.`;
    store.upsertEntry(state, mailboxId, messageId, entry);
    log(`Skipped ${entry.fromEmail} — ${entry.fromDomain} is not an outreach target.`);
    return;
  }

  try {
    let cached = store.getDomainCache(state, entry.fromDomain);
    if (!cached) {
      cached = await lookupViaGetLeads(entry.fromDomain);
      store.setDomainCache(state, entry.fromDomain, cached);
    }

    if (cached.status === 'no_org_match') {
      entry.status = 'no_org_match';
    } else {
      const recipients = cached.status === 'ok' ? recipientsOf(cached) : null;
      if (!recipients) {
        entry.status = 'no_contacts_found';
      } else {
        entry.organizationId = cached.organization && cached.organization.id;
        entry.companyName = cached.organization && cached.organization.name;
        entry.toEmail = recipients.to.email || undefined;
        entry.toFirstName = recipients.to.firstName || undefined;
        entry.ccEmails = recipients.cc.map((c) => c.email).filter(Boolean);
        entry.status = 'ready_to_draft';
      }
    }
    entry.lastError = undefined;
  } catch (err) {
    const transient = err instanceof GetLeadsTransientError;
    // A credit or rate-limit outage is not this message's fault, so it doesn't spend an
    // attempt — otherwise a few cycles during a billing gap would abandon everything.
    if (!transient) entry.attempts += 1;
    entry.lastError = err && err.message ? err.message : String(err);
    entry.status = 'lookup_pending_retry';
    logError(`GetLeads lookup ${transient ? 'paused' : 'failed'} for ${mailboxId}/${messageId}:`, entry.lastError);
  }

  store.upsertEntry(state, mailboxId, messageId, entry);
}

async function processDrafts() {
  const state = await store.loadState();
  // Re-read at send time: the sweeper may have moved a company's mail since it was queued,
  // and it must then get the swept note, not the default one.
  const sweepRecord = {
    forcedThreads: await store.loadForcedThreadIds(),
    forcedDomains: await store.loadForcedDomains(),
  };
  const pending = [];

  // Everyone ever written to (To and Cc), across every trap mailbox — the same company
  // often spams from several domains, and nobody is contacted twice.
  const alreadyContacted = new Set();

  for (const [mailboxId, messages] of Object.entries(state.mailboxes)) {
    for (const [messageId, entry] of Object.entries(messages)) {
      for (const cc of entry.draftedCc || []) alreadyContacted.add(cc.toLowerCase());
      if (entry.draftedTo) alreadyContacted.add(entry.draftedTo.toLowerCase());
      // Forwarding, though, is limited to the mailbox we are signed into.
      if (mailboxId === config.mailbox.id && store.needsDraft(entry)) {
        pending.push({ mailboxId, messageId, entry });
      }
    }
  }

  if (pending.length === 0) return;

  if (!config.draftsEnabled) {
    log(`${pending.length} message(s) ready, but SPAM_OUTREACH_DRAFTS_ENABLED=false — holding.`);
    return;
  }

  const sending = config.sendEnabled;
  log(
    `${pending.length} message(s) queued — ${sending ? `SENDING (max ${config.maxSendsPerCycle} this cycle)` : 'saving drafts only'} from ${config.mailbox.email}...`
  );

  let sentThisCycle = 0;
  let draftedThisCycle = 0;

  for (const { mailboxId, messageId, entry } of pending) {
    // Lookups from before the size-based rules carry only the CRO / Head of Sales fields.
    const to = entry.toEmail || entry.croEmail || entry.headOfSalesEmail;
    const legacyCc = entry.croEmail && entry.headOfSalesEmail ? [entry.headOfSalesEmail] : [];
    // Anyone already written to elsewhere is dropped from Cc rather than mailed again.
    const cc = (entry.ccEmails || legacyCc).filter(
      (c) => c.toLowerCase() !== (to || '').toLowerCase() && !alreadyContacted.has(c.toLowerCase())
    );
    if (!to) continue;

    const swept = isSwept(messageId, entry.fromDomain, sweepRecord, entry);
    const plan = planOutreach(entry, swept, config.includeSwept);
    if (plan.kind === 'missing_attachment') continue;
    if (plan.kind === 'hold') {
      log(`Holding ${entry.fromDomain} — swept company, and ${plan.reason}.`);
      continue;
    }
    if (plan.kind === 'skip_swept') {
      entry.status = 'skipped_forced';
      entry.skippedReason = 'Moved to Spam by the sweeper, not by Gmail.';
      store.upsertEntry(state, mailboxId, messageId, entry);
      await store.saveState(state);
      continue;
    }

    if (alreadyContacted.has(to.toLowerCase())) {
      entry.status = 'skipped_duplicate_recipient';
      entry.skippedReason = `${to} was already drafted to for another spam domain.`;
      store.upsertEntry(state, mailboxId, messageId, entry);
      await store.saveState(state);
      log(`Skipped ${entry.fromDomain} — ${to} already contacted.`);
      continue;
    }

    // The per-cycle cap only limits sending. Drafting is reversible; sending is not, and a
    // runaway cycle would be unrecoverable.
    if (sending && sentThisCycle >= config.maxSendsPerCycle) {
      log(`Reached SPAM_OUTREACH_MAX_SENDS_PER_CYCLE (${config.maxSendsPerCycle}) — the rest wait for the next cycle.`);
      break;
    }

    // Greet whoever actually ends up in the To: field.
    const recipientFirstName = entry.toEmail ? entry.toFirstName : entry.croEmail ? entry.croFirstName : entry.headOfSalesFirstName;

    try {
      // The template's body becomes the note above the forwarded message; the subject is
      // the original's, prefixed "Fwd:".
      const companyName = entry.companyName || entry.fromDomain;
      const { body } = plan.template({
        companyName,
        senderDomain: entry.fromDomain,
        spamSubject: entry.subject,
        recipientFirstName,
      });

      const { sent } = await forwardMessage(
        { threadId: messageId, fromEmail: entry.fromEmail, to, cc, note: body, attachmentPath: plan.attachmentPath, companyName },
        { send: sending }
      );

      // Recorded before anything else can fail: once a message is gone it must never be
      // retried, or the same person receives it twice.
      entry.draftedTo = to;
      entry.draftedCc = cc;
      entry.swept = plan.swept;
      const note = plan.swept ? 'swept note' : 'spam note';
      for (const c of cc) alreadyContacted.add(c.toLowerCase());
      alreadyContacted.add(to.toLowerCase());
      entry.lastError = undefined;

      if (sent) {
        entry.status = 'sent';
        entry.sentAt = new Date().toISOString();
        sentThisCycle += 1;
        log(`SENT ${note} to ${to}${cc.length ? ` (cc ${cc.join(', ')})` : ''} re: ${entry.fromDomain}`);
      } else {
        entry.status = 'drafted';
        entry.draftedAt = new Date().toISOString();
        draftedThisCycle += 1;
        log(`Drafted ${note} to ${to}${cc.length ? ` (cc ${cc.join(', ')})` : ''} re: ${entry.fromDomain}`);
      }
    } catch (err) {
      entry.attempts += 1;
      entry.lastError = err && err.message ? err.message : String(err);
      entry.status = 'draft_failed_retry';
      logError(`Forward failed for ${mailboxId}/${messageId}:`, entry.lastError);
    }

    store.upsertEntry(state, mailboxId, messageId, entry);
    await store.saveState(state);
  }

  if (sentThisCycle > 0) log(`Sent ${sentThisCycle} forward(s) this cycle.`);
  if (draftedThisCycle > 0) log(`Saved ${draftedThisCycle} forward(s) to Drafts this cycle.`);
}

/** The cron job: one full capture → lookup → forward pass. */
async function runSpamOutreachCycle() {
  requireConfig('mailbox', 'imap', 'getleads');

  const session = await openGmailSession();
  try {
    try {
      await captureAndLookup(session.page);
    } catch (err) {
      logError('Failed capturing spam messages:', err && err.message ? err.message : err);
    }
  } finally {
    // The browser is only needed for capture; forwarding goes over IMAP/SMTP.
    await session.close();
  }

  try {
    await processDrafts();
  } catch (err) {
    logError('Failed processing forwards:', err && err.message ? err.message : err);
  }

  return 'cycle complete';
}

module.exports = { runSpamOutreachCycle };
