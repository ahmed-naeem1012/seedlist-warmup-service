
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const TEST_EMAILS = [
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

const TARGET_SENDERS = [
  // 'your-hubspot-sender@example.com',
  'daniyal@hello.maxify.co',
  // 'hlth@events.hlth.com',
];

const MAX_EMAIL_AGE_HOURS = 2;
const CLICK_ENABLED_UNTIL_INDEX = 85;

const ENGAGEMENT_CONFIG = {
  open_rate: 0.85,
  click_rate: 0.65,
  read_time_min: 5000,
  read_time_max: 10000,
  click_delay_min: 2000,
  click_delay_max: 4000
};

const shouldCheckReadEmails = (email) => email.toLowerCase().includes('use');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
, { realtime: { transport: ws } }
);

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

const WORKER_CONCURRENCY = parseInt(process.env.SEEDLIST_WORKER_CONCURRENCY || '25');
const MAX_PUPPETEER_PAGES = parseInt(process.env.PUPPETEER_PAGE_POOL_SIZE || '15');
const MAILBOX_TIMEOUT_MS = 90000;

let globalBrowser = null;

const getBrowser = async () => {
  if (!globalBrowser) {
    globalBrowser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--disable-gpu']
    });
  }
  return globalBrowser;
};

class PageSemaphore {
  constructor(max) { this.max = max; this.current = 0; this.waiting = []; }
  acquire() {
    if (this.current < this.max) { this.current++; return Promise.resolve(); }
    return new Promise(resolve => this.waiting.push(resolve));
  }
  release() {
    if (this.waiting.length > 0) { this.waiting.shift()(); } else { this.current--; }
  }
}
const pageSemaphore = new PageSemaphore(MAX_PUPPETEER_PAGES);

const createConcurrencyLimiter = (maxConcurrent) => {
  let running = 0;
  const queue = [];
  return async (fn) => {
    if (running >= maxConcurrent) await new Promise(resolve => queue.push(resolve));
    running++;
    try { return await fn(); } finally { running--; if (queue.length > 0) queue.shift()(); }
  };
};

const IMAP_CONFIG = {
  connTimeout: 60000, authTimeout: 60000, socketTimeout: 120000,
  keepalive: { interval: 10000, idleInterval: 300000, forceNoop: true }
};

const decrypt = (encrypted) => {
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0')), Buffer.alloc(16, 0));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

const getEmailAgeHours = (emailDate) => (new Date() - new Date(emailDate)) / (1000 * 60 * 60);

const createImapConnection = async (mailbox, retries = 3) => {
  const appPassword = decrypt(mailbox.app_password).replace(/\s/g, '');
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const imap = new Imap({
        user: mailbox.email, password: appPassword, host: mailbox.imap_host, port: mailbox.imap_port,
        tls: true, tlsOptions: { rejectUnauthorized: false, minVersion: 'TLSv1.2' },
        connTimeout: IMAP_CONFIG.connTimeout, authTimeout: IMAP_CONFIG.authTimeout,
        socketTimeout: IMAP_CONFIG.socketTimeout, keepalive: IMAP_CONFIG.keepalive, debug: false
      });
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { imap.end(); reject(new Error('IMAP connection timeout')); }, IMAP_CONFIG.connTimeout + 5000);
        imap.once('ready', () => { clearTimeout(timeout); resolve(); });
        imap.once('error', (err) => { clearTimeout(timeout); imap.end(); reject(err); });
        imap.connect();
      });
      return imap;
    } catch (error) {
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      else throw error;
    }
  }
};

const extractAllUrls = (emailText, emailHtml) => {
  const urls = [];
  const textMatches = (emailText || '').match(/https?:\/\/[^\s]+/g);
  if (textMatches) urls.push(...textMatches);
  let match;
  const hrefRegex = /href=["']([^"']+)["']/g;
  while ((match = hrefRegex.exec(emailHtml || '')) !== null) { if (match[1].startsWith('http')) urls.push(match[1]); }
  const imgRegex = /src=["']([^"']+)["']/g;
  while ((match = imgRegex.exec(emailHtml || '')) !== null) { if (match[1].startsWith('http')) urls.push(match[1]); }
  return [...new Set(urls)];
};

