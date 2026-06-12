
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const crypto = require('crypto');
const axios = require('axios');
const puppeteer = require('puppeteer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

// TARGET SENDERS - High engagement emails (supports multiple senders!)
const TARGET_SENDERS = [
  // 'marketing@gammaprime.com',
  // 'daniyal@heyscale.io',
  // 'daniyal@hello.maxify.co',
  // 'daniyal@maxify.co',
  // 'daniyal=maxify.co@hubspotstarter.na3.hs-send.com',
  'possible@info.possibleevent.com',  // ✅ NOW ENABLED
  // 'hlth@events.hlth.com',
];
const MAX_EMAIL_AGE_HOURS = 240; // Only engage with emails less than 240 hours old

//  DYNAMIC CLICK CONTROL - Clicks enabled for first X mailboxes ONLY
const CLICK_ENABLED_UNTIL_INDEX = 730;

// ⭐ START FROM SPECIFIC MAILBOX - Change this to start from any index (1 = start from beginning)
const START_FROM_INDEX = 1; // CHANGE THIS TO START FROM A DIFFERENT MAILBOX!

// ENGAGEMENT CONFIG
const ENGAGEMENT_CONFIG = {
  open_rate: 0.95,     // 95% - emails opened (out of 100)
  click_rate: 0.80,    // 80% - emails clicked (out of OPENED emails, not out of 100)
  read_time_min: 5000, // 5 seconds minimum
  read_time_max: 10000, // 10 seconds maximum
  click_delay_min: 2000,
  click_delay_max: 4000
};

// ✅ How many mailboxes to process at the same time
const WORKER_CONCURRENCY = parseInt(process.env.SEEDLIST_WORKER_CONCURRENCY || '50');

// Max concurrent Puppeteer pages across all workers (prevents memory overload)
const MAX_PUPPETEER_PAGES = parseInt(process.env.PUPPETEER_PAGE_POOL_SIZE || '30');

// Per-mailbox timeout in ms (20 min = enough for 40+ emails per mailbox)
const MAILBOX_TIMEOUT_MS = parseInt(process.env.SEEDLIST_MAILBOX_TIMEOUT_MS || '1200000');

// ✅ SPECIAL MAILBOX CONFIG - Check READ + UNREAD emails for mailboxes containing "use"
// Examples: max@makemyuserly.com, max@pickmyusers.com, max@putmyuselybase.com
const shouldCheckReadEmails = (email) => {
  return email.toLowerCase().includes('use');
};

// ✅ ENGAGEMENT FLOW:
// 1. Random check: Will this email be opened? (95% chance)
// 2. If YES → Load tracking pixels OR fallback link to register open
// 3. Random check: Will this email be clicked? (80% of opens)
// 4. If YES → Click a random link in the email
// 5. Mark as read and archive
//
// TRACKING SUPPORT:
// - HubSpot (primary focus - comprehensive detection)
// - Brevo/Sendinblue (working)
// - Mailchimp (working)
// - Generic tracking pixels
// - FALLBACK: If no tracking pixels found, loads any link to force-register open

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
, { realtime: { transport: ws } }
);

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

// ═══════════════════════════════════════════════════════════════════
// PAGE SEMAPHORE — limits total concurrent Puppeteer pages
// Prevents memory/CPU spike when many workers all hit the browser
// ═══════════════════════════════════════════════════════════════════
class PageSemaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.waiting = [];
  }
  acquire() {
    if (this.current < this.max) {
      this.current++;
      return Promise.resolve();
    }
    return new Promise(resolve => this.waiting.push(resolve));
  }
  release() {
    if (this.waiting.length > 0) {
      this.waiting.shift()();
    } else {
      this.current--;
    }
  }
}
const pageSemaphore = new PageSemaphore(MAX_PUPPETEER_PAGES);

// ═══════════════════════════════════════════════════════════════════
// CONCURRENCY LIMITER — processes N mailboxes at the same time
// ═══════════════════════════════════════════════════════════════════
const createConcurrencyLimiter = (maxConcurrent) => {
  let running = 0;
  const queue = [];
  return async (fn) => {
    if (running >= maxConcurrent) {
      await new Promise(resolve => queue.push(resolve));
    }
    running++;
    try {
      return await fn();
    } finally {
      running--;
      if (queue.length > 0) queue.shift()();
    }
  };
};

// Global browser instance — shared across ALL concurrent workers
let globalBrowser = null;

