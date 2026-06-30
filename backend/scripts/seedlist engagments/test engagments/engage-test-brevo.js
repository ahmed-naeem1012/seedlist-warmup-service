
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const crypto = require('crypto');
const axios = require('axios');
const puppeteer = require('puppeteer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

// TEST SEEDLIST - Hardcoded 100 emails for testing
const TEST_EMAILS = [
  // Gmail accounts
  'geografyesfrageer@gmail.com',
  'austineromero246@gmail.com',
  'uthandaesdarmier@gmail.com',
  'elierberryes36@gmail.com',
  'wadanthony09@gmail.com',
  'jeksiclodiidi@gmail.com',
  'danillajulier@gmail.com',
  'manfollarquwkeep@gmail.com',
  'barrettesdchristophered@gmail.com',
  'watkinesejasoneds@gmail.com',
  'jeremebenneth@gmail.com',
  'nathanerreaides@gmail.com',
  'fullsdeeppardhanco@gmail.com',
  'robiniyeresakom@gmail.com',
  'jertyparkar@gmail.com',
  'joerobertdon0@gmail.com',
  'devidsonesjosever@gmail.com',
  'rightersootes@gmail.com',
  'amibhaidesai709@gmail.com',
  'thomaszdaszews@gmail.com',
  'numberfeeding@gmail.com',
  'geokavageonaca@gmail.com',
  'debkalisosk@gmail.com',
  'veokavsdvsokavwcs@gmail.com',
  'tsushimajdjfhf8@gmail.com',
  'checkhshs73@gmail.com',
  'gsowijebxsgaousnc@gmail.com',
  'rhagsgldjdhd7@gmail.com',
  'comingfun151@gmail.com',
  'formriding@gmail.com',
  'gueye040483@gmail.com',
  'p85113035@gmail.com',
  'umeshpujar612@gmail.com',
  'scottstaylor691@gmail.com',
  'sd6253463@gmail.com',
  'dtrfyte@gmail.com',
  'rameshmohacha@gmail.com',
  'jesonsmith6273@gmail.com',
  'taniyamondal7899@gmail.com',
  'rameshbmramesh19670@gmail.com',
  'wadud5189@gmail.com',
  'sidindiaye9734842@gmail.com',
  'jameershaikhshaikh39@gmail.com',
  'p64200291@gmail.com',
  'ziddim76590@gmail.com',
  'sambuharijan38@gmail.com',
  'shivamyadavpatepur233235@gmail.com',
  'seerila346@gmail.com',
  'insadrame82@gmail.com',
  'barrylongbalaoxhswpsnal85291@gmail.com',
  'charleehale30@gmail.com',
  'carolinekolly555@gmail.com',
  'aqibewequfu11@gmail.com',
  'awexoxikew47@gmail.com',
  'hffg46dd@gmail.com',
  'shoheiohtani83@gmail.com',
  'alfinoalbarez564@gmail.com',
  // Google Workspace accounts
  'jon@tryameloa.com',
  'jada@putdelivra.com',
  'jada@nowdelivra.com',
  'jada@buymyuselybase.com',
  'sadie@rundelivra.com',
  'mitch@setameloa.com',
  'jay@tagameloa.com',
  'becca@getmyusely.com',
  'henri@tagameloa.com',
  'mitch@putdelivra.com',
  'jada@heyzmyuser.com',
  'mia@makedelivra.com',
  'sadie@sendmyusely.com',
  'arielle@buydelivra.com',
  'sadie@whymyusers.com',
  'jay@buydelivra.com',
  'max@sendameloa.com',
  'jay@aimameloa.com',
  'henri@letmyusely.com',
  'ivy@bestmyusers.com',
  'jace@itsmyuserly.com',
  'leo@askmyusers.com',
  'jace@trymyusely.com',
  'henri@gomyuserly.com',
  'henri@pickmyuselyhq.com',
  'arielle@pickmyuselyflow.com',
  'jon@putmyuselyapp.com',
  'sadie@themyuserly.com',
  'jada@permyuserly.com',
  'mitch@findmyuselyport.com',
  'eli@addmyuselylabs.com',
  'becca@ourmyuserly.com',
  'max@buymyuselylink.com',
  'zach@putmyuselyapp.com',
  'leo@saymyuserly.com',
  'gia@viewmyusers.com',
  'jada@pickmyuserly.com',
  'leo@allmyuserly.com',
  'zoe@joinmyuselyteam.com',
  'max@heymyusers.com',
  'jada@addmyuselyflow.com',
  'eli@addmyuselydev.com',
  'becca@putmyuselysync.com'
];

// TARGET SENDERS - High engagement emails (supports multiple senders!)
const TARGET_SENDERS = [
  // 'marketing@gammaprime.com',
  // 'daniyal@heyscale.io',
  // 'daniyal@hello.maxify.co',
  // 'daniyal@maxify.co',
  // 'daniyal=maxify.co@hubspotstarter.na3.hs-send.com',
  'possible@info.possibleevent.com',
  'hlth@events.hlth.com',
];
const MAX_EMAIL_AGE_HOURS = 10; // Only engage with emails less than 3 hours old

//  DYNAMIC CLICK CONTROL - Clicks enabled for first 145 mailboxes ONLY
const CLICK_ENABLED_UNTIL_INDEX = 92;

// ⭐ START FROM SPECIFIC MAILBOX - Change this to start from any index (1 = start from beginning)
const START_FROM_INDEX = 1; // CHANGE THIS TO START FROM A DIFFERENT MAILBOX!

// ENGAGEMENT CONFIG for Daniel's emails
const ENGAGEMENT_CONFIG = {
  open_rate: 0.75,     // 85% - emails opened (out of 100)
  click_rate: 0.80,   // 71% - emails clicked (out of OPENED emails, not out of 100)
  read_time_min: 5000, // 5 seconds minimum
  read_time_max: 10000, // 10 seconds maximum
  click_delay_min: 2000,
  click_delay_max: 4000
};

// ✅ SPECIAL MAILBOX CONFIG - Check READ + UNREAD emails for mailboxes containing "use"
// Examples: max@makemyuserly.com, max@pickmyusers.com, max@putmyuselybase.com
const shouldCheckReadEmails = (email) => {
  return email.toLowerCase().includes('use');
};

// ✅ ENGAGEMENT FLOW:
// 1. Random check: Will this email be opened? (95% chance)
// 2. If YES → Load tracking pixels OR fallback link to register open
// 3. Random check: Will this email be clicked? (90% of opens)
// 4. If YES → Click a random link in the email
// 5. Mark as read and move to "Maxify's Label"
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

// Global browser instance (reused for all requests - MUCH faster!)
let globalBrowser = null;
const campaignCache = new Map();

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
  const diffMs = now - received;
  return diffMs / (1000 * 60 * 60);
};