const loadUrl = async (url, type = 'unknown', retries = 2) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    await pageSemaphore.acquire();
    let page = null;
    let released = false;
    const releaseSemaphore = () => { if (!released) { released = true; pageSemaphore.release(); } };
    try {
      const browser = await getBrowser();
      page = await browser.newPage();
      await page.setDefaultTimeout(10000);
      await page.setDefaultNavigationTimeout(10000);
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await Promise.race([
        page.goto(url, { waitUntil: 'networkidle2', timeout: 10000 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Page load timeout')), 12000))
      ]);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await page.close();
      releaseSemaphore();
      return true;
    } catch (error) {
      if (page) {
        try { await Promise.race([page.close(), new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), 2000))]); }
        catch (e) { try { page.close(); } catch (e2) { } }
      }
      releaseSemaphore();
      if (attempt === retries) console.log(`          ⚠️  ${type} load failed: ${error.message} (gave up after ${retries} attempts)`);
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return false;
};

const simulateReadTime = async () => {
  const delay = Math.random() * (ENGAGEMENT_CONFIG.read_time_max - ENGAGEMENT_CONFIG.read_time_min) + ENGAGEMENT_CONFIG.read_time_min;
  await new Promise(resolve => setTimeout(resolve, delay));
};

const markEmailAsRead = async (mailbox, uid) => {
  if (!uid) return;
  return new Promise((resolve, reject) => {
    const appPassword = decrypt(mailbox.app_password).replace(/\s/g, '');
    const imap = new Imap({ user: mailbox.email, password: appPassword, host: mailbox.imap_host, port: mailbox.imap_port, tls: true, tlsOptions: { rejectUnauthorized: false }, connTimeout: IMAP_CONFIG.connTimeout, authTimeout: IMAP_CONFIG.authTimeout });
    imap.once('ready', () => { imap.openBox('INBOX', false, (err) => { if (err) { imap.end(); return reject(err); } imap.addFlags(uid, ['\\Seen'], (err) => { imap.end(); if (err) return reject(err); resolve(); }); }); });
    imap.once('error', (err) => reject(err));
    imap.connect();
  });
};

const moveToMaxifyLabel = async (mailbox, uid) => {
  if (!uid) return;
  return new Promise((resolve, reject) => {
    const appPassword = decrypt(mailbox.app_password).replace(/\s/g, '');
    const imap = new Imap({ user: mailbox.email, password: appPassword, host: mailbox.imap_host, port: mailbox.imap_port, tls: true, tlsOptions: { rejectUnauthorized: false }, connTimeout: IMAP_CONFIG.connTimeout, authTimeout: IMAP_CONFIG.authTimeout });
    imap.once('ready', () => { imap.openBox('INBOX', false, (err) => { if (err) { imap.end(); return reject(err); } imap.addFlags(uid, ['\\Deleted'], (flagErr) => { if (flagErr) { imap.end(); return reject(flagErr); } imap.expunge((expErr) => { imap.end(); if (expErr) return reject(expErr); resolve(); }); }); }); });
    imap.once('error', (err) => reject(err));
    imap.connect();
  });
};

const buildSearchCriteria = (checkReadEmails, sinceDate) => {
  let senderCriteria;
  if (TARGET_SENDERS.length === 1) { senderCriteria = ['FROM', TARGET_SENDERS[0]]; }
  else if (TARGET_SENDERS.length === 2) { senderCriteria = ['OR', ['FROM', TARGET_SENDERS[0]], ['FROM', TARGET_SENDERS[1]]]; }
  else { let orChain = ['FROM', TARGET_SENDERS[TARGET_SENDERS.length - 1]]; for (let i = TARGET_SENDERS.length - 2; i >= 0; i--) { orChain = ['OR', ['FROM', TARGET_SENDERS[i]], orChain]; } senderCriteria = orChain; }
  if (checkReadEmails) return [senderCriteria, ['SINCE', sinceDate]];
  return ['UNSEEN', senderCriteria, ['SINCE', sinceDate]];
};