const getBrowser = async () => {
  if (!globalBrowser) {
    globalBrowser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });
  }
  return globalBrowser;
};

// IMAP Config
const IMAP_CONFIG = {
  connTimeout: 60000,
  authTimeout: 60000,
  socketTimeout: 120000,
  keepalive: {
    interval: 10000,
    idleInterval: 300000,
    forceNoop: true
  }
};

// Decryption
const decrypt = (encrypted) => {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0')),
      Buffer.alloc(16, 0)
    );
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error(' Decryption error:', error.message);
    throw error;
  }
};

// Helper: Calculate email age in hours
const getEmailAgeHours = (emailDate) => {
  const now = new Date();
  const received = new Date(emailDate);
  return (now - received) / (1000 * 60 * 60);
};

// ═══════════════════════════════════════════════════════════════════
// loadUrl — NOW with page semaphore for safe high-concurrency use
// Tracking logic inside is 100% UNCHANGED
// ═══════════════════════════════════════════════════════════════════
const loadUrl = async (url, type = 'unknown', retries = 2, waitUntil = 'domcontentloaded', delayMs = 1000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    await pageSemaphore.acquire();
    let page = null;
    try {
      const browser = await getBrowser();
      page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.goto(url, { waitUntil, timeout: 15000 });
      await new Promise(resolve => setTimeout(resolve, delayMs));
      await page.close();
      pageSemaphore.release();
      return true;
    } catch (error) {
      if (page) { try { await page.close(); } catch (e) { } }
      pageSemaphore.release();
      console.log(`          ⚠️  ${type} load failed: ${error.message} (attempt ${attempt}/${retries})`);
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return false;
};

// Extract ALL URLs including tracking pixels and links
const extractAllUrls = (emailText, emailHtml) => {
  const urls = [];

  // Extract from plain text
  const textUrlRegex = /https?:\/\/[^\s]+/g;
  const textMatches = (emailText || '').match(textUrlRegex);
  if (textMatches) {
    urls.push(...textMatches);
  }

  // Extract ALL href links (including Mailchimp tracking redirects)
  const hrefRegex = /href=["']([^"']+)["']/g;
  let match;
  while ((match = hrefRegex.exec(emailHtml || '')) !== null) {
    if (match[1].startsWith('http')) {
      urls.push(match[1]);
    }
  }

  // Extract ALL image src URLs (including tracking pixels!)
  const imgRegex = /src=["']([^"']+)["']/g;
  while ((match = imgRegex.exec(emailHtml || '')) !== null) {
    if (match[1].startsWith('http')) {
      urls.push(match[1]);
    }
  }

  // Return unique URLs (DON'T filter out tracking pixels!)
  return [...new Set(urls)];
};

// Simulate read time
const simulateReadTime = async () => {
  const delay = Math.random() *
    (ENGAGEMENT_CONFIG.read_time_max - ENGAGEMENT_CONFIG.read_time_min) +
    ENGAGEMENT_CONFIG.read_time_min;
  await new Promise(resolve => setTimeout(resolve, delay));
};

// Mark as read (UID-based for cross-session persistence!)
const markEmailAsRead = async (mailbox, uid) => {
  if (!uid) {
    console.log(`          ⚠️  WARNING: Attempted to mark as read with null UID!`);
    return;
  }

  return new Promise((resolve, reject) => {
    const appPassword = decrypt(mailbox.app_password).replace(/\s/g, '');

    const imap = new Imap({
      user: mailbox.email,
      password: appPassword,
      host: mailbox.imap_host,
      port: mailbox.imap_port,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: IMAP_CONFIG.connTimeout,
      authTimeout: IMAP_CONFIG.authTimeout
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        // USE UID-BASED OPERATION (addFlags uses UIDs by default in imap library!)
        imap.addFlags(uid, ['\\Seen'], (err) => {
          imap.end();
          if (err) {
            console.log(`          ⚠️  Failed to mark as read: ${err.message}`);
            return reject(err);
          }
          resolve();
        });
      });
    });

    imap.once('error', (err) => {
      reject(err);
    });

    imap.connect();
  });
};