// Create IMAP connection with retry
const createImapConnection = async (mailbox, retries = 3) => {
  const appPassword = decrypt(mailbox.app_password).replace(/\s/g, '');

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const imap = new Imap({
        user: mailbox.email,
        password: appPassword,
        host: mailbox.imap_host,
        port: mailbox.imap_port,
        tls: true,
        tlsOptions: {
          rejectUnauthorized: false,
          minVersion: 'TLSv1.2'
        },
        connTimeout: IMAP_CONFIG.connTimeout,
        authTimeout: IMAP_CONFIG.authTimeout,
        socketTimeout: IMAP_CONFIG.socketTimeout,
        keepalive: IMAP_CONFIG.keepalive,
        debug: false
      });

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          imap.end();
          reject(new Error('IMAP connection timeout'));
        }, IMAP_CONFIG.connTimeout + 5000);

        imap.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        imap.once('error', (err) => {
          clearTimeout(timeout);
          imap.end();
          reject(err);
        });

        imap.connect();
      });

      return imap;
    } catch (error) {
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
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

// Load URL using REAL BROWSER (Puppeteer) - executes JavaScript for tracking!
const loadUrl = async (url, type = 'unknown', retries = 2) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    let page = null;
    try {
      const browser = await getBrowser();
      page = await browser.newPage();

      // Set realistic viewport
      await page.setViewport({ width: 1920, height: 1080 });

      // Set user agent to look like real Chrome
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Navigate and wait for network to be idle (JavaScript executed!)
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 15000
      });

      // Wait a bit more for tracking scripts to fire
      await new Promise(resolve => setTimeout(resolve, 1000));

      await page.close();
      return true;
    } catch (error) {
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          // Ignore close errors
        }
      }

      console.log(`          ⚠️  ${type} load failed: ${error.message} (attempt ${attempt}/${retries})`);
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      return false;
    }
  }
  return false;
};

// Simulate read time
const simulateReadTime = async () => {
  const delay = Math.random() *
    (ENGAGEMENT_CONFIG.read_time_max - ENGAGEMENT_CONFIG.read_time_min) +
    ENGAGEMENT_CONFIG.read_time_min;
  await new Promise(resolve => setTimeout(resolve, delay));
};

// ─── Campaign-level idempotency helpers ───────────────────────────────────────

const buildCampaignKey = (senderEmail, subject, date) => {
  const raw = `${senderEmail}||${subject}||${date}`;
  return require('crypto').createHash('sha256').update(raw).digest('hex');
};

const fisherYates = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const getOrCreateCampaign = async (campaignKey, senderEmail, subject, date, allMailboxes) => {
  if (campaignCache.has(campaignKey)) return campaignCache.get(campaignKey);

  const { data: existing } = await supabase
    .from('warmup_campaigns').select('*').eq('campaign_key', campaignKey).maybeSingle();
  if (existing) { campaignCache.set(campaignKey, existing); return existing; }

  const total         = allMailboxes.length;
  const openRate      = [0.48, 0.55, 0.60][Math.floor(Math.random() * 3)];
  const clickRate     = [0.10, 0.20, 0.30, 0.35][Math.floor(Math.random() * 4)];
  const targetOpens   = Math.round(total * openRate);
  const targetClicks  = Math.round(targetOpens * clickRate);

  const { data: campaign, error: insertError } = await supabase
    .from('warmup_campaigns')
    .insert({ campaign_key: campaignKey, provider: 'brevo', sender_email: senderEmail,
              subject, campaign_date: date, total_mailboxes: total,
              target_open_rate: openRate, target_click_rate: clickRate,
              target_opens: targetOpens, target_clicks: targetClicks })
    .select().single();

  if (insertError) {
    // Unique violation = concurrent worker won the race; fetch their row
    const { data: raceWinner, error: fetchError } = await supabase
      .from('warmup_campaigns').select('*').eq('campaign_key', campaignKey).single();
    if (fetchError || !raceWinner) throw fetchError || new Error('Campaign race fetch failed');
    // Decisions already inserted by the winner — don't re-insert
    campaignCache.set(campaignKey, raceWinner);
    return raceWinner;
  }

  // We created the campaign — bulk-insert all decisions
  const shuffled  = fisherYates(allMailboxes);
  const decisions = shuffled.map((mb, i) => ({
    campaign_id:   campaign.id,
    mailbox_email: mb.email,
    decision:      i < targetClicks ? 'click' : i < targetOpens ? 'open' : 'skip',
  }));
  await supabase.from('warmup_decisions').insert(decisions);

  campaignCache.set(campaignKey, campaign);
  return campaign;
};