const checkSpamAndMove = async (mailbox, checkReadEmails = false) => {
  try {
    const imap = await createImapConnection(mailbox);
    await new Promise((resolve) => {
      const spamFolders = ['[Gmail]/Spam', 'Spam', 'Junk', 'SPAM'];
      const tryFolder = (index) => {
        if (index >= spamFolders.length) { imap.end(); return resolve(0); }
        imap.openBox(spamFolders[index], false, (err) => {
          if (err) return tryFolder(index + 1);
          const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          imap.search(buildSearchCriteria(checkReadEmails, sevenDaysAgo), (err, results) => {
            console.log(`      🔍 Searched ${spamFolders[index]}`);
            if (err || !results || results.length === 0) { console.log(`      📭 No emails found`); imap.end(); return resolve(0); }
            let completed = 0, succeeded = 0;
            results.forEach((seqno) => { imap.move(seqno, 'INBOX', (moveErr) => { completed++; if (!moveErr) succeeded++; if (completed === results.length) { setTimeout(() => { imap.end(); resolve(succeeded); }, 2000); } }); });
          });
        });
      };
      tryFolder(0);
    });
  } catch (error) { return 0; }
};

const checkPromotionsAndMove = async (mailbox, checkReadEmails = false) => {
  try {
    const imap = await createImapConnection(mailbox);
    await new Promise((resolve) => {
      const promotionsFolders = ['[Gmail]/Promotions', 'Promotions', '[Gmail]/All Mail'];
      const tryFolder = (index) => {
        if (index >= promotionsFolders.length) { imap.end(); return resolve(0); }
        imap.openBox(promotionsFolders[index], false, (err) => {
          if (err) return tryFolder(index + 1);
          const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          imap.search(buildSearchCriteria(checkReadEmails, sevenDaysAgo), (err, results) => {
            console.log(`      🔍 Searched ${promotionsFolders[index]}`);
            if (err || !results || results.length === 0) { console.log(`      📭 No emails found`); imap.end(); return resolve(0); }
            let completed = 0, succeeded = 0;
            results.forEach((seqno) => { imap.move(seqno, 'INBOX', (moveErr) => { completed++; if (!moveErr) succeeded++; if (completed === results.length) { setTimeout(() => { imap.end(); resolve(succeeded); }, 2000); } }); });
          });
        });
      };
      tryFolder(0);
    });
  } catch (error) { return 0; }
};