// Archive email (removes from Inbox, Gmail keeps in All Mail) - UID-based!
const moveToMaxifyLabel = async (mailbox, uid) => {
  if (!uid) {
    console.log(`          ⚠️  WARNING: Attempted to archive with null UID!`);
    return;
  }

  return new Promise((resolve, reject) => {
    const appPassword = decrypt(mailbox.app_password).replace(/\s/g, '');

    const imap = new Imap({
      user: mailbox.email,
      password: appPassword,
      host: mailbox.imap_host,
      port: mailbox.imap_port,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: IMAP_CONFIG.connTimeout,
      authTimeout: IMAP_CONFIG.authTimeout
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        // Archive: Mark as deleted (addFlags uses UIDs by default in imap library!)
        imap.addFlags(uid, ['\\Deleted'], (flagErr) => {
          if (flagErr) {
            imap.end();
            console.log(`          ⚠️  Failed to archive: ${flagErr.message}`);
            return reject(flagErr);
          }

          // Expunge to actually remove from INBOX
          imap.expunge((expErr) => {
            imap.end();
            if (expErr) {
              console.log(`          ⚠️  Expunge failed: ${expErr.message}`);
              return reject(expErr);
            }
            resolve();
          });
        });
      });
    });

    imap.once('error', (err) => {
      reject(err);
    });

    imap.connect();
  });
};

// Build IMAP search criteria — supports 1, 2, or 3+ target senders
const buildSearchCriteria = (checkReadEmails, sinceDate) => {
  let senderCriteria;
  if (TARGET_SENDERS.length === 1) {
    senderCriteria = ['FROM', TARGET_SENDERS[0]];
  } else if (TARGET_SENDERS.length === 2) {
    senderCriteria = ['OR', ['FROM', TARGET_SENDERS[0]], ['FROM', TARGET_SENDERS[1]]];
  } else {
    let orChain = ['FROM', TARGET_SENDERS[TARGET_SENDERS.length - 1]];
    for (let i = TARGET_SENDERS.length - 2; i >= 0; i--) {
      orChain = ['OR', ['FROM', TARGET_SENDERS[i]], orChain];
    }
    senderCriteria = orChain;
  }

  if (checkReadEmails) {
    return [senderCriteria, ['SINCE', sinceDate]];
  }
  return ['UNSEEN', senderCriteria, ['SINCE', sinceDate]];
};

// Create an IMAP connection object (does not connect yet)
const createImapObject = (mailbox) => {
  const appPassword = decrypt(mailbox.app_password).replace(/\s/g, '');
  return new Imap({
    user: mailbox.email,
    password: appPassword,
    host: mailbox.imap_host,
    port: mailbox.imap_port,
    tls: true,
    tlsOptions: { rejectUnauthorized: false, minVersion: 'TLSv1.2' },
    connTimeout: IMAP_CONFIG.connTimeout,
    authTimeout: IMAP_CONFIG.authTimeout,
    socketTimeout: IMAP_CONFIG.socketTimeout,
    keepalive: IMAP_CONFIG.keepalive,
    debug: false
  });
};

// ═══════════════════════════════════════════════════════════════════
// checkFolderAndMove — searches a folder and moves matching emails
// to destFolder. Reuses the passed IMAP connection (no new connection!)
// ═══════════════════════════════════════════════════════════════════
const checkFolderAndMove = (imap, folderNames, destFolder, checkReadEmails) => {
  return new Promise((resolve) => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const searchCriteria = buildSearchCriteria(checkReadEmails, sevenDaysAgo);

    const tryFolder = (index) => {
      if (index >= folderNames.length) return resolve(0);

      imap.openBox(folderNames[index], false, (err) => {
        if (err) return tryFolder(index + 1);

        console.log(`      🔍 Searched ${folderNames[index]} for: ${TARGET_SENDERS[0]}`);

        imap.search(searchCriteria, (searchErr, results) => {
          if (searchErr) {
            console.log(`      ⚠️  Search error: ${searchErr.message}`);
            return resolve(0);
          }

          if (!results || results.length === 0) {
            console.log(`      📭 No ${checkReadEmails ? '' : 'UNREAD '}emails found in ${folderNames[index]}`);
            return resolve(0);
          }

          console.log(`  Found ${results.length} email(s) in ${folderNames[index]} - moving ALL to INBOX...`);

          let completed = 0;
          let succeeded = 0;

          results.forEach((seqno) => {
            imap.move(seqno, destFolder, (moveErr) => {
              completed++;
              if (!moveErr) succeeded++;
              if (completed === results.length) {
                setTimeout(() => {
                  console.log(`      ✅ Moved ${succeeded}/${results.length} → INBOX`);
                  resolve(succeeded);
                }, 2000);
              }
            });
          });
        });
      });
    };

    tryFolder(0);
  });
};

