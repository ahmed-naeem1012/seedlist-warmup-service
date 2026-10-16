const fs = require('fs/promises');
const puppeteer = require('puppeteer');
const { config } = require('./config');
const { domainFromEmail } = require('./spamFilters');

/**
 * Gmail in a headless browser, using a Chrome profile a person has signed in to.
 *
 * The browser never logs in itself. A person signs in to the trap mailbox's Gmail once,
 * by hand, in a Chrome window using SPAM_OUTREACH_CHROME_PROFILE_DIR on the machine that
 * runs the cycle (see README_SPAM_OUTREACH.md); the sign-in is kept in that profile and
 * every cycle opens it. When it lapses, openSpamFolder reports "Not signed in" — sign in
 * again the same way.
 *
 * Gmail's page enforces Trusted Types, which blocks Puppeteer's waitForFunction; every
 * wait here polls with plain page.evaluate calls instead.
 */

const ROW_SELECTOR = 'tr.zA';
const GMAIL_SPAM_URL = 'https://mail.google.com/mail/u/0/#spam';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls fn in the page until it returns something truthy, or gives up after timeoutMs. */
async function waitInPage(page, fn, arg, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await page.evaluate(fn, arg).catch(() => null);
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

// ── Session ─────────────────────────────────────────────────────────────────

/**
 * Opens a headless browser on the signed-in Chrome profile. Only one Chrome may use a
 * profile at a time, so a sign-in window left open on the same profile must be closed
 * before the cycle runs.
 */
async function openGmailSession() {
  try {
    await fs.access(config.chromeProfileDir);
  } catch {
    throw new Error(
      `No Chrome profile at ${config.chromeProfileDir}. Sign in to ${config.mailbox.email}'s Gmail ` +
        'there once by hand (see README_SPAM_OUTREACH.md).'
    );
  }

  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: config.chromeProfileDir,
    // Puppeteer's default 30s is not enough for a cold Chrome on a busy or slow machine.
    timeout: 180000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    // The same frame the screenshots have always used.
    defaultViewport: { width: 1400, height: 1000 },
  });
  const page = await browser.newPage();

  return {
    page,
    async close() {
      // The sign-in lives on in the profile folder; nothing else to save.
      await browser.close().catch(() => {});
    },
  };
}

// ── The Spam folder ─────────────────────────────────────────────────────────

/** Gmail's app shell (the Compose button) — the only proof the client is usable. */
function shellLoaded() {
  return Array.from(document.querySelectorAll('div[role="button"]')).some((d) => d.textContent.trim() === 'Compose');
}

/**
 * Verifies Gmail is signed in as the mailbox we were configured to use, so screenshots and
 * forwards can never come from the wrong account.
 */
async function assertSignedInAs(page, expectedEmail) {
  const label = await page.evaluate(() => {
    const el = document.querySelector('a[aria-label^="Google Account"], [aria-label*="Google Account:"]');
    return el ? el.getAttribute('aria-label') : null;
  });
  const match = label && label.match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (!match) return; // couldn't read it — don't block the run on a cosmetic selector
  if (match[0].toLowerCase() !== expectedEmail.toLowerCase()) {
    throw new Error(`Gmail is signed in as ${match[0]} but SPAM_OUTREACH_MAILBOX_EMAIL is ${expectedEmail}. Save a session for the right account.`);
  }
}

/**
 * Closes Gmail's occasional prompts (notification permission, feature tours) — they would
 * otherwise be baked into the screenshot that goes out.
 */
async function dismissGmailPrompts(page) {
  for (const label of ['No thanks', 'Not now', 'Dismiss', 'Got it']) {
    await page.evaluate((text) => {
      const button = Array.from(document.querySelectorAll('button, [role="button"]')).find(
        (b) => b.offsetParent && b.textContent.trim() === text
      );
      if (button) button.click();
    }, label);
  }
}