const processMailbox = async (mailbox, mailboxIndex = 999) => {
  const ENABLE_CLICKS = mailboxIndex <= CLICK_ENABLED_UNTIL_INDEX;
  const checkReadEmails = shouldCheckReadEmails(mailbox.email);
  if (checkReadEmails) console.log(`   📖 "USE" MAILBOX DETECTED`);
  console.log(`   Clicks ${ENABLE_CLICKS ? 'ENABLED' : 'DISABLED'} (${mailboxIndex}/${CLICK_ENABLED_UNTIL_INDEX})`);

  console.log(`    Checking SPAM folder...`);
  const movedFromSpam = await checkSpamAndMove(mailbox, checkReadEmails);
  console.log(`    Checking PROMOTIONS folder...`);
  const movedFromPromotions = await checkPromotionsAndMove(mailbox, checkReadEmails);
  if (movedFromSpam + movedFromPromotions > 0) { console.log(`    Waiting 5s for Gmail to sync...`); await new Promise(resolve => setTimeout(resolve, 5000)); }

  try {
    const imap = await createImapConnection(mailbox);
    const emails = await new Promise((resolve, reject) => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); return reject(err); }
        const twoDaysAgo = new Date(); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        imap.search(buildSearchCriteria(checkReadEmails, twoDaysAgo), (err, results) => {
          console.log(`     🔍 Searched INBOX (last 2 days)`);
          if (err) { imap.end(); return reject(err); }
          if (!results || results.length === 0) { console.log(`     📭 No emails found`); imap.end(); return resolve([]); }
          const emailsToFetch = results.reverse();
          const fetch = imap.fetch(emailsToFetch, { bodies: '', struct: true, markSeen: false, envelope: true });
          const emailPromises = [];
          fetch.on('message', (msg, seqno) => {
            const emailPromise = new Promise((resolveEmail) => {
              let buffer = '', uid = null, bodyEnded = false, attrsReceived = false;
              msg.once('attributes', (attrs) => { uid = attrs.uid; attrsReceived = true; if (bodyEnded) resolveWithParsedEmail(); });
              const resolveWithParsedEmail = async () => {
                try { const parsed = await simpleParser(buffer); if (!uid) uid = seqno; resolveEmail({ seqno, uid, from: parsed.from, subject: parsed.subject || 'No subject', text: parsed.text || '', html: parsed.html || '', date: parsed.date }); }
                catch (e) { resolveEmail(null); }
              };
              msg.on('body', (stream) => { stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); }); stream.once('end', () => { bodyEnded = true; if (attrsReceived) resolveWithParsedEmail(); }); });
              msg.once('end', () => { if (!attrsReceived && bodyEnded) setTimeout(resolveWithParsedEmail, 100); });
            });
            emailPromises.push(emailPromise);
          });
          fetch.once('error', (err) => { imap.end(); reject(err); });
          fetch.once('end', async () => { const parsed = await Promise.all(emailPromises); imap.end(); resolve(parsed.filter(e => e !== null)); });
        });
      });
    });

    if (emails.length === 0) return { mailbox: mailbox.email, found: 0, opened: 0, clicked: 0 };
    let openedCount = 0, clickedCount = 0;

    for (const email of emails) {
      try {
        const senderEmail = email.from?.value?.[0]?.address || email.from?.text;
        console.log(`       Campaign: ${senderEmail}`);
        console.log(`          Subject: ${email.subject}`);

        const emailAgeHours = getEmailAgeHours(email.date);
        if (emailAgeHours > MAX_EMAIL_AGE_HOURS) {
          console.log(`          Email too old (${emailAgeHours.toFixed(1)}h) - SKIPPING`);
          await markEmailAsRead(mailbox, email.uid);
          try { await moveToMaxifyLabel(mailbox, email.uid); } catch (e) { }
          continue;
        }

        const willOpen = Math.random() < ENGAGEMENT_CONFIG.open_rate;
        if (!willOpen) {
          await markEmailAsRead(mailbox, email.uid);
          try { await moveToMaxifyLabel(mailbox, email.uid); } catch (e) { }
          continue;
        }

        const willClick = Math.random() < ENGAGEMENT_CONFIG.click_rate;
        const allUrls = extractAllUrls(email.text, email.html);
        console.log(`          📋 Found ${allUrls.length} URL(s)`);

        // ── HUBSPOT-ONLY tracking pixel detection ─────────────────────
        const trackingPixels = allUrls.filter(url => {
          const lowerUrl = url.toLowerCase();
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
          const isNotClickTracker =
            !(lowerUrl.includes('hubspotlinks') && lowerUrl.includes('/ctc/')) &&
            !lowerUrl.includes('/e2t/c/') &&
            !lowerUrl.includes('/e2t/ct/');
          return isHubSpotTracker && isNotClickTracker;
        });

        if (trackingPixels.length > 0) {
          console.log(`          📊 Found ${trackingPixels.length} HubSpot tracking pixel(s)`);
          for (const pixel of trackingPixels) { await loadUrl(pixel, 'pixel'); await new Promise(resolve => setTimeout(resolve, 800)); }
          await new Promise(resolve => setTimeout(resolve, 3000));
          console.log(`          ✅ Pixels loaded!`);
        } else {
          console.log(`          ⚠️  No HubSpot tracking pixels - using fallback...`);
          const fallbackLinks = allUrls.filter(url => url.startsWith('http') && !url.toLowerCase().includes('unsubscribe'));
          if (fallbackLinks.length > 0) { await loadUrl(fallbackLinks[0], 'fallback-open'); await new Promise(resolve => setTimeout(resolve, 3000)); }
        }

        openedCount++;
        console.log(`          ✓ EMAIL OPENED`);
        await simulateReadTime();

        if (ENABLE_CLICKS && willClick) {
          const clickableLinks = allUrls.filter(url => url.startsWith('http') && !url.toLowerCase().includes('unsubscribe') && !trackingPixels.includes(url) && !url.toLowerCase().includes('view-in-browser'));

          // Prioritize HubSpot click tracking links
          const hubspotClickLinks = clickableLinks.filter(url => {
            const lowerUrl = url.toLowerCase();
            return (lowerUrl.includes('hubspotlinks') && lowerUrl.includes('/ctc/')) ||
              lowerUrl.includes('/e2t/c/') || lowerUrl.includes('/e2t/ct/');
          });
          const linksToClickFrom = hubspotClickLinks.length > 0 ? hubspotClickLinks : clickableLinks;
          if (hubspotClickLinks.length > 0) console.log(`          🎯 Found ${hubspotClickLinks.length} HubSpot click link(s)`);

          if (linksToClickFrom.length > 0) {
            const randomLink = linksToClickFrom[Math.floor(Math.random() * linksToClickFrom.length)];
            const clickDelay = Math.random() * (ENGAGEMENT_CONFIG.click_delay_max - ENGAGEMENT_CONFIG.click_delay_min) + ENGAGEMENT_CONFIG.click_delay_min;
            await new Promise(resolve => setTimeout(resolve, clickDelay));
            const clicked = await loadUrl(randomLink, 'click');
            if (clicked) { clickedCount++; console.log(`          ✓ CLICKED`); await new Promise(resolve => setTimeout(resolve, 2000)); }
          }
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
        await markEmailAsRead(mailbox, email.uid);
        try { await moveToMaxifyLabel(mailbox, email.uid); console.log(`          📁 Archived`); } catch (e) { }
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (emailError) {
        console.error(`          Error:`, emailError.message);
      }
    }

    return { mailbox: mailbox.email, found: emails.length, opened: openedCount, clicked: clickedCount };
  } catch (error) {
    return { mailbox: mailbox.email, found: 0, opened: 0, clicked: 0, error: error.message };
  }
};

