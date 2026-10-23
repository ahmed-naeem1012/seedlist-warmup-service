const path = require('path');

/**
 * Settings for spam outreach, read once from the environment.
 *
 * One Gmail mailbox (MAILBOX_EMAIL) is the spam trap: the sweeper keeps its Inbox empty by
 * moving everything to Spam, and each outreach cycle screenshots new mail in Spam, finds
 * who to write to at the sending company (GetLeads) and forwards the company's own email
 * to them from the same mailbox.
 */

// Blank counts as unset: .env.example ships every key present but empty.
function env(name) {
  const value = process.env[name] && process.env[name].trim();
  return value ? value : undefined;
}

const backendDir = path.resolve(__dirname, '..', '..');
const dataDir = env('SPAM_OUTREACH_DATA_DIR') || path.join(backendDir, 'spam-outreach-data');

function positiveInt(name, fallback) {
  const raw = env(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive whole number (got "${raw}").`);
  }
  return parsed;
}

const config = {
  mailbox: {
    // A short label stored with every record, so state from different trap mailboxes
    // never mixes.
    id: env('SPAM_OUTREACH_MAILBOX_ID') || 'mike',
    email: env('SPAM_OUTREACH_MAILBOX_EMAIL'),
  },
  imap: {
    host: env('SPAM_OUTREACH_IMAP_HOST') || 'imap.gmail.com',
    // A Google app password for the mailbox — not the account password.
    appPassword: env('SPAM_OUTREACH_APP_PASSWORD') || '',
  },
  smtp: {
    host: env('SPAM_OUTREACH_SMTP_HOST') || 'smtp.gmail.com',
  },
  // Display name on sent forwards, e.g. "Mike H". Blank = the bare address.
  senderName: env('SPAM_OUTREACH_SENDER_NAME'),

  // Chrome profile holding the mailbox's Gmail sign-in. A person signs in to Gmail in this
  // profile once, by hand, on the machine that runs the cycle; every cycle reuses it.
  chromeProfileDir: env('SPAM_OUTREACH_CHROME_PROFILE_DIR') || path.join(dataDir, 'chrome-profile'),
  screenshotsDir: env('SPAM_OUTREACH_SCREENSHOTS_DIR') || path.join(dataDir, 'screenshots'),

  getleads: {
    apiKey: env('SPAM_OUTREACH_GETLEADS_API_KEY') || '',
    baseUrl: env('SPAM_OUTREACH_GETLEADS_BASE_URL') || 'https://app.getleads.io',
  },

  // New spam messages captured + looked up per cycle (each costs GetLeads credits).
  // Blank = no limit.
  maxMessagesPerCycle: positiveInt('SPAM_OUTREACH_MAX_MESSAGES_PER_CYCLE', undefined),
  // On unless set to "false". Off = capture and look up only, write nothing; on = save
  // each forward to Drafts (or send it, with SEND_ENABLED).
  draftsEnabled: env('SPAM_OUTREACH_DRAFTS_ENABLED') !== 'false',
  // On (with drafts on) = send each forward instead of saving it. Irreversible.
  sendEnabled: env('SPAM_OUTREACH_SEND_ENABLED') === 'true',
  // Hard cap on sends per cycle, so a bad run reaches a handful of people, not hundreds.
  maxSendsPerCycle: positiveInt('SPAM_OUTREACH_MAX_SENDS_PER_CYCLE', 5),
  // Contact companies whose mail the sweeper moved into Spam, using sweptTemplate.
  includeSwept: env('SPAM_OUTREACH_INCLUDE_SWEPT') === 'true',
};

/** Throws a clear message for whatever a job needs that is missing. */
function requireConfig(...keys) {
  const missing = [];
  if (keys.includes('mailbox') && !config.mailbox.email) missing.push('SPAM_OUTREACH_MAILBOX_EMAIL');
  if (keys.includes('imap') && !config.imap.appPassword) missing.push('SPAM_OUTREACH_APP_PASSWORD');
  if (keys.includes('getleads') && !config.getleads.apiKey) missing.push('SPAM_OUTREACH_GETLEADS_API_KEY');
  if (missing.length) throw new Error(`Spam outreach is missing settings: ${missing.join(', ')}`);
}

module.exports = { config, requireConfig };