async function openSpamFolder(page) {
  await page.goto(GMAIL_SPAM_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  if (!(await waitInPage(page, shellLoaded, null, 90000))) {
    // A cold or wedged client sometimes needs one more load to come back.
    await page.goto(GMAIL_SPAM_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!(await waitInPage(page, shellLoaded, null, 90000))) {
      throw new Error(`Gmail did not finish loading at ${page.url()} — skipped rather than reporting an empty folder.`);
    }
  }

  // An expired session redirects to the Google sign-in page. Without this check the run
  // would report "0 messages" and look like an empty spam folder.
  const url = page.url();
  if (!url.includes('mail.google.com') || url.includes('accounts.google.com')) {
    throw new Error(`Not signed in to Gmail (landed on ${url}). The saved session has expired — save a fresh one.`);
  }

  await assertSignedInAs(page, config.mailbox.email);
  await dismissGmailPrompts(page);

  // Never report "no spam" on faith: wait for rows, or for Gmail's empty-folder notice.
  const rendered = await waitInPage(
    page,
    (rowSelector) =>
      document.querySelectorAll(rowSelector).length > 0 ||
      /Delete all spam messages now|no spam|Hooray/i.test(document.body.innerText),
    ROW_SELECTOR,
    20000
  );
  if (!rendered) {
    throw new Error(`Could not confirm the Spam folder rendered at ${page.url()}. Refusing to treat this as an empty folder.`);
  }
}

/**
 * Reads every row on the current page in one pass. No message is ever opened, so nothing
 * gets marked read and the sender's tracking pixels never fire.
 *
 * Only rows on screen count: after paging, Gmail can keep the previous page's rows in the
 * document, hidden. rowIndex counts every row, matching document order.
 */
async function readSpamRows(page, mailboxId) {
  const rows = await page.evaluate((rowSelector) => {
    return Array.from(document.querySelectorAll(rowSelector)).map((row, rowIndex) => {
      // The thread id lives on a span INSIDE the row, not on the <tr> itself.
      const legacyId = row.querySelector('span[data-legacy-thread-id]');
      const threadId = row.querySelector('span[data-thread-id]');
      const sender = row.querySelector('span[email]');
      const subject = row.querySelector('span.bog');
      const dateSpan = row.querySelector('td.xW span');
      const legacy = legacyId && legacyId.getAttribute('data-legacy-thread-id');
      const prefixed = threadId && threadId.getAttribute('data-thread-id');
      return {
        rowIndex,
        visible: Boolean(row.offsetParent),
        id: legacy || (prefixed ? prefixed.replace(/[^a-zA-Z0-9_-]/g, '_') : null),
        fromEmail: sender ? sender.getAttribute('email') || '' : '',
        subject: subject ? subject.textContent || '' : '',
        date: dateSpan ? dateSpan.getAttribute('title') || dateSpan.textContent || '' : '',
      };
    });
  }, ROW_SELECTOR);

  return rows
    .filter((row) => row.visible && row.id && row.fromEmail)
    .map((row) => ({
      id: row.id,
      mailboxId,
      fromEmail: row.fromEmail,
      fromDomain: domainFromEmail(row.fromEmail),
      subject: row.subject.trim(),
      date: row.date.trim(),
      rowIndex: row.rowIndex,
    }));
}

async function listSpamMessages(page, mailboxId) {
  await openSpamFolder(page);
  return readSpamRows(page, mailboxId);
}

function firstVisibleThreadId(rowSelector) {
  const row = Array.from(document.querySelectorAll(rowSelector)).find((r) => r.offsetParent);
  const span = row && row.querySelector('span[data-legacy-thread-id]');
  return span ? span.getAttribute('data-legacy-thread-id') : null;
}

/**
 * Moves the Spam list one page older (50 per page) and reads it, or returns null when
 * there is no older page.
 *
 * Changes Gmail's in-app address ("#spam/p2", "#spam/p3", …) from inside the page, which
 * swaps the list without reloading. A full reload onto the new address leaves Gmail on
 * its loading screen, and the visible "Older" button can belong to a stale toolbar.
 */
async function openOlderSpamPage(page, mailboxId) {
  const hash = new URL(page.url()).hash;
  const match = hash.match(/^#spam\/p(\d+)$/);
  const current = match ? Number(match[1]) : 1;
  const firstIdBefore = await page.evaluate(firstVisibleThreadId, ROW_SELECTOR);
  await page.evaluate((next) => {
    location.hash = next;
  }, `#spam/p${current + 1}`);

  // Gmail can take half a minute to draw an older page; past the last page the list
  // never changes, which ends paging.
  const changed = await waitInPage(
    page,
    ({ rowSelector, before }) => {
      const row = Array.from(document.querySelectorAll(rowSelector)).find((r) => r.offsetParent);
      const span = row && row.querySelector('span[data-legacy-thread-id]');
      const id = span && span.getAttribute('data-legacy-thread-id');
      return Boolean(id) && id !== before;
    },
    { rowSelector: ROW_SELECTOR, before: firstIdBefore },
    60000
  );
  if (!changed) {
    console.log(`[Spam Outreach] No Spam page ${current + 1} (or it did not load) — stopping at page ${current}.`);
    return null;
  }

  await sleep(1000);
  return readSpamRows(page, mailboxId);
}

/** Back to page 1, so the next cycle never opens on a stale older page. */
async function returnToFirstPage(page) {
  if (!page.url().endsWith('#spam')) {
    await page
      .evaluate(() => {
        location.hash = '#spam';
      })
      .catch(() => {});
  }
}

module.exports = {
  ROW_SELECTOR,
  openGmailSession,
  listSpamMessages,
  openOlderSpamPage,
  returnToFirstPage,
  waitInPage,
  sleep,
};