const engageTestHubspot = async () => {
  const startTime = Date.now();
  console.log('\n========================================');
  console.log('   [HUBSPOT] TEST ENGAGEMENT');
  console.log('========================================\n');
  TARGET_SENDERS.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));

  try {
    await getBrowser();
    const { data: mailboxData, error: fetchError } = await supabase.from('auto_responder_mailboxes').select('*').in('email', TEST_EMAILS);
    if (fetchError) throw new Error(`Failed to fetch mailboxes: ${fetchError.message}`);

    const mailboxes = TEST_EMAILS.map(email => mailboxData.find(m => m.email === email)).filter(m => m !== undefined);
    console.log(` Found ${mailboxes.length}/${TEST_EMAILS.length} mailboxes`);
    if (mailboxes.length === 0) return { mailboxCount: 0, mailboxesWithEmails: 0, found: 0, opened: 0, clicked: 0, duration: 0 };

    const limit = createConcurrencyLimiter(WORKER_CONCURRENCY);
    let logIndex = 0;

    const processPromise = Promise.all(
      mailboxes.map((mailbox) => {
        logIndex++;
        const currentIndex = logIndex;
        return limit(async () => {
          console.log(`\n[${currentIndex}/${mailboxes.length}] ${mailbox.email}`);
          try {
            const result = await Promise.race([
              processMailbox(mailbox, currentIndex),
              new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout (${MAILBOX_TIMEOUT_MS / 1000}s)`)), MAILBOX_TIMEOUT_MS))
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

    const globalTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('GLOBAL TIMEOUT: Script exceeded 2.5 minutes')), 150000)
    );

    let results;
    try {
      results = await Promise.race([processPromise, globalTimeout]);
    } catch (timeoutError) {
      console.error(`\n⏱️  ${timeoutError.message} - Forcing completion`);
      results = [];
    }

    const totalFound = results.reduce((s, r) => s + r.found, 0);
    const totalOpened = results.reduce((s, r) => s + r.opened, 0);
    const totalClicked = results.reduce((s, r) => s + r.clicked, 0);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n========================================');
    console.log('   [HUBSPOT] TEST RESULTS');
    console.log(`   Found: ${totalFound} | Opened: ${totalOpened} | Clicked: ${totalClicked} | ${duration}s`);
    console.log('========================================\n');

    if (globalBrowser) { try { await globalBrowser.close(); globalBrowser = null; } catch (e) { } }
    return { mailboxCount: mailboxes.length, mailboxesWithEmails: results.filter(r => r.found > 0).length, found: totalFound, opened: totalOpened, clicked: totalClicked, duration: parseFloat(duration) };
  } catch (error) {
    if (globalBrowser) { try { await globalBrowser.close(); globalBrowser = null; } catch (e) { } }
    console.error('\n CRITICAL ERROR:', error);
    throw error;
  }
};

module.exports = { engageTestHubspot };

if (require.main === module) {
  engageTestHubspot().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
}