// ═══════════════════════════════════════════════════════════════════
// openBoxAndFetchEmails — opens INBOX, searches, fetches+parses emails
// Returns array of { seqno, uid, from, subject, text, html, date }
// ═══════════════════════════════════════════════════════════════════
const openBoxAndFetchEmails = (imap, checkReadEmails) => {
  return new Promise((resolve, reject) => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const searchCriteria = buildSearchCriteria(checkReadEmails, twoDaysAgo);

    imap.openBox('INBOX', false, (err) => {
      if (err) return reject(err);

      console.log(`     🔍 Searched INBOX for ${checkReadEmails ? 'ALL' : 'UNREAD'} emails from: ${TARGET_SENDERS[0]} (last 2 days)`);

      imap.search(searchCriteria, (searchErr, results) => {
        if (searchErr) {
          console.log(`     ⚠️  INBOX search error: ${searchErr.message}`);
          return reject(searchErr);
        }

        if (!results || results.length === 0) {
          console.log(`     📭 No ${checkReadEmails ? '' : 'UNREAD '}emails found in INBOX from target senders`);
          return resolve([]);
        }

        console.log(`     Found ${results.length} email(s) from target sender(s)`);

        const emailsToFetch = results.reverse(); // newest first

        const fetch = imap.fetch(emailsToFetch, {
          bodies: '',
          struct: true,
          markSeen: false,
          envelope: true
        });

        const emailPromises = [];

        fetch.on('message', (msg, seqno) => {
          const emailPromise = new Promise((resolveEmail) => {
            let buffer = '';
            let uid = null;
            let bodyEnded = false;
            let attrsReceived = false;

            msg.once('attributes', (attrs) => {
              uid = attrs.uid;
              attrsReceived = true;
              if (bodyEnded) resolveWithParsed();
            });

            const resolveWithParsed = async () => {
              try {
                const parsed = await simpleParser(buffer);
                if (!uid) uid = seqno;
                resolveEmail({
                  seqno,
                  uid,
                  from: parsed.from,
                  subject: parsed.subject || 'No subject',
                  text: parsed.text || '',
                  html: parsed.html || '',
                  date: parsed.date
                });
              } catch (parseErr) {
                resolveEmail(null);
              }
            };

            msg.on('body', (stream) => {
              stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
              stream.once('end', () => {
                bodyEnded = true;
                if (attrsReceived) resolveWithParsed();
              });
            });

            msg.once('end', () => {
              if (!attrsReceived && bodyEnded) {
                setTimeout(resolveWithParsed, 100);
              }
            });
          });

          emailPromises.push(emailPromise);
        });

        fetch.once('error', (fetchErr) => reject(fetchErr));

        fetch.once('end', async () => {
          const parsed = await Promise.all(emailPromises);
          resolve(parsed.filter(e => e !== null));
        });
      });
    });
  });
};