const getDecision = async (campaignId, mailboxEmail) => {
  const { data, error } = await supabase
    .from('warmup_decisions').select('*')
    .eq('campaign_id', campaignId).eq('mailbox_email', mailboxEmail).single();
  if (error) throw error;
  return data;
};

// markOpenDone / markClickDone throw on failure — callers must try/catch
// and skip the Puppeteer call if the write failed (write-before-execute contract)
const markOpenDone = async (id) => {
  const { error } = await supabase.from('warmup_decisions').update({ open_done: true }).eq('id', id);
  if (error) throw error;
};
const markClickDone = async (id) => {
  const { error } = await supabase.from('warmup_decisions').update({ click_done: true }).eq('id', id);
  if (error) throw error;
};

// markCleanupDone / markDecisionProcessed are best-effort — called with .catch()
const markCleanupDone = async (id) => {
  const { error } = await supabase.from('warmup_decisions').update({ cleanup_done: true }).eq('id', id);
  if (error) throw error;
};
const markDecisionProcessed = async (id) => {
  const { error } = await supabase.from('warmup_decisions')
    .update({ processed: true, processed_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
};

// Counter increments — atomic via RPC, called with .catch()
const incrementCampaignOpens  = (id) => supabase.rpc('inc_campaign_opens',  { p_id: id });
const incrementCampaignClicks = (id) => supabase.rpc('inc_campaign_clicks', { p_id: id });

// ──────────────────────────────────────────────────────────────────────────────

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

// Check SPAM folder and move emails to INBOX
const checkSpamAndMove = async (mailbox, checkReadEmails = false) => {
  try {
    const imap = await createImapConnection(mailbox);

    await new Promise((resolve, reject) => {
      // Try different spam folder names (Gmail uses [Gmail]/Spam)
      const spamFolders = ['[Gmail]/Spam', 'Spam', 'Junk', 'SPAM'];
      let spamFolderFound = false;

      const tryFolder = (index) => {
        if (index >= spamFolders.length) {
          imap.end();
          return resolve(0); // No spam folder or no emails
        }

        imap.openBox(spamFolders[index], false, (err, box) => {
          if (err) {
            // Try next folder
            return tryFolder(index + 1);
          }

          spamFolderFound = true;

          // Search for emails from any target sender (last 7 days)
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

          // Build nested OR for multiple senders (IMAP OR only accepts 2 args)
          // CRITICAL: Only search for UNSEEN emails (or ALL for "use" mailboxes)
          let searchCriteria;
          if (TARGET_SENDERS.length === 1) {
            searchCriteria = checkReadEmails
              ? [['FROM', TARGET_SENDERS[0]], ['SINCE', sevenDaysAgo]]  // READ + UNREAD for "use" mailboxes
              : ['UNSEEN', ['FROM', TARGET_SENDERS[0]], ['SINCE', sevenDaysAgo]];  // UNREAD only
          } else if (TARGET_SENDERS.length === 2) {
            searchCriteria = checkReadEmails
              ? [['OR', ['FROM', TARGET_SENDERS[0]], ['FROM', TARGET_SENDERS[1]]], ['SINCE', sevenDaysAgo]]
              : ['UNSEEN', ['OR', ['FROM', TARGET_SENDERS[0]], ['FROM', TARGET_SENDERS[1]]], ['SINCE', sevenDaysAgo]];
          } else {
            // For 3+ senders: nest ORs like ['OR', ['FROM', s1], ['OR', ['FROM', s2], ['FROM', s3]]]
            let orChain = ['FROM', TARGET_SENDERS[TARGET_SENDERS.length - 1]];
            for (let i = TARGET_SENDERS.length - 2; i >= 0; i--) {
              orChain = ['OR', ['FROM', TARGET_SENDERS[i]], orChain];
            }
            searchCriteria = checkReadEmails
              ? [orChain, ['SINCE', sevenDaysAgo]]
              : ['UNSEEN', orChain, ['SINCE', sevenDaysAgo]];
          }

          imap.search(searchCriteria, (err, results) => {
            // DEBUG: Log search results even if empty
            console.log(`      🔍 Searched ${spamFolders[index]} for: ${TARGET_SENDERS[0]}`);

            if (err) {
              console.log(`      ⚠️  Search error: ${err.message}`);
              imap.end();
              return resolve(0);
            }

            if (!results || results.length === 0) {
              console.log(`      📭 No emails found in ${spamFolders[index]}`);
              imap.end();
              return resolve(0);
            }

            console.log(`  Found ${results.length} email(s) in SPAM - moving to INBOX...`);

            let completed = 0;
            let succeeded = 0;

            // Move ALL emails (age check happens later in inbox processing)
            results.forEach((seqno) => {
              imap.move(seqno, 'INBOX', (moveErr) => {
                completed++;
                if (!moveErr) succeeded++;

                // When all done
                if (completed === results.length) {
                  setTimeout(() => {
                    imap.end();
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
  } catch (error) {
    console.error(`      Spam check error: ${error.message}`);
    return 0;
  }
};

// Check PROMOTIONS folder and move emails to INBOX
const checkPromotionsAndMove = async (mailbox, checkReadEmails = false) => {
  try {
    const imap = await createImapConnection(mailbox);

    await new Promise((resolve, reject) => {
      // Try different promotions folder names
      const promotionsFolders = ['[Gmail]/All Mail'];
      let promotionsFolderFound = false;

      const tryFolder = (index) => {
        if (index >= promotionsFolders.length) {
          imap.end();
          return resolve(0); // No promotions folder or no emails
        }

        imap.openBox(promotionsFolders[index], false, (err, box) => {
          if (err) {
            // Try next folder
            return tryFolder(index + 1);
          }

          promotionsFolderFound = true;

          // Search for UNSEEN emails (or ALL for "use" mailboxes) from any target sender (last 7 days)
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

          // Build nested OR for multiple senders (IMAP OR only accepts 2 args)
          // CRITICAL: Only search for UNSEEN emails (or ALL for "use" mailboxes)
          let searchCriteria;
          if (TARGET_SENDERS.length === 1) {
            searchCriteria = checkReadEmails
              ? [['FROM', TARGET_SENDERS[0]], ['SINCE', sevenDaysAgo]]  // READ + UNREAD for "use" mailboxes
              : ['UNSEEN', ['FROM', TARGET_SENDERS[0]], ['SINCE', sevenDaysAgo]];  // UNREAD only
          } else if (TARGET_SENDERS.length === 2) {
            searchCriteria = checkReadEmails
              ? [['OR', ['FROM', TARGET_SENDERS[0]], ['FROM', TARGET_SENDERS[1]]], ['SINCE', sevenDaysAgo]]
              : ['UNSEEN', ['OR', ['FROM', TARGET_SENDERS[0]], ['FROM', TARGET_SENDERS[1]]], ['SINCE', sevenDaysAgo]];
          } else {
            // For 3+ senders: nest ORs like ['OR', ['FROM', s1], ['OR', ['FROM', s2], ['FROM', s3]]]
            let orChain = ['FROM', TARGET_SENDERS[TARGET_SENDERS.length - 1]];
            for (let i = TARGET_SENDERS.length - 2; i >= 0; i--) {
              orChain = ['OR', ['FROM', TARGET_SENDERS[i]], orChain];
            }
            searchCriteria = checkReadEmails
              ? [orChain, ['SINCE', sevenDaysAgo]]
              : ['UNSEEN', orChain, ['SINCE', sevenDaysAgo]];
          }

          imap.search(searchCriteria, (err, results) => {
            // DEBUG: Log search results even if empty
            console.log(`      🔍 Searched ${promotionsFolders[index]} for: ${TARGET_SENDERS[0]}`);

            if (err) {
              console.log(`      ⚠️  Search error: ${err.message}`);
              imap.end();
              return resolve(0);
            }

            if (!results || results.length === 0) {
              console.log(`      📭 No emails found in ${promotionsFolders[index]}`);
              imap.end();
              return resolve(0);
            }

            console.log(`  Found ${results.length} email(s) in PROMOTIONS - moving to INBOX...`);

            let completed = 0;
            let succeeded = 0;

            // Move ALL emails (age check happens later in inbox processing)
            results.forEach((seqno) => {
              imap.move(seqno, 'INBOX', (moveErr) => {
                completed++;
                if (!moveErr) succeeded++;

                // When all done
                if (completed === results.length) {
                  setTimeout(() => {
                    imap.end();
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
  } catch (error) {
    console.error(`      Promotions check error: ${error.message}`);
    return 0;
  }
};

// Process mailbox
const processMailbox = async (mailbox, mailboxIndex = 999, allMailboxes = []) => {
  // Dynamic click control based on mailbox index
  const ENABLE_CLICKS = mailboxIndex <= CLICK_ENABLED_UNTIL_INDEX;

  // ✅ Check if this is a "use" mailbox (should check READ + UNREAD emails)
  const checkReadEmails = shouldCheckReadEmails(mailbox.email);

  if (checkReadEmails) {
    console.log(`   📖 "USE" MAILBOX DETECTED - Will check READ + UNREAD emails`);
  }

  if (ENABLE_CLICKS) {
    console.log(`   Clicks ENABLED (mailbox ${mailboxIndex}/${CLICK_ENABLED_UNTIL_INDEX})`);
  } else {
    console.log(`   Clicks DISABLED (mailbox ${mailboxIndex} > ${CLICK_ENABLED_UNTIL_INDEX})`);
  }

  // STEP 0: Check SPAM folder first and move to INBOX
  console.log(`    Checking SPAM folder...`);
  const movedFromSpam = await checkSpamAndMove(mailbox, checkReadEmails);

  // STEP 0.5: Check PROMOTIONS folder and move to INBOX
  console.log(`    Checking PROMOTIONS folder...`);
  const movedFromPromotions = await checkPromotionsAndMove(mailbox, checkReadEmails);

  // If we moved emails, wait a bit for Gmail to sync
  const totalMoved = movedFromSpam + movedFromPromotions;
  if (totalMoved > 0) {
    console.log(`    Waiting 5s for Gmail to sync...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  try {
    const imap = await createImapConnection(mailbox);

    const danielEmails = await new Promise((resolve, reject) => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        // Search for unread emails (or ALL for "use" mailboxes) from any target sender
        // ✅ OPTIMIZATION: Only fetch emails from last 2 days (48h) to avoid processing hundreds of old emails
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

        let searchCriteria;
        if (TARGET_SENDERS.length === 1) {
          searchCriteria = checkReadEmails
            ? [['FROM', TARGET_SENDERS[0]], ['SINCE', twoDaysAgo]]  // READ + UNREAD for "use" mailboxes
            : ['UNSEEN', ['FROM', TARGET_SENDERS[0]], ['SINCE', twoDaysAgo]];  // UNREAD only
        } else if (TARGET_SENDERS.length === 2) {
          searchCriteria = checkReadEmails
            ? [['OR', ['FROM', TARGET_SENDERS[0]], ['FROM', TARGET_SENDERS[1]]], ['SINCE', twoDaysAgo]]
            : ['UNSEEN', ['OR', ['FROM', TARGET_SENDERS[0]], ['FROM', TARGET_SENDERS[1]]], ['SINCE', twoDaysAgo]];
        } else {
          // For 3+ senders: nest ORs properly
          let orChain = ['FROM', TARGET_SENDERS[TARGET_SENDERS.length - 1]];
          for (let i = TARGET_SENDERS.length - 2; i >= 0; i--) {
            orChain = ['OR', ['FROM', TARGET_SENDERS[i]], orChain];
          }
          searchCriteria = checkReadEmails
            ? [orChain, ['SINCE', twoDaysAgo]]
            : ['UNSEEN', orChain, ['SINCE', twoDaysAgo]];
        }

        imap.search(searchCriteria, (err, results) => {
          // DEBUG: Log search results
          console.log(`     🔍 Searched INBOX for ${checkReadEmails ? 'ALL' : 'UNREAD'} emails from: ${TARGET_SENDERS[0]} (last 2 days)`);

          if (err) {
            console.log(`     ⚠️  INBOX search error: ${err.message}`);
            imap.end();
            return reject(err);
          }

          if (!results || results.length === 0) {
            console.log(`     📭 No emails found in INBOX from target senders`);
            imap.end();
            return resolve([]);
          }

          console.log(`     Found ${results.length} email(s) from target sender(s)`);

          // Get all emails (reverse to get newest first)
          const emailsToFetch = results.reverse();

          const fetch = imap.fetch(emailsToFetch, {
            bodies: '',
            struct: true,
            markSeen: false,
            envelope: true  // Include UID in attributes
          });

          const emailPromises = [];

          fetch.on('message', (msg, seqno) => {
            const emailPromise = new Promise((resolveEmail) => {
              let buffer = '';
              let uid = null;
              let bodyEnded = false;
              let attrsReceived = false;

              // Capture UID from message attributes (UID is persistent!)
              msg.once('attributes', (attrs) => {
                uid = attrs.uid;
                attrsReceived = true;
                // If body already ended, resolve now
                if (bodyEnded) {
                  resolveWithParsedEmail();
                }
              });

              const resolveWithParsedEmail = async () => {
                try {
                  const parsed = await simpleParser(buffer);
                  if (!uid) {
                    uid = seqno;  // Fallback to seqno if UID not available
                  }
                  resolveEmail({
                    seqno,
                    uid,  // CRITICAL: Store UID for cross-session operations!
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
                stream.on('data', (chunk) => {
                  buffer += chunk.toString('utf8');
                });

                stream.once('end', () => {
                  bodyEnded = true;
                  // If attributes already received, resolve now
                  if (attrsReceived) {
                    resolveWithParsedEmail();
                  }
                });
              });

              // Fallback: If attributes never fire, resolve after body ends with a small delay
              msg.once('end', () => {
                if (!attrsReceived && bodyEnded) {
                  setTimeout(resolveWithParsedEmail, 100);
                }
              });
            });

            emailPromises.push(emailPromise);
          });

          fetch.once('error', (err) => {
            imap.end();
            reject(err);
          });

          fetch.once('end', async () => {
            const parsedEmails = await Promise.all(emailPromises);
            imap.end();
            resolve(parsedEmails.filter(e => e !== null));
          });
        });
      });
    });

    let openedCount = 0;
    let clickedCount = 0;

    if (danielEmails.length === 0) {
      return {
        mailbox: mailbox.email,
        found: 0,
        opened: 0,
        clicked: 0
      };
    }

    console.log(`     Found ${danielEmails.length} email(s) from target sender(s)`);

    for (const email of danielEmails) {
      try {
        const senderEmail = email.from.value?.[0]?.address || email.from.text;

        console.log(`       Campaign: ${senderEmail}`);
        console.log(`          Subject: ${email.subject}`);

        // CHECK: Email age - skip if older than MAX_EMAIL_AGE_HOURS
        const emailAgeHours = getEmailAgeHours(email.date);
        if (emailAgeHours > MAX_EMAIL_AGE_HOURS) {
          console.log(`          Email is ${emailAgeHours.toFixed(1)}h old (>${MAX_EMAIL_AGE_HOURS}h) - SKIPPING`);
          // Mark as read FIRST, then move (using UID!)
          await markEmailAsRead(mailbox, email.uid);
          try {
            await moveToMaxifyLabel(mailbox, email.uid);
            console.log(`          📁 Moved to "Maxify's Label" (skipped - too old)`);
          } catch (labelError) {
            console.log(`          ⚠️  Label move failed: ${labelError.message}`);
          }
          continue;
        }
        console.log(`          Email age: ${emailAgeHours.toFixed(1)}h (< ${MAX_EMAIL_AGE_HOURS}h) - OK to engage`);

        // ── Campaign-level deterministic decision ──────────────────────────────────
        const emailDate   = email.date
          ? new Date(email.date).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);
        const campaignKey = buildCampaignKey(senderEmail, email.subject || '', emailDate);

        let campaign, decisionRow;
        try {
          campaign    = await getOrCreateCampaign(campaignKey, senderEmail,
                          email.subject || '', emailDate, allMailboxes);
          decisionRow = await getDecision(campaign.id, mailbox.email);
        } catch (dbErr) {
          console.log(`          ⚠️  DB error fetching campaign/decision — skipping: ${dbErr.message}`);
          continue;
        }
        if (!decisionRow) {
          console.log(`          ⚠️  No decision row found — skipping`);
          continue;
        }

        // processed=true → archive only, no open/click
        if (decisionRow.processed) {
          console.log(`          ✅ Already fully processed — archiving`);
          await markEmailAsRead(mailbox, email.uid);
          try { await moveToMaxifyLabel(mailbox, email.uid); } catch (e) {}
          continue;
        }

        const willOpen  = decisionRow.decision !== 'skip';
        const willClick = decisionRow.decision === 'click';

        // skip path
        if (!willOpen) {
          console.log(`          ❌ Not engaged (decision: skip)`);
          await markEmailAsRead(mailbox, email.uid);
          try {
            await moveToMaxifyLabel(mailbox, email.uid);
            console.log(`          📁 Moved to "Maxify's Label" (not engaged)`);
          } catch (labelError) {
            console.log(`          ⚠️  Archive failed: ${labelError.message}`);
          }
          await markCleanupDone(decisionRow.id).catch(e =>
            console.log(`          ⚠️  markCleanupDone failed: ${e.message}`));
          await markDecisionProcessed(decisionRow.id).catch(e =>
            console.log(`          ⚠️  markDecisionProcessed failed: ${e.message}`));
          continue;
        }
        // ───────────────────────────────────────────────────────────────────────────

        // STEP 1: Extract ALL URLs (tracking pixels + links)
        const allUrls = extractAllUrls(email.text, email.html);
        console.log(`          📋 Found ${allUrls.length} total URL(s) in email`);

        // STEP 2: LOAD TRACKING PIXELS (to register open in Brevo/Mailchimp/HubSpot)
        // EXCLUDE click tracking links - we only want open tracking pixels
        const trackingPixels = allUrls.filter(url => {
          const lowerUrl = url.toLowerCase();

          // Brevo (Sendinblue) tracking patterns
          const isBrevoTracker = lowerUrl.includes('sendinblue.com') ||
            lowerUrl.includes('brevo.com') ||
            lowerUrl.includes('sibautomation.com');

          // HubSpot tracking patterns (COMPREHENSIVE - ALL HUBSPOT OPEN TRACKING METHODS)
          const isHubSpotTracker =
            // PRIMARY: HubSpot open tracking (most common)
            (lowerUrl.includes('hubspotlinks') && lowerUrl.includes('/cto/')) ||

            // HubSpot tracking domains
            lowerUrl.includes('t.hubspot.com') ||
            lowerUrl.includes('t.sidekickopen') ||
            lowerUrl.includes('hubspotemail.net') ||
            lowerUrl.includes('hubspotemail-eu1.net') ||
            lowerUrl.includes('hubspotfree.net') ||
            lowerUrl.includes('hs-email.net') ||
            lowerUrl.includes('hs-sites') ||

            // HubSpot image CDN (often used for tracking pixels)
            (lowerUrl.includes('hubspot') && (lowerUrl.includes('.png') || lowerUrl.includes('.gif'))) ||

            // Legacy HubSpot patterns
            (lowerUrl.includes('hubspot') && (lowerUrl.includes('/e2t/o/') || lowerUrl.includes('/e2t/to/'))) ||

            // HubSpot file manager images (sometimes used for tracking)
            lowerUrl.includes('hubfs') ||
            lowerUrl.includes('hs-scripts.com');

          // Generic tracking pixel patterns
          const isTrackingPixel = lowerUrl.includes('track') ||
            lowerUrl.includes('pixel') ||
            lowerUrl.includes('beacon') ||
            lowerUrl.endsWith('.gif') ||
            lowerUrl.endsWith('.png') ||
            lowerUrl.includes('open.php') ||
            lowerUrl.includes('/op/') || // Brevo open tracking
            lowerUrl.includes('open');

          // Exclude click tracking (not open tracking) - UPDATED FOR HUBSPOT
          const isNotClickTracker =
            !lowerUrl.includes('mailchi.mp') && // Mailchimp clicks
            !lowerUrl.includes('/cl/') && // Brevo clicks
            !(lowerUrl.includes('hubspotlinks') && lowerUrl.includes('/ctc/')) && // HubSpot click tracking (PRIMARY)
            !lowerUrl.includes('/e2t/c/') && // HubSpot clicks (legacy)
            !lowerUrl.includes('/e2t/ct/') && // HubSpot click tracking (legacy)
            !lowerUrl.includes('click');

          return (isBrevoTracker || isHubSpotTracker || isTrackingPixel) && isNotClickTracker;
        });

        if (!decisionRow.open_done) {
          // Write BEFORE execute — prefer missed open over duplicate
          let openWriteOk = false;
          try {
            await markOpenDone(decisionRow.id);
            openWriteOk = true;
          } catch (e) {
            console.log(`          ⚠️  DB error marking open_done — skipping pixel load: ${e.message}`);
          }
          if (openWriteOk) {
            // ✅ ENHANCED: Always ensure opens are registered!
            if (trackingPixels.length > 0) {
              console.log(`          📊 Found ${trackingPixels.length} tracking pixel(s):`);
              trackingPixels.forEach((pixel, i) => {
                const source = pixel.includes('hubspot') ? 'HubSpot' :
                  pixel.includes('brevo') || pixel.includes('sendinblue') ? 'Brevo' :
                    pixel.includes('mailchimp') ? 'Mailchimp' : 'Generic';
                console.log(`             ${i + 1}. [${source}] ${pixel.substring(0, 100)}...`);
              });
              console.log(`          ⏳ Loading tracking pixels...`);
              for (const pixel of trackingPixels) {
                await loadUrl(pixel, 'pixel');
                await new Promise(resolve => setTimeout(resolve, 800));
              }
              // CRITICAL: Wait for tracking servers to process the pixel loads!
              await new Promise(resolve => setTimeout(resolve, 3000));
              console.log(`          ✅ All tracking pixels loaded!`);
            } else {
              // ✅ FALLBACK: If no tracking pixels found, click ANY link to register open
              console.log(`          ⚠️  No tracking pixels detected - using fallback method...`);

              // Find any clickable link (prefer "view in browser" or regular links)
              const fallbackLinks = allUrls.filter(url => {
                const lowerUrl = url.toLowerCase();
                return url.startsWith('http') &&
                  !lowerUrl.includes('unsubscribe') &&
                  !lowerUrl.includes('preferences');
              });

              if (fallbackLinks.length > 0) {
                // Click the FIRST link to force-register the open
                const fallbackLink = fallbackLinks[0];
                console.log(`          🔗 Loading fallback link to register open...`);
                await loadUrl(fallbackLink, 'fallback-open');
                await new Promise(resolve => setTimeout(resolve, 3000));
              } else {
                console.log(`          ⚠️  WARNING: No links found to register open! Email may not track.`);
              }
            }
            await incrementCampaignOpens(campaign.id).catch(e =>
              console.log(`          ⚠️  inc actual_opens failed: ${e.message}`));
          }
        }

        openedCount++;
        console.log(`          ✓ EMAIL OPENED (${senderEmail})`);



        // Simulate read time
        await simulateReadTime();

        // STEP 3: CLICK LINKS (DB decision is the sole authority; write-before-execute)
        if (ENABLE_CLICKS && willClick && !decisionRow.click_done) {
          // Write BEFORE execute — prefer missed click over duplicate
          let clickWriteOk = false;
          try {
            await markClickDone(decisionRow.id);
            clickWriteOk = true;
          } catch (e) {
            console.log(`          ⚠️  DB error marking click_done — skipping click: ${e.message}`);
          }
          if (clickWriteOk) {
            const clickableLinks = allUrls.filter(url => {
              const lowerUrl = url.toLowerCase();
              // Exclude unsubscribe, tracking pixels, view-in-browser, and preferences
              return url.startsWith('http') &&
                !lowerUrl.includes('unsubscribe') &&
                !trackingPixels.includes(url) &&
                !lowerUrl.includes('view-in-browser') &&
                !lowerUrl.includes('preferences') &&
                !lowerUrl.includes('view in browser');
            });

            // ✅ NEW: PRIORITIZE Brevo/SendinBlue click tracking links (/mk/cl/)
            // These are the links that Brevo counts as clicks in analytics
            const brevoClickLinks = clickableLinks.filter(url =>
              url.includes('/mk/cl/') || url.includes('/click/')
            );

            // Use Brevo click links if available, otherwise fall back to regular links
            const linksToClickFrom = brevoClickLinks.length > 0 ? brevoClickLinks : clickableLinks;

            if (brevoClickLinks.length > 0) {
              console.log(`          🎯 Found ${brevoClickLinks.length} Brevo click tracking link(s) - prioritizing these!`);
            }

            if (linksToClickFrom.length > 0) {
              // ONLY CLICK 1 RANDOM LINK (not all links)
              const randomLink = linksToClickFrom[Math.floor(Math.random() * linksToClickFrom.length)];

              console.log(`          🖱️  Clicking link...`);

              const clickDelay = Math.random() *
                (ENGAGEMENT_CONFIG.click_delay_max - ENGAGEMENT_CONFIG.click_delay_min) +
                ENGAGEMENT_CONFIG.click_delay_min;
              await new Promise(resolve => setTimeout(resolve, clickDelay));

              const clicked = await loadUrl(randomLink, 'click');
              if (clicked) {
                clickedCount++;
                await incrementCampaignClicks(campaign.id).catch(e =>
                  console.log(`          ⚠️  inc actual_clicks failed: ${e.message}`));
                console.log(`          ✓ CLICKED (${senderEmail}): ${randomLink.substring(0, 80)}...`);
                // Wait for click tracking to register
                await new Promise(resolve => setTimeout(resolve, 2000));
              } else {
                console.log(`          ⚠️  Click failed but continuing...`);
              }
            } else {
              console.log(`          ℹ️  No clickable links found (only tracking pixels/unsubscribe)`);
            }
          }
        } else if (!ENABLE_CLICKS) {
          console.log(`          ℹ️  Clicks DISABLED by kill switch (mailbox ${mailboxIndex} > ${CLICK_ENABLED_UNTIL_INDEX})`);
        } else {
          console.log(`          ℹ️  Open-only engagement (not clicking - ${Math.round((1 - ENGAGEMENT_CONFIG.click_rate) * 100)}% of opens)`);
        }

        // CRITICAL: Final delay before archiving to ensure ALL tracking registers!
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Mark as read in Gmail FIRST (using UID!)
        await markEmailAsRead(mailbox, email.uid);

        // THEN move to label (after marking as read, using UID!)
        try {
          await moveToMaxifyLabel(mailbox, email.uid);
          console.log(`          📁 Moved to "Maxify's Label"`);
        } catch (labelError) {
          console.log(`          ⚠️  Label move failed: ${labelError.message}`);
        }

        await markCleanupDone(decisionRow.id).catch(e =>
          console.log(`          ⚠️  markCleanupDone failed: ${e.message}`));
        await markDecisionProcessed(decisionRow.id).catch(e =>
          console.log(`          ⚠️  markDecisionProcessed failed: ${e.message}`));

        // Small delay between emails
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (emailError) {
        console.error(`          Error:`, emailError.message);
      }
    }

    return {
      mailbox: mailbox.email,
      found: danielEmails.length,
      opened: openedCount,
      clicked: clickedCount
    };

  } catch (error) {
    return {
      mailbox: mailbox.email,
      found: 0,
      opened: 0,
      clicked: 0,
      error: error.message
    };
  }
};

// Main function - MODIFIED FOR TEST SEEDLIST
const engageTestBrevo = async () => {
  const startTime = Date.now();

  console.log('\n========================================');
  console.log(`   [BREVO] TEST ENGAGEMENT`);
  console.log('========================================\n');
  console.log(` Target Senders (${TARGET_SENDERS.length}):`);
  TARGET_SENDERS.forEach((sender, i) => {
    console.log(`   ${i + 1}. ${sender}`);
  });
  console.log();
  console.log(` Test Seedlist: ${TEST_EMAILS.length} emails`);
  console.log(` Platform: Brevo / Mailchimp / HubSpot Compatible`);
  console.log(` SPAM Check: ENABLED (auto-moves to inbox)`);
  console.log(` Label: ALL emails from target senders → "Maxify's Label"`);
  console.log(`\n Engagement Config:`);
  console.log(`   - Open Rate: ${ENGAGEMENT_CONFIG.open_rate * 100}%`);
  console.log(`   - Click Rate: ${ENGAGEMENT_CONFIG.click_rate * 100}%`);
  console.log(`   - Max Age: ${MAX_EMAIL_AGE_HOURS}h`);
  console.log(`   - Click Limit: First ${CLICK_ENABLED_UNTIL_INDEX} mailboxes`);
  console.log(`   - Mode: REAL BROWSER (Puppeteer) for HubSpot tracking ✅`);
  console.log('========================================\n');

  try {
    // Launch browser early (reused for all mailboxes)
    console.log(' 🚀 Launching browser...');
    await getBrowser();
    console.log(' ✅ Browser ready!\n');

    // ⭐ MODIFIED: Fetch mailbox credentials for TEST_EMAILS from database
    console.log(` Fetching credentials for ${TEST_EMAILS.length} test emails...`);
    const { data: mailboxData, error: fetchError } = await supabase
      .from('auto_responder_mailboxes')
      .select('*')
      .in('email', TEST_EMAILS);

    if (fetchError) {
      throw new Error(`Failed to fetch mailboxes: ${fetchError.message}`);
    }

    // Map to match TEST_EMAILS order and filter to only those found in database
    const mailboxes = TEST_EMAILS
      .map(email => mailboxData.find(m => m.email === email))
      .filter(m => m !== undefined);

    console.log(` Found ${mailboxes.length}/${TEST_EMAILS.length} mailboxes in database`);

    if (mailboxes.length === 0) {
      console.log(' ⚠️  No test emails found in database. Please add them first.');
      return {
        mailboxCount: 0,
        mailboxesWithEmails: 0,
        found: 0,
        opened: 0,
        clicked: 0,
        duration: 0
      };
    }

    console.log(` Processing ${mailboxes.length} test mailboxes`);
    if (START_FROM_INDEX > 1) {
      console.log(` ⭐ Starting from mailbox #${START_FROM_INDEX} (skipping first ${START_FROM_INDEX - 1} mailboxes)\n`);
    } else {
      console.log('');
    }

    const results = [];
    let currentIndex = 0;

    for (const mailbox of mailboxes) {
      currentIndex++;

      // Skip mailboxes until we reach START_FROM_INDEX
      if (currentIndex < START_FROM_INDEX) {
        console.log(`\n[${currentIndex}/${mailboxes.length}] ${mailbox.email} - SKIPPED (starting from ${START_FROM_INDEX})`);
        continue;
      }

      console.log(`\n[${currentIndex}/${mailboxes.length}] ${mailbox.email}`);

      try {
        // Add timeout wrapper (3 minutes max per mailbox)
        const result = await Promise.race([
          processMailbox(mailbox, currentIndex, mailboxes), // Pass currentIndex for dynamic click control
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Mailbox processing timeout (3min)')), 180000)
          )
        ]);
        results.push(result);

        if (result.found > 0) {
          console.log(`    Done - Found: ${result.found} | Opened: ${result.opened} | Clicked: ${result.clicked}`);
        } else {
          console.log(`    No emails from target senders`);
        }
      } catch (error) {
        console.log(`    ERROR: ${error.message}`);
        results.push({
          mailbox: mailbox.email,
          found: 0,
          opened: 0,
          clicked: 0,
          error: error.message
        });
      }

      // Delay between mailboxes
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Summary
    const totalFound = results.reduce((sum, r) => sum + r.found, 0);
    const totalOpened = results.reduce((sum, r) => sum + r.opened, 0);
    const totalClicked = results.reduce((sum, r) => sum + r.clicked, 0);
    const mailboxesWithEmails = results.filter(r => r.found > 0).length;
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
      try {
        await globalBrowser.close();
        globalBrowser = null;
      } catch (closeError) {
        // Ignore close errors
      }
    }
    console.error('\n CRITICAL ERROR:', error);
    throw error;
  }
};

// Export for use in cron jobs
module.exports = { engageTestBrevo };

// Run it directly if script is executed (not imported)
if (require.main === module) {
  engageTestBrevo()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