// ═══════════════════════════════════════════════════════════════════
// processMailboxJob — ONE imap connection handles everything:
//   spam check → promotions check → inbox search → engage → batch archive
// ═══════════════════════════════════════════════════════════════════
const processMailboxJob = (mailbox, mailboxIndex = 999) => {
  const ENABLE_CLICKS = mailboxIndex <= CLICK_ENABLED_UNTIL_INDEX;
  const checkReadEmails = shouldCheckReadEmails(mailbox.email);

  if (checkReadEmails) {
    console.log(`   📖 "USE" MAILBOX DETECTED - Will check READ + UNREAD emails`);
  }
  if (ENABLE_CLICKS) {
    console.log(`   Clicks ENABLED (mailbox ${mailboxIndex}/${CLICK_ENABLED_UNTIL_INDEX})`);
  } else {
    console.log(`   Clicks DISABLED (mailbox ${mailboxIndex} > ${CLICK_ENABLED_UNTIL_INDEX})`);
  }

  return new Promise((resolve) => {
    const imap = createImapObject(mailbox);
    let ended = false;

    const safeEnd = () => {
      if (!ended) {
        ended = true;
        try { imap.end(); } catch (e) { }
      }
    };

    imap.once('error', (err) => {
      console.error(`   IMAP error [${mailbox.email}]: ${err.message}`);
      safeEnd();
      resolve({ mailbox: mailbox.email, found: 0, opened: 0, clicked: 0, error: err.message });
    });

    imap.once('ready', async () => {
      try {
        // ── STEP 0: Check SPAM folder ─────────────────────────
        console.log(`    Checking SPAM folder...`);
        const movedFromSpam = await checkFolderAndMove(
          imap,
          ['[Gmail]/Spam', 'Spam', 'Junk', 'SPAM'],
          'INBOX',
          checkReadEmails
        );

        // ── STEP 0.5: Check PROMOTIONS folder ─────────────────
        console.log(`    Checking PROMOTIONS folder...`);
        const movedFromPromotions = await checkFolderAndMove(
          imap,
          ['[Gmail]/Promotions', 'Promotions', '[Gmail]/All Mail'],
          'INBOX',
          checkReadEmails
        );

        // Wait for Gmail to sync if we moved emails
        if (movedFromSpam + movedFromPromotions > 0) {
          console.log(`    Waiting 5s for Gmail to sync...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // ── STEP 1: Open INBOX and fetch emails ───────────────
        const emails = await openBoxAndFetchEmails(imap, checkReadEmails);

        if (emails.length === 0) {
          safeEnd();
          return resolve({ mailbox: mailbox.email, found: 0, opened: 0, clicked: 0 });
        }

        console.log(`     Found ${emails.length} email(s) from target sender(s)`);

        let openedCount = 0;
        let clickedCount = 0;
        const processedSeqnos = []; // collect seqnos for batch mark+archive at end

        // ── STEP 2: Engage each email ─────────────────────────
        for (const email of emails) {
          try {
            const senderEmail = email.from?.value?.[0]?.address || email.from?.text;

            console.log(`       Campaign: ${senderEmail}`);
            console.log(`          Subject: ${email.subject}`);

            // Age check
            const emailAgeHours = getEmailAgeHours(email.date);
            if (emailAgeHours > MAX_EMAIL_AGE_HOURS) {
              console.log(`          Email is ${emailAgeHours.toFixed(1)}h old (>${MAX_EMAIL_AGE_HOURS}h) - SKIPPING`);
              processedSeqnos.push(email.seqno);
              continue;
            }
            console.log(`          Email age: ${emailAgeHours.toFixed(1)}h (< ${MAX_EMAIL_AGE_HOURS}h) - OK to engage`);

            // Open rate check
            const willOpen = Math.random() < ENGAGEMENT_CONFIG.open_rate;
            if (!willOpen) {
              console.log(`          ❌ Not engaged (skipped - outside ${Math.round(ENGAGEMENT_CONFIG.open_rate * 100)}% engagement window)`);
              processedSeqnos.push(email.seqno);
              continue;
            }

            const willClick = Math.random() < ENGAGEMENT_CONFIG.click_rate;

            // Extract all URLs
            const allUrls = extractAllUrls(email.text, email.html);
            console.log(`          📋 Found ${allUrls.length} total URL(s) in email`);

            // ── Identify tracking pixels ──
            const trackingPixels = allUrls.filter(url => {
              const lowerUrl = url.toLowerCase();

              // Brevo (Sendinblue) tracking patterns
              const isBrevoTracker = lowerUrl.includes('sendinblue.com') ||
                lowerUrl.includes('brevo.com') ||
                lowerUrl.includes('sibautomation.com');

              // HubSpot tracking patterns (COMPREHENSIVE - ALL HUBSPOT OPEN TRACKING METHODS)
              const isHubSpotTracker =
                (lowerUrl.includes('hubspotlinks') && lowerUrl.includes('/cto/')) ||
                lowerUrl.includes('t.hubspot.com') ||
                lowerUrl.includes('t.sidekickopen') ||
                lowerUrl.includes('hubspotemail.net') ||
                lowerUrl.includes('hubspotemail-eu1.net') ||
                lowerUrl.includes('hubspotfree.net') ||
                lowerUrl.includes('hs-email.net') ||
                lowerUrl.includes('hs-sites') ||
                (lowerUrl.includes('hubspot') && (lowerUrl.includes('.png') || lowerUrl.includes('.gif'))) ||
                (lowerUrl.includes('hubspot') && (lowerUrl.includes('/e2t/o/') || lowerUrl.includes('/e2t/to/'))) ||
                lowerUrl.includes('hubfs') ||
                lowerUrl.includes('hs-scripts.com');

              // Generic tracking pixel patterns
              const isTrackingPixel = lowerUrl.includes('track') ||
                lowerUrl.includes('pixel') ||
                lowerUrl.includes('beacon') ||
                lowerUrl.endsWith('.gif') ||
                lowerUrl.endsWith('.png') ||
                lowerUrl.includes('open.php') ||
                lowerUrl.includes('/op/') ||
                lowerUrl.includes('open');

              // Exclude click tracking
              const isNotClickTracker =
                !lowerUrl.includes('mailchi.mp') &&
                !lowerUrl.includes('/cl/') &&
                !(lowerUrl.includes('hubspotlinks') && lowerUrl.includes('/ctc/')) &&
                !lowerUrl.includes('/e2t/c/') &&
                !lowerUrl.includes('/e2t/ct/') &&
                !lowerUrl.includes('click');

              // Exclude branding/attribution URLs — they are NOT real open tracking pixels
              const isFalsePositive =
                lowerUrl.includes('utm_campaign') ||
                lowerUrl.includes('utm_source') ||
                lowerUrl.includes('utm_medium') ||
                lowerUrl.includes('/public/') ||
                lowerUrl.includes('logo_nb') ||
                lowerUrl.includes('logo_mailin');

              return (isBrevoTracker || isHubSpotTracker || isTrackingPixel) && isNotClickTracker && !isFalsePositive;
            });

            // ── Load tracking pixels — PARALLEL (all fire at same time) ──
            if (trackingPixels.length > 0) {
              console.log(`          📊 Found ${trackingPixels.length} tracking pixel(s):`);
              trackingPixels.forEach((pixel, i) => {
                const source = pixel.includes('hubspot') ? 'HubSpot' :
                  pixel.includes('brevo') || pixel.includes('sendinblue') ? 'Brevo' :
                    pixel.includes('mailchimp') ? 'Mailchimp' : 'Generic';
                console.log(`             ${i + 1}. [${source}] ${pixel.substring(0, 100)}...`);
              });
              console.log(`          ⏳ Loading tracking pixels (parallel)...`);
              await Promise.all(trackingPixels.map(pixel => loadUrl(pixel, 'pixel')));
              await new Promise(resolve => setTimeout(resolve, 3000));
              console.log(`          ✅ All tracking pixels loaded!`);
            } else {
              // ✅ FALLBACK: If no tracking pixels found, load any link to register open
              console.log(`          ⚠️  No tracking pixels detected - using fallback method...`);
              const fallbackLinks = allUrls.filter(url => {
                const lowerUrl = url.toLowerCase();
                return url.startsWith('http') &&
                  !lowerUrl.includes('unsubscribe') &&
                  !lowerUrl.includes('preferences');
              });
              if (fallbackLinks.length > 0) {
                console.log(`          🔗 Loading fallback link to register open...`);
                await loadUrl(fallbackLinks[0], 'fallback-open');
                await new Promise(resolve => setTimeout(resolve, 3000));
              } else {
                console.log(`          ⚠️  WARNING: No links found to register open! Email may not track.`);
              }
            }

            openedCount++;
            console.log(`          ✓ EMAIL OPENED (${senderEmail})`);

            // Simulate read time
            await simulateReadTime();

            // ── Click links ──
            if (ENABLE_CLICKS && willClick) {
              const clickableLinks = allUrls.filter(url => {
                const lowerUrl = url.toLowerCase();
                return url.startsWith('http') &&
                  !lowerUrl.includes('unsubscribe') &&
                  !trackingPixels.includes(url) &&
                  !lowerUrl.includes('view-in-browser') &&
                  !lowerUrl.includes('preferences') &&
                  !lowerUrl.includes('view in browser');
              });

              // ✅ PRIORITIZE Brevo/SendinBlue click tracking links
              const brevoClickLinks = clickableLinks.filter(url =>
                url.includes('/mk/cl/') || url.includes('/click/')
              );

              const linksToClickFrom = brevoClickLinks.length > 0 ? brevoClickLinks : clickableLinks;

              if (brevoClickLinks.length > 0) {
                console.log(`          🎯 Found ${brevoClickLinks.length} Brevo click tracking link(s) - prioritizing these!`);
              }

              if (linksToClickFrom.length > 0) {
                const randomLink = linksToClickFrom[Math.floor(Math.random() * linksToClickFrom.length)];
                console.log(`          🖱️  Clicking link...`);
                const clickDelay = Math.random() *
                  (ENGAGEMENT_CONFIG.click_delay_max - ENGAGEMENT_CONFIG.click_delay_min) +
                  ENGAGEMENT_CONFIG.click_delay_min;
                await new Promise(resolve => setTimeout(resolve, clickDelay));
                const clicked = await loadUrl(randomLink, 'click', 2, 'domcontentloaded', 3500);
                if (clicked) {
                  clickedCount++;
                  console.log(`          ✓ CLICKED (${senderEmail}): ${randomLink.substring(0, 80)}...`);
                  await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                  console.log(`          ⚠️  Click failed but continuing...`);
                }
              } else {
                console.log(`          ℹ️  No clickable links found (only tracking pixels/unsubscribe)`);
              }
            } else if (!ENABLE_CLICKS) {
              console.log(`          ℹ️  Clicks DISABLED by kill switch (mailbox ${mailboxIndex} > ${CLICK_ENABLED_UNTIL_INDEX})`);
            } else {
              console.log(`          ℹ️  Open-only engagement (not clicking - ${Math.round((1 - ENGAGEMENT_CONFIG.click_rate) * 100)}% of opens)`);
            }

            // Final delay before archiving
            await new Promise(resolve => setTimeout(resolve, 2000));

            processedSeqnos.push(email.seqno);

          } catch (emailError) {
            console.error(`          Error:`, emailError.message);
          }
        }

        // ── STEP 3: Batch mark-as-read + archive (ONE operation for all) ──
        if (processedSeqnos.length > 0) {
          const seqnoStr = processedSeqnos.join(',');
          try {
            await new Promise((res) => {
              imap.addFlags(seqnoStr, ['\\Seen'], (err) => {
                if (err) console.log(`          ⚠️  Batch mark-as-read failed: ${err.message}`);
                res();
              });
            });
            await new Promise((res) => {
              imap.addFlags(seqnoStr, ['\\Deleted'], (err) => {
                if (err) console.log(`          ⚠️  Batch delete-flag failed: ${err.message}`);
                res();
              });
            });
            await new Promise((res) => {
              imap.expunge((err) => {
                if (err) console.log(`          ⚠️  Expunge failed: ${err.message}`);
                res();
              });
            });
            console.log(`          📁 Archived ${processedSeqnos.length} email(s) from INBOX`);
          } catch (archiveErr) {
            console.log(`          ⚠️  Batch archive error: ${archiveErr.message}`);
          }
        }

        safeEnd();
        resolve({
          mailbox: mailbox.email,
          found: emails.length,
          opened: openedCount,
          clicked: clickedCount
        });

      } catch (error) {
        safeEnd();
        resolve({
          mailbox: mailbox.email,
          found: 0,
          opened: 0,
          clicked: 0,
          error: error.message
        });
      }
    });

    imap.connect();
  });
};

// ═══════════════════════════════════════════════════════════════════
// Main function — runs all active mailboxes concurrently
// ═══════════════════════════════════════════════════════════════════
const engageSeedlistEmails = async () => {
  const startTime = Date.now();

  console.log('\n========================================');
  console.log(`   [BREVO V2] SEEDLIST ENGAGEMENT — PARALLEL MODE`);
  console.log(`   ${WORKER_CONCURRENCY} mailboxes at a time`);
  console.log('========================================\n');
  console.log(` Target Senders (${TARGET_SENDERS.length}):`);
  TARGET_SENDERS.forEach((sender, i) => console.log(`   ${i + 1}. ${sender}`));
  console.log();
  console.log(` Platform: Brevo / Mailchimp / HubSpot Compatible`);
  console.log(` SPAM Check: ENABLED (auto-moves to inbox)`);
  console.log(` Label: ALL emails from target senders → archived`);
  console.log(`\n Engagement Config:`);
  console.log(`   - Open Rate: ${ENGAGEMENT_CONFIG.open_rate * 100}%`);
  console.log(`   - Click Rate: ${ENGAGEMENT_CONFIG.click_rate * 100}%`);
  console.log(`   - Max Age: ${MAX_EMAIL_AGE_HOURS}h`);
  console.log(`   - Click Limit: First ${CLICK_ENABLED_UNTIL_INDEX} mailboxes`);
  console.log(`   - Mode: REAL BROWSER (Puppeteer) for HubSpot tracking ✅`);
  console.log(`   - Concurrency: ${WORKER_CONCURRENCY} parallel mailboxes`);
  console.log(`   - Page Pool: max ${MAX_PUPPETEER_PAGES} concurrent browser pages`);
  console.log(`   - Mailbox Timeout: ${MAILBOX_TIMEOUT_MS / 60000} min`);
  console.log('========================================\n');

  try {
    console.log(' 🚀 Launching browser...');
    await getBrowser();
    console.log(' ✅ Browser ready!\n');

    const { data: mailboxes, error: fetchError } = await supabase
      .from('auto_responder_mailboxes')
      .select('*')
      .eq('is_active', true)
      .order('email', { ascending: true });

    if (fetchError) throw new Error(`Failed to fetch mailboxes: ${fetchError.message}`);

    const mailboxesToProcess = mailboxes.slice(START_FROM_INDEX - 1);

    console.log(` Processing ${mailboxesToProcess.length} active mailboxes`);
    if (START_FROM_INDEX > 1) {
      console.log(` ⭐ Starting from mailbox #${START_FROM_INDEX} (skipping first ${START_FROM_INDEX - 1})\n`);
    } else {
      console.log('');
    }

    // ✅ Run all mailboxes concurrently — WORKER_CONCURRENCY at a time
    const limit = createConcurrencyLimiter(WORKER_CONCURRENCY);
    let logIndex = START_FROM_INDEX - 1;

    const results = await Promise.all(
      mailboxesToProcess.map((mailbox) => {
        logIndex++;
        const currentIndex = logIndex;
        return limit(async () => {
          console.log(`\n[${currentIndex}/${mailboxes.length}] ${mailbox.email}`);
          try {
            const result = await Promise.race([
              processMailboxJob(mailbox, currentIndex),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Mailbox timeout (${MAILBOX_TIMEOUT_MS / 60000}min)`)), MAILBOX_TIMEOUT_MS)
              )
            ]);

            if (result.found > 0) {
              console.log(`    Done - Found: ${result.found} | Opened: ${result.opened} | Clicked: ${result.clicked}`);
            } else {
              console.log(`    No emails from target senders`);
            }
            return result;
          } catch (error) {
            console.log(`    ERROR: ${error.message}`);
            return { mailbox: mailbox.email, found: 0, opened: 0, clicked: 0, error: error.message };
          }
        });
      })
    );

    // Summary
    const totalFound = results.reduce((sum, r) => sum + r.found, 0);
    const totalOpened = results.reduce((sum, r) => sum + r.opened, 0);
    const totalClicked = results.reduce((sum, r) => sum + r.clicked, 0);
    const mailboxesWithEmails = results.filter((r) => r.found > 0).length;
    const mailboxesProcessed = results.length;
    const mailboxesSkipped = mailboxes.length - mailboxesProcessed;
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n========================================');
    console.log('            RESULTS');
    console.log('========================================');
    if (mailboxesSkipped > 0) {
      console.log(` Mailboxes processed: ${mailboxesProcessed}/${mailboxes.length} (skipped first ${mailboxesSkipped})`);
    } else {
      console.log(` Mailboxes processed: ${mailboxesProcessed}/${mailboxes.length}`);
    }
    console.log(` Mailboxes with emails: ${mailboxesWithEmails}`);
    console.log(` Emails found: ${totalFound}`);
    console.log(` Opened: ${totalOpened} (${totalFound > 0 ? ((totalOpened / totalFound) * 100).toFixed(1) : 0}%)`);
    console.log(` Clicked: ${totalClicked} (${totalOpened > 0 ? ((totalClicked / totalOpened) * 100).toFixed(1) : 0}% of opened)`);
    console.log(` Archived: ${totalFound} emails`);
    console.log(` Duration: ${duration}s`);
    console.log('========================================\n');

    // Cleanup browser
    if (globalBrowser) {
      console.log(' Closing browser...');
      await globalBrowser.close();
      globalBrowser = null;
    }

    return {
      mailboxCount: mailboxes.length,
      mailboxesWithEmails,
      found: totalFound,
      opened: totalOpened,
      clicked: totalClicked,
      duration: parseFloat(duration)
    };
  } catch (error) {
    // Cleanup browser on error
    if (globalBrowser) {
      try { await globalBrowser.close(); globalBrowser = null; } catch (e) { }
    }
    console.error('\n CRITICAL ERROR:', error);
    throw error;
  }
};

// Export for use in cron jobs
module.exports = { engageSeedlistEmails };

// Run it directly if script is executed (not imported)
if (require.main === module) {
  engageSeedlistEmails()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
